import { useState } from "react";
import { useListAdminClients, useCreateAdminClient, getListAdminClientsQueryKey, getGetAdminDashboardQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Plus } from "lucide-react";
import { StageBadge } from "@/lib/clientStage";
import { Checkbox } from "@/components/ui/checkbox";

export function AdminClients() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [agreementTemplateId, setAgreementTemplateId] = useState<string>("");
  const [agreementPreSigned, setAgreementPreSigned] = useState(false);
  const [selectedCourseIds, setSelectedCourseIds] = useState<number[]>([]);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Templates the admin can optionally assign at the moment of inviting a
  // client — populated once the dialog opens.
  const { data: agreementTemplates } = useQuery<Array<{ id: number; title: string; kind: string }>>({
    queryKey: ["admin-agreement-templates"],
    queryFn: () => api("/admin/agreements/templates"),
    enabled: isCreateOpen,
  });

  // Available courses for assignment at invite time. Archived courses are
  // hidden — admins must un-archive to assign them to new clients.
  const { data: availableCourses } = useQuery<Array<{ id: number; title: string; archived: boolean }>>({
    queryKey: ["admin", "courses"],
    queryFn: () => api("/admin/courses"),
    enabled: isCreateOpen,
  });

  const { data: clients, isLoading } = useListAdminClients({
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: search.length > 2 ? search : undefined,
  }, {
    query: {
      queryKey: getListAdminClientsQueryKey({ status: statusFilter !== "all" ? statusFilter : undefined, search: search.length > 2 ? search : undefined })
    }
  });

  const createMutation = useCreateAdminClient({
    mutation: {
      onSuccess: async (created) => {
        // Initial agreement is required. Assign it now; if assignment fails,
        // roll back the just-created client so we never leave one without
        // their required agreement.
        if (!agreementTemplateId || !created?.id) {
          toast.error("Missing agreement template");
          return;
        }
        try {
          await api("/admin/agreements/assignments", {
            method: "POST",
            json: {
              templateId: Number(agreementTemplateId),
              clientId: created.id,
              preSigned: agreementPreSigned,
            },
          });
          // Course assignments are best-effort: if courses fail to attach we
          // surface the error but keep the client (they can be added later
          // from the client detail page). Agreement is the only hard gate.
          if (selectedCourseIds.length > 0) {
            try {
              await api(`/admin/clients/${created.id}/courses`, {
                method: "PUT",
                json: { courseIds: selectedCourseIds },
              });
              toast.success(
                agreementPreSigned
                  ? `Client invited (agreement marked as already signed) + ${selectedCourseIds.length} course(s) assigned`
                  : `Client invited, agreement + ${selectedCourseIds.length} course(s) assigned`,
              );
            } catch (err) {
              toast.warning(
                `Client invited and agreement assigned, but courses could not be attached: ${(err as Error).message}. Add them from the client's page.`,
              );
            }
          } else {
            toast.success(
              agreementPreSigned
                ? "Client invited and agreement marked as already signed"
                : "Client invited and agreement assigned",
            );
          }
          // If the welcome email failed (e.g. Resend domain not verified),
          // the API still creates the client but stamps a warning. Surface
          // it loudly so the operator knows to fix it & Resend Invite.
          if (created.inviteEmailWarning) {
            toast.warning("Welcome email did not send", {
              description: created.inviteEmailWarning,
              duration: 10000,
            });
          }
        } catch (err) {
          try {
            await api(`/admin/clients/${created.id}`, { method: "DELETE" });
          } catch { /* ignore */ }
          toast.error(`Could not assign agreement: ${(err as Error).message}. Client creation rolled back.`);
          queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
          return;
        }
        setIsCreateOpen(false);
        setAgreementTemplateId("");
        setAgreementPreSigned(false);
        setSelectedCourseIds([]);
        queryClient.invalidateQueries({ queryKey: getListAdminClientsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
      },
      onError: () => {
        toast.error("Failed to create client");
      }
    }
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!agreementTemplateId) {
      toast.error("Please select an initial agreement template");
      return;
    }
    const formData = new FormData(e.currentTarget);
    createMutation.mutate({
      data: {
        first_name: formData.get("firstName") as string,
        last_name: formData.get("lastName") as string,
        email: formData.get("email") as string,
        business_name: formData.get("businessName") as string,
        phone: formData.get("phone") as string,
        sprint_start_date: formData.get("sprintStartDate") as string || undefined,
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-success hover:bg-success/90">Active</Badge>;
      case 'invited': return <Badge variant="secondary">Invited</Badge>;
      case 'revoked': return <Badge variant="destructive">Revoked</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-secondary">Clients</h1>
          <p className="text-muted-foreground mt-1">Manage your agency clients and their sprint access.</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Add Client</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite New Client</DialogTitle>
              <DialogDescription>This will create an account and send an invitation email.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" name="firstName" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" name="lastName" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name</Label>
                <Input id="businessName" name="businessName" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (Optional)</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sprintStartDate">Sprint Start Date (Optional)</Label>
                <Input id="sprintStartDate" name="sprintStartDate" type="date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agreementTemplate">Initial agreement <span className="text-destructive">*</span></Label>
                <Select value={agreementTemplateId} onValueChange={setAgreementTemplateId} required>
                  <SelectTrigger id="agreementTemplate">
                    <SelectValue placeholder="Select an agreement template" />
                  </SelectTrigger>
                  <SelectContent>
                    {(agreementTemplates ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No templates yet — create one from Agreements.</div>
                    ) : (
                      (agreementTemplates ?? []).map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.title} {t.kind === "builder" ? "(builder)" : "(uploaded PDF)"}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If selected, the agreement will be ready for the client to sign on first login.
                </p>
                <label className="flex items-start gap-3 mt-2 px-3 py-2 rounded-md border border-amber-200 bg-amber-50 cursor-pointer">
                  <Checkbox
                    checked={agreementPreSigned}
                    onCheckedChange={(v) => setAgreementPreSigned(v === true)}
                    className="mt-0.5"
                  />
                  <div className="text-sm">
                    <div className="font-medium text-amber-900">Client has already signed this agreement</div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Skips the in-platform signing step. The client will land straight on their sprint
                      content instead of being shown the agreement to review and sign on first login.
                      An audit event is still recorded that you marked it as already signed.
                    </div>
                  </div>
                </label>
              </div>
              <div className="space-y-2">
                <Label>Courses (optional)</Label>
                <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                  {(availableCourses ?? []).filter((c) => !c.archived).length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No courses yet — create one from the Courses page.
                    </div>
                  ) : (
                    (availableCourses ?? [])
                      .filter((c) => !c.archived)
                      .map((c) => {
                        const checked = selectedCourseIds.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                if (v === true) {
                                  setSelectedCourseIds((prev) => [...prev, c.id]);
                                } else {
                                  setSelectedCourseIds((prev) => prev.filter((id) => id !== c.id));
                                }
                              }}
                            />
                            <span className="text-sm">{c.title}</span>
                          </label>
                        );
                      })
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pick which courses this client can see. You can change this later on the client's page.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Inviting..." : "Invite Client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name, email, or business..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All access</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Agreement</TableHead>
              <TableHead>Modules</TableHead>
              <TableHead>ICP</TableHead>
              <TableHead>Sprint started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5].map(i => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                </TableRow>
              ))
            ) : clients?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No clients found.
                </TableCell>
              </TableRow>
            ) : (
              clients?.map((client, index) => (
                <TableRow 
                  key={client.id} 
                  className="cursor-pointer hover:bg-muted/50 transition-colors animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
                  onClick={() => setLocation(`/admin/clients/${client.id}`)}
                >
                  <TableCell>
                    <div className="font-medium text-secondary">{client.firstName} {client.lastName}</div>
                    <div className="text-xs text-muted-foreground">{client.email}</div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {client.businessName}
                    <div className="mt-1">{getStatusBadge(client.status)}</div>
                  </TableCell>
                  <TableCell><StageBadge stage={client.stage} /></TableCell>
                  <TableCell>
                    {client.agreementSigned ? (
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">Signed</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">Not signed</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{client.modulesComplete}</span>
                    <span className="text-xs text-muted-foreground"> / {client.totalModules}</span>
                  </TableCell>
                  <TableCell>
                    {client.icpSubmitted ? (
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">Received</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {client.sprintStartedAt ? new Date(client.sprintStartedAt).toLocaleDateString() : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
