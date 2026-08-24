import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useRef, useState } from "react";
import { api, uploadFormData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { FileText, Upload, Pencil, Trash2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Template {
  id: number;
  kind: "uploaded" | "builder";
  title: string;
  description: string | null;
  pageCount: number;
  fields: unknown[];
  placeholders: { key: string; label: string }[];
  originalFilename: string;
  createdAt: string;
}

export function AdminAgreements() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Template[]>({
    queryKey: ["admin-agreement-templates"],
    queryFn: () => api("/admin/agreements/templates"),
  });

  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error("Select a file");
      return;
    }
    const fd = new FormData();
    fd.append("file", f);
    fd.append("title", title || f.name);
    fd.append("description", desc);
    setUploading(true);
    try {
      await uploadFormData("/admin/agreements/templates", fd);
      toast.success("Template uploaded");
      setOpen(false);
      setTitle("");
      setDesc("");
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["admin-agreement-templates"] });
    } catch (err) {
      toast.error((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteM = useMutation({
    mutationFn: (id: number) => api(`/admin/agreements/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Template deleted");
      qc.invalidateQueries({ queryKey: ["admin-agreement-templates"] });
    },
  });

  const { data: patches } = useQuery<{ id: string; title: string; description: string }[]>({
    queryKey: ["admin-agreement-patches"],
    queryFn: () => api("/admin/agreements/patches"),
  });

  const applyPatchesM = useMutation({
    mutationFn: () =>
      api<{
        results: {
          patchId: string;
          title: string;
          templatesUpdated: number;
          templatesAlreadyApplied: number;
          templatesNotApplicable: number;
          updatedTemplateIds: number[];
        }[];
      }>("/admin/agreements/patches/apply", { method: "POST" }),
    onSuccess: (data) => {
      const totalUpdated = data.results.reduce((sum, r) => sum + r.templatesUpdated, 0);
      const totalAlready = data.results.reduce((sum, r) => sum + r.templatesAlreadyApplied, 0);
      if (totalUpdated > 0) {
        const detail = data.results
          .filter((r) => r.templatesUpdated > 0)
          .map((r) => `${r.title} (${r.templatesUpdated})`)
          .join(", ");
        toast.success(`Applied to ${totalUpdated} template${totalUpdated === 1 ? "" : "s"}: ${detail}`);
      } else if (totalAlready > 0) {
        toast.info("All wording updates were already applied. Nothing to do.");
      } else {
        toast.info("No matching templates found for the current updates.");
      }
      qc.invalidateQueries({ queryKey: ["admin-agreement-templates"] });
      qc.invalidateQueries({ queryKey: ["admin-agreement-patches"] });
    },
    onError: (err) => {
      toast.error((err as Error).message || "Update failed");
    },
  });

  const patchCount = patches?.length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-secondary">Agreements</h1>
          <p className="text-muted-foreground mt-1">Upload contracts, place fields, send to clients for signature.</p>
        </div>
        <div className="flex gap-2">
          {patchCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={applyPatchesM.isPending}>
                  <Wand2 className="w-4 h-4 mr-2" />
                  {applyPatchesM.isPending ? "Applying..." : `Apply wording updates (${patchCount})`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apply wording updates?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <div>
                        The following updates will be applied to every matching builder
                        template. Already-signed agreements are not affected — only
                        pending clients and any future assignments will see the new wording.
                      </div>
                      <ul className="space-y-2 text-sm">
                        {patches?.map((p) => (
                          <li key={p.id} className="rounded border p-2">
                            <div className="font-medium text-foreground">{p.title}</div>
                            <div className="text-muted-foreground mt-1">{p.description}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => applyPatchesM.mutate()}>
                    Apply updates
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Link href="/admin/agreements/new">
            <Button><Sparkles className="w-4 h-4 mr-2" /> Build new</Button>
          </Link>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Upload className="w-4 h-4 mr-2" /> Upload PDF</Button>
            </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleUpload} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Upload Agreement Template</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Master Services Agreement" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Input id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="file">PDF or DOCX file</Label>
                <Input id="file" ref={fileRef} type="file" accept=".pdf,.docx,.doc,application/pdf" required />
                <p className="text-xs text-muted-foreground">DOCX is converted to PDF on upload. Max 25MB.</p>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={uploading}>{uploading ? "Uploading..." : "Upload"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 truncate">
                    {t.kind === "builder" ? (
                      <Sparkles className="w-4 h-4 shrink-0 text-primary" />
                    ) : (
                      <FileText className="w-4 h-4 shrink-0 text-primary" />
                    )}
                    <span className="truncate">{t.title}</span>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {t.kind === "builder" ? "In-platform agreement" : t.originalFilename}
                  </div>
                </div>
                <Badge variant={t.kind === "builder" ? "default" : "outline"}>
                  {t.kind === "builder" ? "Builder" : `${t.pageCount}p`}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {t.description && <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>}
                <div className="text-xs text-muted-foreground">
                  {t.kind === "builder"
                    ? `${(t.placeholders ?? []).length} placeholder${(t.placeholders ?? []).length === 1 ? "" : "s"}`
                    : `${Array.isArray(t.fields) ? t.fields.length : 0} fields`}
                  {" • "}
                  {new Date(t.createdAt).toLocaleDateString()}
                </div>
                <div className="flex gap-2">
                  {t.kind === "uploaded" ? (
                    <Link href={`/admin/agreements/${t.id}/edit`}>
                      <Button size="sm" variant="outline"><Pencil className="w-3 h-3 mr-2" /> Edit fields</Button>
                    </Link>
                  ) : (
                    <Link href={`/admin/agreements/builder/${t.id}`}>
                      <Button size="sm" variant="outline"><Pencil className="w-3 h-3 mr-2" /> Edit</Button>
                    </Link>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete template?</AlertDialogTitle>
                        <AlertDialogDescription>This removes the template and any assignments. Cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteM.mutate(t.id)} className="bg-destructive">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No templates yet. Click <span className="font-semibold">Upload Template</span> to add one.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
