import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LifeBuoy, ArrowLeft, CheckCircle2, RotateCcw, Clock, Timer, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import { SupportComposer, AttachmentList, type AttachmentDraft, type RenderedAttachment } from "@/components/SupportComposer";

interface TicketClient {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  businessName: string;
}

interface TicketSummary {
  id: number;
  subject: string;
  status: "open" | "resolved" | string;
  createdAt: string;
  lastMessageAt: string;
  resolvedAt: string | null;
  firstResponseMs: number | null;
  resolutionMs: number | null;
  awaitingReplyMs: number | null;
  lastMessageAuthor: "client" | "admin" | null;
  client: TicketClient | null;
}

interface SupportMetrics {
  windowDays: number;
  totalTickets: number;
  openCount: number;
  resolvedCount: number;
  awaitingReplyCount: number;
  avgFirstResponseMs: number | null;
  medianFirstResponseMs: number | null;
  avgResolutionMs: number | null;
  medianResolutionMs: number | null;
  awaiting: { ticketId: number; subject: string; clientId: number; awaitingReplyMs: number }[];
  perClient: {
    clientId: number;
    clientName: string;
    businessName: string | null;
    ticketCount: number;
    avgFirstResponseMs: number | null;
    avgResolutionMs: number | null;
  }[];
}

/** Render a millisecond duration as a short human string (e.g. "2h 14m"). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

interface TicketMessage {
  id: number;
  authorType: "client" | "admin";
  authorName: string;
  authorEmail: string | null;
  body: string;
  createdAt: string;
  attachments?: RenderedAttachment[];
}

interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
}

export function AdminSupport() {
  const { data: me } = useGetMe();
  const isViewer = me?.role === "viewer";
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  const refresh = async () => {
    const q = filter === "all" ? "" : `?status=${filter}`;
    try {
      const [list, m] = await Promise.all([
        api<TicketSummary[]>(`/admin/support${q}`),
        api<SupportMetrics>(`/admin/support/metrics`).catch(() => null),
      ]);
      setTickets(list);
      if (m) setMetrics(m);
    } catch {
      setTickets([]);
    }
  };

  useEffect(() => { void refresh(); }, [filter]);

  if (activeId !== null) {
    return (
      <AdminTicketView
        ticketId={activeId}
        isViewer={isViewer}
        onBack={() => { setActiveId(null); void refresh(); }}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <LifeBuoy className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support</h1>
          <p className="text-muted-foreground">Conversations with clients.</p>
        </div>
      </div>

      {metrics && <SupportMetricsRow metrics={metrics} />}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tickets</CardTitle>
          <CardDescription>Click a ticket to reply or change its status.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tickets === null ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No tickets.</div>
          ) : (
            <div className="divide-y">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className="w-full text-left p-4 hover:bg-muted/40 transition-colors flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{t.subject}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t.client ? `${t.client.firstName} ${t.client.lastName} · ${t.client.businessName}` : "Unknown client"}
                      {" · "}
                      Last update {new Date(t.lastMessageAt).toLocaleString()}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {t.awaitingReplyMs !== null && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                          <AlertCircle className="w-3 h-3" /> Waiting on us {formatDuration(t.awaitingReplyMs)}
                        </Badge>
                      )}
                      {t.firstResponseMs !== null ? (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="w-3 h-3" /> 1st reply {formatDuration(t.firstResponseMs)}
                        </Badge>
                      ) : t.status === "open" && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                          <Clock className="w-3 h-3" /> No reply yet
                        </Badge>
                      )}
                      {t.resolutionMs !== null && (
                        <Badge variant="outline" className="gap-1">
                          <Timer className="w-3 h-3" /> Resolved in {formatDuration(t.resolutionMs)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "amber" | "default" }) {
  const toneCls = tone === "amber" ? "text-amber-700" : "text-secondary";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function SupportMetricsRow({ metrics }: { metrics: SupportMetrics }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricTile
          label="Avg first response"
          value={formatDuration(metrics.avgFirstResponseMs)}
          hint={`Median ${formatDuration(metrics.medianFirstResponseMs)} · last ${metrics.windowDays}d`}
        />
        <MetricTile
          label="Avg resolution time"
          value={formatDuration(metrics.avgResolutionMs)}
          hint={`Median ${formatDuration(metrics.medianResolutionMs)} · last ${metrics.windowDays}d`}
        />
        <MetricTile
          label="Open tickets"
          value={String(metrics.openCount)}
          hint={`${metrics.resolvedCount} resolved in window`}
        />
        <MetricTile
          label="Awaiting your reply"
          value={String(metrics.awaitingReplyCount)}
          hint={metrics.awaiting[0] ? `Oldest: ${formatDuration(metrics.awaiting[0].awaitingReplyMs)}` : "All caught up"}
          tone={metrics.awaitingReplyCount > 0 ? "amber" : "default"}
        />
      </div>
      {metrics.perClient.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Response times by client</CardTitle>
            <CardDescription>Last {metrics.windowDays} days. Helps spot clients who consistently wait too long.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y text-sm">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs text-muted-foreground">
                <div className="col-span-6">Client</div>
                <div className="col-span-2 text-right">Tickets</div>
                <div className="col-span-2 text-right">Avg 1st reply</div>
                <div className="col-span-2 text-right">Avg resolution</div>
              </div>
              {metrics.perClient.map((c) => (
                <div key={c.clientId} className="grid grid-cols-12 gap-2 px-4 py-2 items-center">
                  <div className="col-span-6 min-w-0">
                    <div className="font-medium truncate">{c.clientName}</div>
                    {c.businessName && <div className="text-xs text-muted-foreground truncate">{c.businessName}</div>}
                  </div>
                  <div className="col-span-2 text-right tabular-nums">{c.ticketCount}</div>
                  <div className="col-span-2 text-right tabular-nums">{formatDuration(c.avgFirstResponseMs)}</div>
                  <div className="col-span-2 text-right tabular-nums">{formatDuration(c.avgResolutionMs)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "resolved") {
    return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Resolved</Badge>;
  }
  return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Open</Badge>;
}

function AdminTicketView({ ticketId, onBack, isViewer }: { ticketId: number; onBack: () => void; isViewer: boolean }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const t = await api<TicketDetail>(`/admin/support/${ticketId}`);
      setTicket(t);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load ticket");
    }
  };

  useEffect(() => { void load(); }, [ticketId]);

  const send = async (body: string, attachments: AttachmentDraft[]) => {
    await api(`/admin/support/${ticketId}/messages`, {
      method: "POST",
      json: { body, attachments },
    });
    await load();
  };

  const setStatus = async (status: "open" | "resolved") => {
    setBusy(true);
    try {
      await api(`/admin/support/${ticketId}`, { method: "PATCH", json: { status } });
      toast.success(status === "resolved" ? "Marked as resolved" : "Reopened");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update status";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-3xl">
      <Button variant="ghost" onClick={onBack} className="-ml-3 text-muted-foreground">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to inbox
      </Button>
      {ticket === null ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                {ticket.client && `${ticket.client.firstName} ${ticket.client.lastName} <${ticket.client.email}>`}
                {" · Opened "}{new Date(ticket.createdAt).toLocaleString()}
                {ticket.resolvedAt && ` · Resolved ${new Date(ticket.resolvedAt).toLocaleString()}`}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {ticket.awaitingReplyMs !== null && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                    <AlertCircle className="w-3 h-3" /> Waiting on us {formatDuration(ticket.awaitingReplyMs)}
                  </Badge>
                )}
                {ticket.firstResponseMs !== null ? (
                  <Badge variant="outline" className="gap-1">
                    <Clock className="w-3 h-3" /> 1st reply in {formatDuration(ticket.firstResponseMs)}
                  </Badge>
                ) : ticket.status === "open" && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                    <Clock className="w-3 h-3" /> No team reply yet
                  </Badge>
                )}
                {ticket.resolutionMs !== null && (
                  <Badge variant="outline" className="gap-1">
                    <Timer className="w-3 h-3" /> Resolved in {formatDuration(ticket.resolutionMs)}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={ticket.status} />
              {!isViewer && (
                ticket.status === "resolved" ? (
                  <Button size="sm" variant="outline" onClick={() => void setStatus("open")} disabled={busy}>
                    <RotateCcw className="w-4 h-4 mr-2" /> Reopen
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void setStatus("resolved")} disabled={busy}>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Resolve
                  </Button>
                )
              )}
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div ref={scrollRef} className="max-h-[55vh] overflow-y-auto p-4 space-y-3">
                {ticket.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.authorType === "admin" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm border ${m.authorType === "admin" ? "bg-primary text-primary-foreground border-primary/40" : "bg-muted text-foreground border-border"}`}>
                      <div className={`text-[11px] font-medium opacity-80 mb-0.5 ${m.authorType === "admin" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {m.authorName} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <AttachmentList items={m.attachments ?? []} />
                    </div>
                  </div>
                ))}
                {ticket.messages.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-12">
                    No messages yet.
                  </div>
                )}
              </div>
              {!isViewer && (
                <SupportComposer onSend={send} disabled={busy} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
