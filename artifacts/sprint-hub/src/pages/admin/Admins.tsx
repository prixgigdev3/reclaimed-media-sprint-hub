import { useState } from "react";
import { useListAdminUsers, useInviteAdminUser, useUpdateAdminUserRole, useDeleteAdminUser, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND_NAME } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Shield, Plus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import type { InviteAdminBodyRole, UpdateAdminRoleBodyRole } from "@workspace/api-client-react";

const ALL_SCOPES: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "clients", label: "Clients" },
  { key: "content", label: "Content" },
  { key: "agreements", label: "Agreements" },
  { key: "analytics", label: "Analytics" },
  { key: "support", label: "Support" },
  { key: "settings", label: "Settings" },
  { key: "admins", label: "Admins" },
];

function scopeLabel(scopes: string[] | undefined | null): string {
  const arr = scopes ?? [];
  if (arr.length === 0) return "Full access";
  if (arr.length === 1) return ALL_SCOPES.find((s) => s.key === arr[0])?.label ?? arr[0];
  return `${arr.length} scopes`;
}

export function AdminUsers() {
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.role === "super_admin";

  const { data: users, isLoading } = useListAdminUsers();
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const inviteMutation = useInviteAdminUser({
    mutation: {
      onSuccess: () => {
        toast.success("Admin invited");
        setIsInviteOpen(false);
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      },
      onError: () => toast.error("Failed to invite")
    }
  });

  const updateRoleMutation = useUpdateAdminUserRole({
    mutation: {
      onSuccess: () => {
        toast.success("Role updated");
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      }
    }
  });

  const deleteMutation = useDeleteAdminUser({
    mutation: {
      onSuccess: () => {
        toast.success("Admin removed");
        queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      }
    }
  });

  const handleInvite = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    inviteMutation.mutate({
      data: {
        email: fd.get("email") as string,
        name: fd.get("name") as string,
        role: fd.get("role") as InviteAdminBodyRole
      }
    });
  };

  const getRoleBadge = (role: string) => {
    switch(role) {
      case 'super_admin': return <Badge className="bg-secondary">Super Admin</Badge>;
      case 'admin': return <Badge variant="default">Admin</Badge>;
      case 'viewer': return <Badge variant="outline">Viewer</Badge>;
      default: return <Badge>{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-secondary">Operator Accounts</h1>
          <p className="text-muted-foreground mt-1">Manage who has access to the {BRAND_NAME} admin panel.</p>
        </div>

        {isSuperAdmin && (
          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" /> Invite Operator</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite New Operator</DialogTitle>
                <DialogDescription>They will receive an email to log in.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label>Name (Optional)</Label>
                  <Input name="name" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input name="email" type="email" required />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select name="role" defaultValue="admin">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="super_admin">Super Admin (Full access + API Keys + Admins)</SelectItem>
                      <SelectItem value="admin">Admin (Manage clients & content)</SelectItem>
                      <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsInviteOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={inviteMutation.isPending}>Send Invite</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="border rounded-md bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Added</TableHead>
              {isSuperAdmin && <TableHead className="w-[100px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3].map(i => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  {isSuperAdmin && <TableCell></TableCell>}
                </TableRow>
              ))
            ) : users?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No accounts found.</TableCell>
              </TableRow>
            ) : (
              users?.map(user => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-medium text-secondary">{user.name || 'Pending...'}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </TableCell>
                  <TableCell>
                    {isSuperAdmin && user.userId !== me?.user?.id ? (
                       <Select 
                        defaultValue={user.role} 
                        onValueChange={(v) => updateRoleMutation.mutate({ id: user.id, data: { role: v as UpdateAdminRoleBodyRole }})}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      getRoleBadge(user.role)
                    )}
                  </TableCell>
                  <TableCell>
                    {isSuperAdmin && user.role !== 'super_admin' && user.userId !== me?.user?.id ? (
                      <ScopesEditor
                        userId={user.id}
                        initial={user.scopes ?? []}
                        onSaved={() => queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() })}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {user.role === 'super_admin' ? 'Full access' : scopeLabel(user.scopes)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell>
                      {user.userId !== me?.user?.id && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            if(confirm("Remove this admin?")) deleteMutation.mutate({ id: user.id });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ScopesEditor({ userId, initial, onSaved }: { userId: number; initial: string[]; onSaved: () => void }) {
  const [scopes, setScopes] = useState<string[]>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) => {
    setScopes((cur) => cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api(`/admin/admins/${userId}/scopes`, { method: "PATCH", json: { scopes } });
      toast.success("Scopes updated");
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setScopes(initial); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          {scopeLabel(scopes)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="text-xs text-muted-foreground mb-3">
          Empty = full access. Pick areas to restrict this operator to.
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {ALL_SCOPES.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={scopes.includes(s.key)}
                onCheckedChange={() => toggle(s.key)}
              />
              {s.label}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
