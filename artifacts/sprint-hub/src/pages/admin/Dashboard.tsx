import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetAdminDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, FileText, UserX, Calendar, ArrowRight, LifeBuoy, Clock, Timer, AlertCircle, TrendingUp, Eye, FileSignature, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDuration } from "./Support";
import { ClientHealthDashboardCard } from "./ClientHealthPanel";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Engagement overview, formerly its own Analytics page — now merged
// into the dashboard so all top-level operating metrics live in one
// place. Endpoint stays the same: GET /admin/analytics/overview.
interface AnalyticsOverview {
  totalClients: number;
  activeClients: number;
  loginsLast7Days: number;
  totalEpisodes: number;
  totalWatchSeconds: number;
  agreements: { total: number; pending: number; completed: number };
}

function fmtDuration(secs: number) {
  if (!secs) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface SupportMetrics {
  windowDays: number;
  openCount: number;
  resolvedCount: number;
  awaitingReplyCount: number;
  avgFirstResponseMs: number | null;
  medianFirstResponseMs: number | null;
  avgResolutionMs: number | null;
  medianResolutionMs: number | null;
  awaiting: { ticketId: number; subject: string; clientId: number; awaitingReplyMs: number }[];
}

export function AdminDashboard() {
  const { data, isLoading } = useGetAdminDashboard();
  const { data: analytics } = useQuery<AnalyticsOverview>({
    queryKey: ["admin-analytics-overview"],
    queryFn: () => api("/admin/analytics/overview"),
  });
  const [support, setSupport] = useState<SupportMetrics | null>(null);
  useEffect(() => {
    void api<SupportMetrics>("/admin/support/metrics")
      .then(setSupport)
      .catch(() => setSupport(null));
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="md:col-span-2 h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-secondary">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your agency sprint operations.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/clients">
            <Button variant="outline">Manage Clients</Button>
          </Link>
          <Link href="/admin/content">
            <Button>Manage Content</Button>
          </Link>
        </div>
      </div>

      {/* Top KPI row. Each tile owns one canonical signal — we deliberately
          do not show "active clients" as a separate card here because it
          already lives as a hint under "Total Clients". This is the rule we
          now enforce across the dashboard: one number, one place. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Clients"
          value={data.totalClients}
          hint={analytics ? `${analytics.activeClients} active` : undefined}
          icon={<Users className="w-4 h-4 text-muted-foreground" />}
        />
        <KpiCard
          label="ICPs Submitted"
          value={data.icpSubmittedCount}
          icon={<FileText className="w-4 h-4 text-muted-foreground" />}
        />
        <KpiCard
          label="Not Logged In"
          value={data.notLoggedInCount}
          icon={<UserX className="w-4 h-4 text-muted-foreground" />}
        />
        <KpiCard
          label="Sprints Starting This Week"
          value={data.sprintsThisWeek}
          icon={<Calendar className="w-4 h-4 text-muted-foreground" />}
        />
      </div>

      {/* Hero growth chart, promoted to sit right under the KPIs so the
          headline trend is the first thing an admin sees on load. The
          component-level breakdowns sit as chips beneath the chart so they
          stay discoverable without competing with the headline. */}
      <GrowthChartCard data={data.growthSeries ?? []} />

      {/* Engagement detail. "Total clients" deliberately lives in the KPI
          row above and is NOT repeated here. The remaining three stats are
          the ones not surfaced anywhere else. */}
      {analytics && (
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Engagement</CardTitle>
            <CardDescription>Activity and agreement signal across all clients.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <DashboardMetric
                icon={<Eye className="w-4 h-4" />}
                label="Logins (7d)"
                value={String(analytics.loginsLast7Days)}
              />
              <DashboardMetric
                icon={<Clock className="w-4 h-4" />}
                label="Total watch time"
                value={fmtDuration(analytics.totalWatchSeconds)}
              />
              <DashboardMetric
                icon={<FileSignature className="w-4 h-4" />}
                label="Agreements"
                value={String(analytics.agreements.total)}
                hint={`${analytics.agreements.completed} signed · ${analytics.agreements.pending} pending`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <ClientHealthDashboardCard />

      {support && <SupportSummaryCard support={support} />}

      {/* Recent activity feed — full-width now that the chart owns its
          own row. Caps to 5 entries with a "See more" link to the full
          feed under /admin/activity. */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xl">Recent Activity</CardTitle>
          <Link href="/admin/activity">
            <Button variant="ghost" size="sm" className="text-xs">
              See more <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <div className="text-muted-foreground italic py-12 text-center">
              No client activity yet.
            </div>
          ) : (
            <div className="space-y-5">
              {data.recentActivity.slice(0, 5).map((event) => (
                <div key={event.id} className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full p-1.5 bg-muted shrink-0">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground break-words">{event.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(event.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {event.clientId && (
                    <Link href={`/admin/clients/${event.clientId}`}>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0">
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Single canonical KPI tile shape used across the top row. Centralised so
// adding a new top-line metric is a one-liner and we never end up with two
// slightly-different KPI cards diverging in style.
function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-secondary">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// Hero engagement chart, restyled to match the reference (Mercury-style):
// big headline number, soft single-color smoothed area, axis chrome stripped
// out, deltas surfaced explicitly so the chart "tells the story at a glance".
//
// We aggregate the four daily signals (new clients, ICPs, episode
// completions, logins) into one "interactions" series for the headline
// trend, and keep each component visible as a colored chip below the chart.
// This is the same data the old stacked-area chart drew, just re-arranged
// so one number leads the eye and the breakdowns are an afterthought.
//
// Trend delta compares the second half of the window to the first half,
// using only data we already have — no fake "vs previous period" call.
interface GrowthPoint {
  date: string;
  newClients: number;
  icpSubmissions: number;
  episodesCompleted: number;
  clientLogins: number;
}

function GrowthChartCard({ data }: { data: GrowthPoint[] }) {
  const series = data.map((d) => ({
    date: d.date,
    total: d.newClients + d.icpSubmissions + d.episodesCompleted + d.clientLogins,
  }));
  const totals = data.reduce(
    (acc, d) => {
      acc.newClients += d.newClients;
      acc.icpSubmissions += d.icpSubmissions;
      acc.episodesCompleted += d.episodesCompleted;
      acc.clientLogins += d.clientLogins;
      return acc;
    },
    { newClients: 0, icpSubmissions: 0, episodesCompleted: 0, clientLogins: 0 },
  );
  const total =
    totals.newClients + totals.icpSubmissions + totals.episodesCompleted + totals.clientLogins;
  const isEmpty = total === 0;

  // Half-vs-half momentum check. With ~30 days of data this is "last
  // fortnight vs preceding fortnight" — honest math, no API change needed.
  const half = Math.max(1, Math.floor(series.length / 2));
  const firstHalf = series.slice(0, half).reduce((s, p) => s + p.total, 0);
  const secondHalf = series.slice(half).reduce((s, p) => s + p.total, 0);
  const delta = secondHalf - firstHalf;

  const fmtTick = (v: string) => {
    const d = new Date(v + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  };

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Engagement growth
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-secondary tracking-tight tabular-nums">
                {total.toLocaleString()}
              </span>
              <span className="text-base font-normal text-muted-foreground">interactions</span>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">Last 30 days</div>
          </div>
          {!isEmpty && (
            <div className="text-sm">
              {delta >= 0 ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                  <ArrowUpRight className="w-4 h-4" /> +{delta.toLocaleString()} vs prior 15 days
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                  <ArrowDownRight className="w-4 h-4" /> {delta.toLocaleString()} vs prior 15 days
                </span>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isEmpty ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground italic text-sm">
            No client activity in the last 30 days yet — once clients start engaging it'll show up here.
          </div>
        ) : (
          <div className="h-56 w-full -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="g-engagement" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtTick}
                  tick={{ fontSize: 11, fill: "#94A3B8" }}
                  interval="preserveStartEnd"
                  minTickGap={64}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ stroke: "#CBD5E1", strokeDasharray: "3 3" }}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid #E2E8F0",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                  labelFormatter={(label: string) =>
                    new Date(label + "T00:00:00Z").toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })
                  }
                  formatter={(v: number) => [`${v} interactions`, "Total"]}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#6366F1"
                  strokeWidth={2}
                  fill="url(#g-engagement)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 pt-4 border-t">
          <ChartChip label="New clients" value={totals.newClients} color="#4451a0" />
          <ChartChip label="ICPs" value={totals.icpSubmissions} color="#0F172A" />
          <ChartChip label="Modules done" value={totals.episodesCompleted} color="#10B981" />
          <ChartChip label="Logins" value={totals.clientLogins} color="#6366F1" />
        </div>
      </CardContent>
    </Card>
  );
}

function ChartChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-muted-foreground truncate">{label}</span>
      <span className="text-sm font-semibold text-foreground ml-auto tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function DashboardMetric({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "amber" }) {
  const toneCls = tone === "amber" ? "text-amber-700" : "text-secondary";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function SupportSummaryCard({ support }: { support: SupportMetrics }) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Support response times</CardTitle>
            <CardDescription>Last {support.windowDays} days</CardDescription>
          </div>
        </div>
        <Link href="/admin/support">
          <Button variant="ghost" size="sm">Open inbox <ArrowRight className="w-3 h-3 ml-1" /></Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <DashboardMetric
            icon={<Clock className="w-4 h-4" />}
            label="Avg first response"
            value={formatDuration(support.avgFirstResponseMs)}
            hint={`Median ${formatDuration(support.medianFirstResponseMs)}`}
          />
          <DashboardMetric
            icon={<Timer className="w-4 h-4" />}
            label="Avg resolution"
            value={formatDuration(support.avgResolutionMs)}
            hint={`Median ${formatDuration(support.medianResolutionMs)}`}
          />
          <DashboardMetric
            icon={<LifeBuoy className="w-4 h-4" />}
            label="Open tickets"
            value={String(support.openCount)}
            hint={`${support.resolvedCount} resolved in window`}
          />
          <DashboardMetric
            icon={<AlertCircle className="w-4 h-4" />}
            label="Awaiting your reply"
            value={String(support.awaitingReplyCount)}
            hint={support.awaiting[0] ? `Oldest: ${formatDuration(support.awaiting[0].awaitingReplyMs)}` : "All caught up"}
            tone={support.awaitingReplyCount > 0 ? "amber" : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}
