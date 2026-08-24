import { useParams, Link } from "wouter";
import { 
  useGetAdminClient, 
  useUpdateAdminClient, 
  useResendAdminClientInvite, 
  useRevokeAdminClientAccess, 
  useDeleteAdminClient, 
  useListAdminClientNotes, 
  useCreateAdminClientNote,
  getGetAdminClientQueryKey,
  getListAdminClientNotesQueryKey,
  getListAdminClientsQueryKey
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, uploadFormData } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, User, Building, Mail, Phone, Calendar, Download, Send, XCircle, Trash2, Edit2, Save, FileText, Eye, Upload, Link2, ExternalLink, Folder, FolderPlus, ChevronRight, Home, PlayCircle, CheckCircle2, Clock } from "lucide-react";
import { StageBadge, STAGE_LABEL, type ClientStage } from "@/lib/clientStage";
import { useQuery } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { ClientAnalyticsPanel, ClientActivityPanel, ClientAgreementsPanel } from "./ClientAnalyticsPanel";
import { ClientHealthPanel } from "./ClientHealthPanel";

export function AdminClientDetail() {
  const { id } = useParams();
  const clientId = Number(id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const isViewer = me?.role === "viewer";

  const [isEditing, setIsEditing] = useState(false);
  const [noteBody, setNoteBody] = useState("");

  const { data: detail, isLoading } = useGetAdminClient(clientId, {
    query: { enabled: !!clientId, queryKey: getGetAdminClientQueryKey(clientId) }
  });

  const { data: notes, isLoading: notesLoading } = useListAdminClientNotes(clientId, {
    query: { enabled: !!clientId, queryKey: getListAdminClientNotesQueryKey(clientId) }
  });

  // Each mutation surfaces an explicit error toast so the operator
  // never sees a click "do nothing" silently — for example a Resend
  // Invite call that fails on the email provider would otherwise vanish.
  const toastErr = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof Error && err.message ? err.message : fallback);

  const updateMutation = useUpdateAdminClient({
    mutation: {
      onSuccess: () => {
        toast.success("Client updated");
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getGetAdminClientQueryKey(clientId) });
        queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
      },
      onError: toastErr("Could not update client"),
    }
  });

  const resendInviteMutation = useResendAdminClientInvite({
    mutation: {
      onSuccess: () => toast.success("Invite resent", {
        description: `Reminder emailed to ${detail?.client.email ?? "the client"}.`,
      }),
      onError: toastErr("Could not resend invite"),
    }
  });

  const revokeMutation = useRevokeAdminClientAccess({
    mutation: {
      onSuccess: () => {
        toast.success("Access revoked");
        queryClient.invalidateQueries({ queryKey: getGetAdminClientQueryKey(clientId) });
      },
      onError: toastErr("Could not revoke access"),
    }
  });

  const deleteMutation = useDeleteAdminClient({
    mutation: {
      onSuccess: () => {
        toast.success("Client deleted");
        setLocation("/admin/clients");
      },
      onError: toastErr("Could not delete client"),
    }
  });

  const addNoteMutation = useCreateAdminClientNote({
    mutation: {
      onSuccess: () => {
        toast.success("Note added");
        setNoteBody("");
        queryClient.invalidateQueries({ queryKey: getListAdminClientNotesQueryKey(clientId) });
      },
      onError: toastErr("Could not add note"),
    }
  });

  if (isLoading || !detail) {
    return <Skeleton className="h-screen w-full" />;
  }

  const { client, modules, icp } = detail;

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateMutation.mutate({
      id: clientId,
      data: {
        firstName: formData.get("firstName") as string,
        lastName: formData.get("lastName") as string,
        businessName: formData.get("businessName") as string,
        phone: formData.get("phone") as string,
        sprintStartDate: formData.get("sprintStartDate") as string || null,
        status: formData.get("status") as string,
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-success">Active</Badge>;
      case 'invited': return <Badge variant="secondary">Invited</Badge>;
      case 'revoked': return <Badge variant="destructive">Revoked</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Link href="/admin/clients">
        <Button variant="ghost" className="-ml-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Clients
        </Button>
      </Link>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight text-secondary">
              {client.firstName} {client.lastName}
            </h1>
            <StageBadge stage={client.stage} />
            {getStatusBadge(client.status)}
          </div>
          <div className="flex items-center gap-4 mt-2 text-muted-foreground text-sm">
            <span className="flex items-center gap-1"><Building className="w-4 h-4" /> {client.businessName}</span>
            <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {client.email}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isViewer && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await api(`/admin/clients/${clientId}/impersonate`, { method: "POST" });
                    toast.success(`Now previewing as ${client.firstName} ${client.lastName}`);
                    window.open("/", "_blank");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Eye className="w-4 h-4 mr-2" /> Preview as client
              </Button>
              {client.status === 'invited' && (
                <Button variant="outline" size="sm" onClick={() => resendInviteMutation.mutate({ id: clientId })} disabled={resendInviteMutation.isPending}>
                  <Send className="w-4 h-4 mr-2" /> Resend Invite
                </Button>
              )}
              {client.status === 'active' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-orange-600 hover:text-orange-700">
                      <XCircle className="w-4 h-4 mr-2" /> Revoke Access
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke Access</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will prevent the client from logging in. You can restore access later by changing their status.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => revokeMutation.mutate({ id: clientId })} className="bg-orange-600 hover:bg-orange-700">
                        Revoke Access
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this client, their ICP responses, notes, and progress. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteMutation.mutate({ id: clientId })} className="bg-destructive text-destructive-foreground">
                      Delete Client
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      <SprintLifecycleCard
        clientId={clientId}
        client={client}
        isViewer={isViewer}
        onChange={() => queryClient.invalidateQueries({ queryKey: getGetAdminClientQueryKey(clientId) })}
      />

      <Tabs defaultValue="profile" className="w-full mt-6">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
          <TabsTrigger value="profile" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Profile</TabsTrigger>
          <TabsTrigger value="health" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Health</TabsTrigger>
          <TabsTrigger value="progress" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Progress</TabsTrigger>
          <TabsTrigger value="icp" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">ICP Responses</TabsTrigger>
          <TabsTrigger value="agreements" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Agreements</TabsTrigger>
          <TabsTrigger value="courses" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Courses</TabsTrigger>
          <TabsTrigger value="documents" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Documents</TabsTrigger>
          <TabsTrigger value="uploads" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Uploads</TabsTrigger>
          <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Activity</TabsTrigger>
          <TabsTrigger value="analytics" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Analytics</TabsTrigger>
          <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none py-3">Internal Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="pt-6"><ClientHealthPanel clientId={clientId} /></TabsContent>
        <TabsContent value="agreements" className="pt-6"><ClientAgreementsPanel clientId={clientId} /></TabsContent>
        <TabsContent value="courses" className="pt-6"><ClientCoursesPanel clientId={clientId} isViewer={isViewer} /></TabsContent>
        <TabsContent value="documents" className="pt-6"><ClientDocumentsPanel clientId={clientId} isViewer={isViewer} /></TabsContent>
        <TabsContent value="uploads" className="pt-6"><ClientUploadsPanel clientId={clientId} /></TabsContent>
        <TabsContent value="activity" className="pt-6"><ClientActivityPanel clientId={clientId} /></TabsContent>
        <TabsContent value="analytics" className="pt-6"><ClientAnalyticsPanel clientId={clientId} /></TabsContent>

        <TabsContent value="profile" className="pt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Client Profile</CardTitle>
              {!isViewer && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)}>
                  {isEditing ? <XCircle className="w-4 h-4 mr-2" /> : <Edit2 className="w-4 h-4 mr-2" />}
                  {isEditing ? "Cancel" : "Edit Profile"}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <form onSubmit={handleUpdate} className="space-y-4 max-w-2xl">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input id="firstName" name="firstName" defaultValue={client.firstName} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input id="lastName" name="lastName" defaultValue={client.lastName} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessName">Business Name</Label>
                    <Input id="businessName" name="businessName" defaultValue={client.businessName} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" name="phone" defaultValue={client.phone || ""} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sprintStartDate">Sprint Start Date</Label>
                      <Input id="sprintStartDate" name="sprintStartDate" type="date" defaultValue={client.sprintStartDate ? new Date(client.sprintStartDate).toISOString().split('T')[0] : ""} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" defaultValue={client.status}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="invited">Invited</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="revoked">Revoked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={updateMutation.isPending} className="mt-4">
                    <Save className="w-4 h-4 mr-2" /> Save Changes
                  </Button>
                </form>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Name</div>
                    <div className="text-base">{client.firstName} {client.lastName}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Email</div>
                    <div className="text-base">{client.email}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Business</div>
                    <div className="text-base">{client.businessName}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Phone</div>
                    <div className="text-base">{client.phone || "-"}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Sprint Start Date</div>
                    <div className="text-base">{client.sprintStartDate ? new Date(client.sprintStartDate).toLocaleDateString() : "Not scheduled"}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Last Login</div>
                    <div className="text-base">{client.lastLoginAt ? new Date(client.lastLoginAt).toLocaleString() : "Never"}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="progress" className="pt-6">
          <div className="space-y-6">
            {modules.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No modules available.</div>
            ) : (
              modules.map(mod => (
                <Card key={mod.id}>
                  <CardHeader className="bg-muted/30 pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{mod.title}</CardTitle>
                      <Badge variant={mod.status === 'complete' ? 'default' : mod.status === 'locked' ? 'outline' : 'secondary'}>
                        {mod.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 p-0">
                    <div className="divide-y">
                      {mod.episodes.map((ep, i) => (
                        <div key={ep.id} className="p-4 flex items-center justify-between">
                          <span className="font-medium text-sm text-foreground/80">{i + 1}. {ep.title}</span>
                          {ep.completed ? (
                            <Badge variant="outline" className="bg-success/10 text-success border-success/20">Completed</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending</span>
                          )}
                        </div>
                      ))}
                      {mod.episodes.length === 0 && <div className="p-4 text-sm text-muted-foreground">No episodes.</div>}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="icp" className="pt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>ICP Questionnaire</CardTitle>
              {icp.submitted && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/admin/clients/${clientId}/icp.csv`} download>
                      <Download className="w-4 h-4 mr-2" /> CSV
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/admin/clients/${clientId}/icp.pdf`} target="_blank" rel="noreferrer">
                      <FileText className="w-4 h-4 mr-2" /> PDF
                    </a>
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!icp.submitted ? (
                <div className="text-center py-12 text-muted-foreground">
                  Client has not submitted their ICP yet.
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(icp.answers).map(([key, answer]) => (
                    <div key={key} className="border-b pb-4 last:border-0">
                      <div className="text-sm font-medium text-muted-foreground mb-2">
                        {key.replace(/^q\d+_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </div>
                      <div className="text-base">{answer || <span className="italic text-muted-foreground/50">No answer</span>}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="pt-6">
          <Card>
            <CardHeader>
              <CardTitle>Internal Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {!isViewer && (
                <div className="flex gap-2">
                  <Input 
                    placeholder="Add a note about this client..." 
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && noteBody.trim()) { addNoteMutation.mutate({ id: clientId, data: { body: noteBody } }); } }}
                  />
                  <Button 
                    onClick={() => addNoteMutation.mutate({ id: clientId, data: { body: noteBody } })}
                    disabled={!noteBody.trim() || addNoteMutation.isPending}
                  >
                    Add
                  </Button>
                </div>
              )}
              
              <div className="space-y-4 mt-6">
                {notesLoading ? <Skeleton className="h-20" /> : notes?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No internal notes yet.</div>
                ) : (
                  notes?.map(note => (
                    <div key={note.id} className="p-4 bg-muted/30 rounded-lg border border-border text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-semibold text-secondary">{note.authorName}</span>
                        <span className="text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-foreground/80">{note.body}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClientUploadsPanel({ clientId }: { clientId: number }) {
  const { data, isLoading } = useQuery<Array<{
    id: number;
    name: string;
    sizeBytes: number;
    contentType: string;
    episodeId: number;
    episodeTitle: string;
    createdAt: string;
  }>>({
    queryKey: ["adminClientUploads", clientId],
    queryFn: () => api(`/admin/clients/${clientId}/uploads`),
    enabled: !!clientId,
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          This client hasn't uploaded any files yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Uploads</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background">
            <a href={`/api/admin/files/upload/${u.id}?download=1`} className="flex items-center gap-3 min-w-0 hover:underline">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{u.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  Episode: {u.episodeTitle} · {Math.round(u.sizeBytes / 1024)} KB · {new Date(u.createdAt).toLocaleString()}
                </div>
              </div>
            </a>
            <a
              href={`/api/admin/files/upload/${u.id}?download=1`}
              className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
              title={`Download ${u.name}`}
              aria-label={`Download ${u.name}`}
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface AdminClientDoc {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  kind: "folder" | "file" | "link";
  linkUrl: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface AdminDocsFolderPayload {
  folder: AdminClientDoc | null;
  ancestors: AdminClientDoc[];
  items: AdminClientDoc[];
}

function formatDocSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientDocumentsPanel({ clientId, isViewer }: { clientId: number; isViewer: boolean }) {
  const queryClient = useQueryClient();
  const [folderId, setFolderId] = useState<number | null>(null);
  const queryKey = ["admin-client-documents", clientId, folderId];
  const { data, isLoading } = useQuery<AdminDocsFolderPayload>({
    queryKey,
    queryFn: () => api(`/admin/clients/${clientId}/documents${folderId ? `?parentId=${folderId}` : ""}`),
  });

  const items = data?.items ?? [];
  const ancestors = data?.ancestors ?? [];

  const [mode, setMode] = useState<"file" | "link" | "folder">("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(""); setDescription(""); setLinkUrl(""); setFile(null);
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-client-documents", clientId] });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isViewer) return;
    if (mode === "file" && !file) { toast.error("Please choose a file"); return; }
    if (mode === "link" && !/^https?:\/\//i.test(linkUrl.trim())) { toast.error("Link must start with http(s)://"); return; }
    if ((mode === "link" || mode === "folder") && !title.trim()) {
      toast.error(mode === "folder" ? "Folder name is required" : "Title is required for links");
      return;
    }
    const fd = new FormData();
    fd.append("kind", mode);
    if (folderId) fd.append("parentId", String(folderId));
    if (title.trim()) fd.append("title", title.trim());
    if (description.trim()) fd.append("description", description.trim());
    if (mode === "file" && file) fd.append("file", file);
    if (mode === "link") fd.append("linkUrl", linkUrl.trim());
    try {
      setSubmitting(true);
      await uploadFormData(`/admin/clients/${clientId}/documents`, fd);
      toast.success(mode === "folder" ? "Folder created" : mode === "link" ? "Link added" : "File uploaded");
      reset();
      invalidateAll();
    } catch (err) {
      toast.error((err as Error).message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (d: AdminClientDoc) => {
    const what = d.kind === "folder" ? `the folder "${d.title}" and everything inside it` : `"${d.title}"`;
    if (!confirm(`Delete ${what}?`)) return;
    try {
      await api(`/admin/clients/${clientId}/documents/${d.id}`, { method: "DELETE" });
      toast.success("Deleted");
      invalidateAll();
    } catch (err) {
      toast.error((err as Error).message || "Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button
          onClick={() => setFolderId(null)}
          className="flex items-center gap-1 hover:text-secondary"
          data-testid="admin-docs-breadcrumb-root"
        >
          <Home className="w-3.5 h-3.5" /> All documents
        </button>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5" />
            <button
              onClick={() => setFolderId(a.id)}
              className={`hover:text-secondary ${a.id === folderId ? "text-secondary font-medium" : ""}`}
            >
              {a.title}
            </button>
          </span>
        ))}
      </div>

      {!isViewer && (
        <Card>
          <CardHeader>
            <CardTitle>
              {data?.folder ? `Add to "${data.folder.title}"` : "Add to root"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Button type="button" size="sm" variant={mode === "file" ? "default" : "outline"} onClick={() => setMode("file")}>
                  <Upload className="w-3 h-3 mr-2" /> File upload
                </Button>
                <Button type="button" size="sm" variant={mode === "link" ? "default" : "outline"} onClick={() => setMode("link")}>
                  <Link2 className="w-3 h-3 mr-2" /> External link
                </Button>
                <Button type="button" size="sm" variant={mode === "folder" ? "default" : "outline"} onClick={() => setMode("folder")}>
                  <FolderPlus className="w-3 h-3 mr-2" /> New folder
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-title">
                  {mode === "folder" ? "Folder name" : "Title"}
                  {(mode === "link" || mode === "folder") && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id="doc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={mode === "file" ? "Defaults to filename if empty" : mode === "folder" ? "e.g. Weekly reports" : "e.g. Brand assets"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-desc">Description (optional)</Label>
                <Textarea
                  id="doc-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[60px]"
                />
              </div>
              {mode === "file" && (
                <div className="space-y-2">
                  <Label htmlFor="doc-file">File (max 50MB)</Label>
                  <Input id="doc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
              )}
              {mode === "link" && (
                <div className="space-y-2">
                  <Label htmlFor="doc-url">URL</Label>
                  <Input id="doc-url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
                </div>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? (mode === "folder" ? "Creating..." : "Uploading...")
                  : (mode === "folder" ? "Create folder" : mode === "link" ? "Add link" : "Upload file")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{data?.folder ? data.folder.title : "Shared documents"}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {folderId ? "This folder is empty." : "No documents shared with this client yet."}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-4 border border-border/60 rounded-lg p-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`mt-0.5 w-9 h-9 rounded-md grid place-items-center shrink-0 ${d.kind === "folder" ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"}`}>
                      {d.kind === "folder" ? <Folder className="w-4 h-4" /> : d.kind === "link" ? <ExternalLink className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      {d.kind === "folder" ? (
                        <button onClick={() => setFolderId(d.id)} className="font-medium truncate hover:text-primary text-left">
                          {d.title}
                        </button>
                      ) : (
                        <div className="font-medium truncate">{d.title}</div>
                      )}
                      {d.description && <div className="text-sm text-muted-foreground">{d.description}</div>}
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(d.createdAt).toLocaleDateString()}
                        {d.kind === "file" && d.originalFilename && (
                          <> · {d.originalFilename}{d.sizeBytes ? ` (${formatDocSize(d.sizeBytes)})` : ""}</>
                        )}
                        {d.kind === "link" && d.linkUrl && <> · <a href={d.linkUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.linkUrl}</a></>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {d.kind === "folder" && (
                      <Button size="sm" variant="outline" onClick={() => setFolderId(d.id)}>Open</Button>
                    )}
                    {d.kind === "file" && (
                      <a href={`/api/me/documents/${d.id}/download`} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost"><Download className="w-4 h-4" /></Button>
                      </a>
                    )}
                    {!isViewer && (
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(d)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type AdminClientShape = {
  id: number;
  firstName: string;
  lastName: string;
  stage: string;
  agreementSigned: boolean;
  episodesComplete: boolean;
  icpSubmitted: boolean;
  modulesComplete: number;
  totalModules: number;
  sprintStartedAt: string | null;
  sprintComplete: boolean;
  postSprintStatus: string | null;
};

function PrereqLine({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`w-5 h-5 rounded-full grid place-items-center shrink-0 ${done ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3 h-3" />}
      </span>
      <span className={done ? "text-secondary" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

function SprintLifecycleCard({
  clientId,
  client,
  isViewer,
  onChange,
}: {
  clientId: number;
  client: AdminClientShape;
  isViewer: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [postStatus, setPostStatus] = useState<string>(client.postSprintStatus ?? "none");
  const stage = client.stage as ClientStage;
  const prereqsMet = client.agreementSigned && client.episodesComplete && client.icpSubmitted;

  const startSprint = async () => {
    if (!confirm("Start the 22-day sprint countdown for this client now?")) return;
    try {
      setBusy(true);
      await api(`/admin/clients/${clientId}/start-sprint`, { method: "POST" });
      toast.success("Sprint started");
      onChange();
    } catch (err) {
      toast.error((err as Error).message || "Could not start sprint");
    } finally {
      setBusy(false);
    }
  };

  const savePostStatus = async (next: string) => {
    setPostStatus(next);
    try {
      setBusy(true);
      await api(`/admin/clients/${clientId}`, {
        method: "PATCH",
        json: { postSprintStatus: next === "none" ? null : next },
      });
      toast.success("Post-sprint status updated");
      onChange();
    } catch (err) {
      toast.error((err as Error).message || "Could not update status");
      setPostStatus(client.postSprintStatus ?? "none");
    } finally {
      setBusy(false);
    }
  };

  const sprintNotStarted = !client.sprintStartedAt;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="w-5 h-5 text-primary" /> Sprint lifecycle
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Current stage:</span>
          <StageBadge stage={stage} />
          <span className="text-xs text-muted-foreground">({STAGE_LABEL[stage] ?? stage})</span>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Client progress</div>
            <ul className="space-y-2">
              <PrereqLine done={client.agreementSigned} label="Agreement signed" />
              <PrereqLine
                done={client.episodesComplete}
                label={`Modules complete (${client.modulesComplete}/${client.totalModules})`}
              />
              <PrereqLine done={client.icpSubmitted} label="ICP submitted" />
            </ul>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">22-day sprint</div>
              {client.sprintStartedAt ? (
                <div className="text-sm">
                  Started <span className="font-medium text-secondary">{new Date(client.sprintStartedAt).toLocaleDateString()}</span>
                  {client.sprintComplete && <span className="ml-2 text-success font-medium">· complete</span>}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Not started yet</div>
              )}
            </div>

            {sprintNotStarted && !isViewer && (
              <div>
                <Button onClick={startSprint} disabled={!prereqsMet || busy}>
                  <PlayCircle className="w-4 h-4 mr-2" />
                  {busy ? "Starting..." : "Start sprint"}
                </Button>
                {!prereqsMet && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Available once the client has signed the agreement, completed every module,
                    and submitted their ICP.
                  </p>
                )}
                {prereqsMet && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Everything is in. Starting the sprint will begin Day 1 of {22} now.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {client.sprintComplete && (
          <div className="border-t border-border/60 pt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">After the sprint</div>
            <p className="text-sm text-muted-foreground mb-3">
              The 22-day window has finished. Choose what happens next.
            </p>
            {isViewer ? (
              <div className="text-sm">
                {client.postSprintStatus
                  ? STAGE_LABEL[client.postSprintStatus as ClientStage] ?? client.postSprintStatus
                  : "Not set"}
              </div>
            ) : (
              <Select value={postStatus} onValueChange={savePostStatus} disabled={busy}>
                <SelectTrigger className="w-full md:w-[280px]">
                  <SelectValue placeholder="Choose a status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not decided yet</SelectItem>
                  <SelectItem value="monthly">Continuing on monthly retainer</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="offboarded">Offboarded</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type ClientCourseRow = {
  id: number;
  title: string;
  description: string;
  archived: boolean;
  assigned: boolean;
  assignedAt: string | null;
};

function ClientCoursesPanel({ clientId, isViewer }: { clientId: number; isViewer: boolean }) {
  const queryKey = ["admin", "clients", clientId, "courses"] as const;
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<ClientCourseRow[]>({
    queryKey,
    queryFn: () => api<ClientCourseRow[]>(`/admin/clients/${clientId}/courses`),
  });

  // Local draft of the assigned set so the admin can tick multiple boxes
  // and save once, instead of one PUT per click.
  const [draft, setDraft] = useState<Set<number> | null>(null);
  const current = draft ?? new Set((data ?? []).filter((c) => c.assigned).map((c) => c.id));
  const dirty =
    draft !== null &&
    (() => {
      const initial = new Set((data ?? []).filter((c) => c.assigned).map((c) => c.id));
      if (initial.size !== current.size) return true;
      for (const id of initial) if (!current.has(id)) return true;
      return false;
    })();

  const saveMut = useMutation({
    mutationFn: (courseIds: number[]) =>
      api<{ ok: true; added: number; removed: number }>(`/admin/clients/${clientId}/courses`, {
        method: "PUT",
        json: { courseIds },
      }),
    onSuccess: (res) => {
      toast.success(`Saved (+${res.added} / -${res.removed})`);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => toast.error(err.message || "Could not save"),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Assigned courses</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            The client only sees modules from courses on this list.
          </p>
        </div>
        {!isViewer && (
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              disabled={!dirty || saveMut.isPending}
              onClick={() => saveMut.mutate(Array.from(current))}
            >
              {saveMut.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No courses defined yet. Create one from the Courses page.
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            {rows.map((c) => {
              const checked = current.has(c.id);
              return (
                <label
                  key={c.id}
                  className="flex items-start gap-3 p-3 hover:bg-muted/30 cursor-pointer"
                >
                  <Checkbox
                    className="mt-1"
                    checked={checked}
                    disabled={isViewer}
                    onCheckedChange={(v) => {
                      const next = new Set(current);
                      if (v === true) next.add(c.id);
                      else next.delete(c.id);
                      setDraft(next);
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.title}</span>
                      {c.archived && (
                        <Badge variant="secondary" className="text-[10px]">
                          Archived
                        </Badge>
                      )}
                      {c.assigned && (
                        <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">
                          Assigned
                        </Badge>
                      )}
                    </div>
                    {c.description && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">{c.description}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
