import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

function fmt(secs: number) {
  if (!secs) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface Analytics {
  client: { id: number; firstName: string; lastName: string; lastLoginAt: string | null };
  summary: {
    loginCount: number; lastLoginAt: string | null; totalEpisodes: number;
    completedEpisodes: number; progressPercent: number; totalWatchSeconds: number;
  };
  agreements: { total: number; pending: number; clientSigned: number; completed: number };
  episodes: Array<{ episodeId: number; title: string; completed: boolean; positionSeconds: number; durationSeconds: number; watchCount: number; lastWatchedAt: string | null }>;
  logins: Array<{ id: number; createdAt: string; ip: string | null }>;
  recentActivity: Array<{ id: number; kind: string; message: string; createdAt: string; ip: string | null }>;
}

interface AssignmentRow {
  id: number; status: string; hasSignedPdf: boolean; assignedAt: string; completedAt: string | null;
  template: { title: string } | null;
}

export function ClientAnalyticsPanel({ clientId }: { clientId: number }) {
  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ["admin-client-analytics", clientId],
    queryFn: () => api(`/admin/clients/${clientId}/analytics`),
    enabled: !!clientId,
  });

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Logins" value={String(s.loginCount)} sub={s.lastLoginAt ? `Last ${new Date(s.lastLoginAt).toLocaleDateString()}` : "Never"} />
        <Stat label="Episode progress" value={`${s.completedEpisodes}/${s.totalEpisodes}`} sub={`${s.progressPercent}% complete`} />
        <Stat label="Watch time" value={fmt(s.totalWatchSeconds)} />
        <Stat label="Agreements" value={`${data.agreements.completed}/${data.agreements.total}`} sub={`${data.agreements.pending} pending`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Episodes</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {data.episodes.map((e) => (
              <div key={e.episodeId} className="px-4 py-2 flex items-center justify-between text-sm">
                <span className="truncate">{e.title}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{fmt(e.positionSeconds)}{e.durationSeconds ? ` / ${fmt(e.durationSeconds)}` : ""}</span>
                  <span>{e.watchCount}× viewed</span>
                  {e.completed && <Badge variant="outline" className="bg-success/10 text-success border-success/20">Done</Badge>}
                </div>
              </div>
            ))}
            {data.episodes.length === 0 && <div className="p-4 text-sm text-muted-foreground">No episodes.</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent logins</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {data.logins.length === 0 && <div className="p-4 text-sm text-muted-foreground">No logins recorded.</div>}
            {data.logins.slice(0, 10).map((l) => (
              <div key={l.id} className="px-4 py-2 flex items-center justify-between text-sm">
                <span>{new Date(l.createdAt).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">{l.ip || "-"}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ClientActivityPanel({ clientId }: { clientId: number }) {
  const { data, isLoading } = useQuery<Array<{ id: number; kind: string; message: string; createdAt: string; ip: string | null; actorEmail: string | null }>>({
    queryKey: ["admin-client-activity", clientId],
    queryFn: () => api(`/admin/clients/${clientId}/activity`),
    enabled: !!clientId,
  });
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {data.length === 0 && <div className="p-4 text-sm text-muted-foreground">No activity recorded.</div>}
          {data.map((a) => (
            <div key={a.id} className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span><span className="font-medium uppercase text-[10px] tracking-wider mr-2">{a.kind}</span>{a.message}</span>
                <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              {(a.ip || a.actorEmail) && (
                <div className="text-xs text-muted-foreground mt-0.5">{a.actorEmail} {a.ip ? `· ${a.ip}` : ""}</div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ClientAgreementsPanel({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [tplId, setTplId] = useState<string>("");
  const { data, isLoading } = useQuery<AssignmentRow[]>({
    queryKey: ["admin-client-agreements", clientId],
    queryFn: () => api(`/admin/agreements/assignments?clientId=${clientId}`),
    enabled: !!clientId,
  });
  const { data: templates } = useQuery<Array<{ id: number; title: string }>>({
    queryKey: ["admin-agreement-templates"],
    queryFn: () => api("/admin/agreements/templates"),
  });
  const assignM = useMutation({
    mutationFn: () => api("/admin/agreements/assignments", { method: "POST", json: { templateId: Number(tplId), clientId } }),
    onSuccess: () => {
      toast.success("Agreement assigned");
      setOpen(false);
      setTplId("");
      qc.invalidateQueries({ queryKey: ["admin-client-agreements", clientId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-2" /> Assign agreement</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign agreement</DialogTitle></DialogHeader>
            <Select value={tplId} onValueChange={setTplId}>
              <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {templates?.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button onClick={() => assignM.mutate()} disabled={!tplId || assignM.isPending}>Assign</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {!data || data.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No agreements assigned.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {data.map((a) => (
            <Card key={a.id} className="cursor-pointer hover:border-primary" onClick={() => setLocation(`/admin/agreements/assignments/${a.id}`)}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{a.template?.title ?? "Agreement"}</div>
                  <div className="text-xs text-muted-foreground">Sent {new Date(a.assignedAt).toLocaleDateString()}</div>
                </div>
                <Badge variant={a.status === "completed" ? "default" : "secondary"}>{a.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
