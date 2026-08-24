import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, apiPdfUrl } from "@/lib/api";
import { PdfPage } from "@/components/PdfViewer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

type FieldType = "signature" | "initial" | "date" | "text" | "name";
type Role = "client" | "admin";

interface Field {
  id: string;
  type: FieldType;
  role: Role;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  required?: boolean;
}

interface Template {
  id: number;
  title: string;
  description: string | null;
  pageCount: number;
  fields: Field[];
  originalFilename: string;
}

const PALETTE: { type: FieldType; label: string; w: number; h: number }[] = [
  { type: "signature", label: "Signature", w: 0.25, h: 0.06 },
  { type: "initial", label: "Initial", w: 0.08, h: 0.05 },
  { type: "date", label: "Date", w: 0.14, h: 0.04 },
  { type: "text", label: "Text", w: 0.2, h: 0.04 },
  { type: "name", label: "Name", w: 0.22, h: 0.04 },
];

const ROLE_COLOR: Record<Role, string> = {
  client: "rgba(59,130,246,0.25)",
  admin: "rgba(16,185,129,0.25)",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function AdminAgreementEdit() {
  const { id } = useParams();
  const tid = Number(id);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Template>({
    queryKey: ["admin-agreement-template", tid],
    queryFn: () => api(`/admin/agreements/templates/${tid}`),
    enabled: !!tid,
  });

  const [fields, setFields] = useState<Field[]>([]);
  const [activeRole, setActiveRole] = useState<Role>("client");
  const [draggingType, setDraggingType] = useState<FieldType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const pagesRef = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (data?.fields) setFields(data.fields);
  }, [data]);

  const saveM = useMutation({
    mutationFn: (newFields: Field[]) =>
      api(`/admin/agreements/templates/${tid}`, {
        method: "PATCH",
        json: { fields: newFields },
      }),
    onSuccess: () => {
      toast.success("Fields saved");
      qc.invalidateQueries({ queryKey: ["admin-agreement-template", tid] });
    },
  });

  const onPageDrop = (page: number, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!draggingType) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const yFrac = (e.clientY - rect.top) / rect.height;
    const meta = PALETTE.find((p) => p.type === draggingType)!;
    const newField: Field = {
      id: uid(),
      type: draggingType,
      role: activeRole,
      page,
      x: Math.max(0, Math.min(1 - meta.w, xFrac - meta.w / 2)),
      y: Math.max(0, Math.min(1 - meta.h, yFrac - meta.h / 2)),
      width: meta.w,
      height: meta.h,
      required: true,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
    setDraggingType(null);
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const updateField = (id: string, patch: Partial<Field>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  if (isLoading || !data) return <Skeleton className="h-screen w-full" />;

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <Link href="/admin/agreements">
        <Button variant="ghost" className="-ml-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Agreements
        </Button>
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <div className="text-sm text-muted-foreground">{data.pageCount} pages • {fields.length} fields</div>
        </div>
        <Button onClick={() => saveM.mutate(fields)} disabled={saveM.isPending}>
          <Save className="w-4 h-4 mr-2" /> Save Fields
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 md:col-span-3 sticky top-4 self-start">
          <CardContent className="p-4 space-y-4">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Role for new fields</Label>
              <Select value={activeRole} onValueChange={(v) => setActiveRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="admin">Admin (counter-sign)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Drag onto page</Label>
              {PALETTE.map((p) => (
                <div
                  key={p.type}
                  draggable
                  onDragStart={() => setDraggingType(p.type)}
                  onDragEnd={() => setDraggingType(null)}
                  className="px-3 py-2 bg-muted border border-border rounded cursor-grab active:cursor-grabbing text-sm font-medium"
                  style={{ background: ROLE_COLOR[activeRole] }}
                >
                  {p.label}
                </div>
              ))}
            </div>
            {selectedId && (
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs uppercase">Selected field</Label>
                {(() => {
                  const f = fields.find((x) => x.id === selectedId);
                  if (!f) return null;
                  return (
                    <>
                      <Select value={f.role} onValueChange={(v) => updateField(f.id, { role: v as Role })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="client">Client</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Label (optional)"
                        value={f.label ?? ""}
                        onChange={(e) => updateField(f.id, { label: e.target.value })}
                      />
                      <Button size="sm" variant="destructive" onClick={() => removeField(f.id)}>
                        <Trash2 className="w-3 h-3 mr-2" /> Remove
                      </Button>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="text-xs text-muted-foreground border-t pt-3">
              <div>● <span className="font-medium" style={{ color: "rgb(59,130,246)" }}>Blue</span> = Client</div>
              <div>● <span className="font-medium" style={{ color: "rgb(16,185,129)" }}>Green</span> = Admin</div>
            </div>
          </CardContent>
        </Card>

        <div className="col-span-12 md:col-span-9 space-y-6">
          {Array.from({ length: data.pageCount }, (_, i) => i + 1).map((pageNum) => {
            const pageFields = fields.filter((f) => f.page === pageNum);
            return (
              <div key={pageNum} className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Page {pageNum}</div>
                <PdfPage
                  pdfUrl={apiPdfUrl(`/admin/agreements/templates/${tid}/pdf`)}
                  pageNumber={pageNum}
                  scale={1.3}
                  onRendered={(info) => setPageSizes((p) => ({ ...p, [pageNum]: { w: info.width, h: info.height } }))}
                  overlay={
                    <div
                      ref={(el) => {
                        pagesRef.current[pageNum] = el;
                      }}
                      className="absolute inset-0"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onPageDrop(pageNum, e)}
                    >
                      {pageFields.map((f) => {
                        const ps = pageSizes[pageNum];
                        if (!ps) return null;
                        return (
                          <div
                            key={f.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(f.id);
                            }}
                            className={`absolute border-2 rounded text-[10px] flex items-center justify-center cursor-pointer select-none ${
                              selectedId === f.id ? "border-primary ring-2 ring-primary/30" : "border-slate-400"
                            }`}
                            style={{
                              left: f.x * ps.w,
                              top: f.y * ps.h,
                              width: f.width * ps.w,
                              height: f.height * ps.h,
                              background: ROLE_COLOR[f.role],
                            }}
                          >
                            <span className="font-semibold uppercase tracking-wide">
                              {f.role === "client" ? "C" : "A"} · {f.type}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
