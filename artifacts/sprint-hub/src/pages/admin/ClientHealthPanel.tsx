import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";

interface HealthSignals {
  daysSinceInvite: number | null;
  daysSinceLastLogin: number | null;
  tutorialCompleted: boolean;
  termsAccepted: boolean;
  icpSubmitted: boolean;
  icpDaysToSubmit: number | null;
  agreements: { assigned: number; signed: number; avgDaysToSign: number | null; maxDaysWaiting: number | null };
  episodes: { total: number; completed: number; percentComplete: number; daysSinceLastWatch: number | null; everStarted: boolean };
  support: { totalTickets: number; openTickets: number; ratedTickets: number; avgResolutionRating: number | null; avgProcessRating: number | null };
  sprint: { started: boolean; daysSinceStart: number | null; postSprintStatus: string | null };
}

interface HealthDetail {
  score: number;
  tone: "green" | "amber" | "red";
  headline: string;
  flags: string[];
  positives: string[];
  narrative: string;
  generatedAt: string;
  signals: HealthSignals;
}

const TONE_COLORS: Record<HealthDetail["tone"], { bg: string; text: string; border: string; label: string }> = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Strong" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Watch" },
  red: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", label: "At risk" },
};

export function ClientHealthPanel({ clientId }: { clientId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<HealthDetail>({
    queryKey: ["admin-client-health", clientId],
    queryFn: () => api(`/admin/clients/${clientId}/health`),
    enabled: !!clientId,
  });
  const refresh = useMutation({
    mutationFn: () => api<HealthDetail>(`/admin/clients/${clientId}/health?refresh=1`),
    onSuccess: (fresh) => {
      qc.setQueryData(["admin-client-health", clientId], fresh);
      toast.success("Health summary refreshed");
    },
    onError: () => toast.error("Could not refresh health summary"),
  });

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;

  const tone = TONE_COLORS[data.tone];
  const s = data.signals;
  const fmtDays = (d: number | null) => (d === null ? "—" : `${d}d`);

  return (
    <div className="space-y-4">
      <Card className={`border-2 ${tone.border}`}>
        <CardHeader className={`${tone.bg}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`text-4xl font-bold ${tone.text}`}>{data.score}</div>
              <div>
                <div className={`text-xs font-semibold uppercase tracking-wide ${tone.text}`}>{tone.label}</div>
                <CardTitle className="text-lg">{data.headline}</CardTitle>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              title="Recompute the score and ask the AI for a fresh narrative"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Sparkles className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <p className="leading-relaxed">{data.narrative}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Watch ({data.flags.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.flags.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No risk signals.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-amber-600 mt-1">•</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Positives ({data.positives.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.positives.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No positive signals yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.positives.map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-emerald-600 mt-1">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" /> Signal breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <SignalCell label="Last login" value={fmtDays(s.daysSinceLastLogin)} hint="ago" />
            <SignalCell
              label="ICP"
              value={s.icpSubmitted ? "Submitted" : "Outstanding"}
              hint={s.icpSubmitted ? (s.icpDaysToSubmit !== null ? `in ${s.icpDaysToSubmit}d` : undefined) : undefined}
            />
            <SignalCell
              label="Agreements"
              value={`${s.agreements.signed} / ${s.agreements.assigned}`}
              hint={
                s.agreements.maxDaysWaiting !== null
                  ? `oldest waiting ${s.agreements.maxDaysWaiting}d`
                  : s.agreements.avgDaysToSign !== null
                    ? `avg ${s.agreements.avgDaysToSign}d to sign`
                    : undefined
              }
            />
            <SignalCell
              label="Episodes"
              value={`${s.episodes.percentComplete}%`}
              hint={`${s.episodes.completed} / ${s.episodes.total}`}
            />
            <SignalCell label="Last watched" value={fmtDays(s.episodes.daysSinceLastWatch)} hint="ago" />
            <SignalCell
              label="Support"
              value={`${s.support.totalTickets} tickets`}
              hint={s.support.openTickets > 0 ? `${s.support.openTickets} open` : undefined}
            />
            <SignalCell
              label="Resolution rating"
              value={s.support.avgResolutionRating !== null ? `${s.support.avgResolutionRating.toFixed(1)} / 5` : "—"}
              hint={s.support.ratedTickets ? `${s.support.ratedTickets} rated` : undefined}
              icon={<Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
            />
            <SignalCell
              label="Process rating"
              value={s.support.avgProcessRating !== null ? `${s.support.avgProcessRating.toFixed(1)} / 5` : "—"}
              icon={<Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
            />
            <SignalCell
              label="Sprint"
              value={
                s.sprint.postSprintStatus
                  ? cap(s.sprint.postSprintStatus)
                  : s.sprint.started
                    ? `Day ${s.sprint.daysSinceStart}`
                    : "Not started"
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SignalCell({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold flex items-center gap-1.5 mt-0.5">
        {icon}
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface HealthRow {
  clientId: number;
  firstName: string;
  lastName: string;
  email: string;
  businessName: string;
  status: string;
  score: number;
  tone: "green" | "amber" | "red";
  headline: string;
  topFlag: string | null;
}

export interface HealthListResponse {
  green: number;
  amber: number;
  red: number;
  attention: HealthRow[];
}

export function ClientHealthDashboardCard() {
  const { data, isLoading } = useQuery<HealthListResponse>({
    queryKey: ["admin-client-health-list"],
    queryFn: () => api("/admin/clients/health"),
  });

  if (isLoading || !data) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Client health</CardTitle>
            <p className="text-xs text-muted-foreground">Behavioural intelligence across the roster</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <ToneTile tone="green" count={data.green} />
          <ToneTile tone="amber" count={data.amber} />
          <ToneTile tone="red" count={data.red} />
        </div>

        {data.attention.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Needs attention
            </div>
            <div className="divide-y rounded-md border">
              {data.attention.slice(0, 5).map((row) => (
                <a
                  key={row.clientId}
                  href={`/admin/clients/${row.clientId}`}
                  className="block p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">
                        {row.firstName} {row.lastName}
                        <span className="text-muted-foreground font-normal ml-1.5">· {row.businessName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {row.topFlag ?? row.headline}
                      </div>
                    </div>
                    <ScoreBadge score={row.score} tone={row.tone} />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToneTile({ tone, count }: { tone: HealthDetail["tone"]; count: number }) {
  const t = TONE_COLORS[tone];
  return (
    <div className={`rounded-lg border-2 ${t.border} ${t.bg} p-3 text-center`}>
      <div className={`text-3xl font-bold ${t.text}`}>{count}</div>
      <div className={`text-xs font-semibold uppercase tracking-wide ${t.text} mt-0.5`}>{t.label}</div>
    </div>
  );
}

function ScoreBadge({ score, tone }: { score: number; tone: HealthDetail["tone"] }) {
  const t = TONE_COLORS[tone];
  return (
    <Badge variant="outline" className={`${t.bg} ${t.text} ${t.border} font-semibold`}>
      {score}
    </Badge>
  );
}
