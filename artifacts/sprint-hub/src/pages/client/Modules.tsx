import { useListClientModules, useGetClientDashboard } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, CheckCircle2, PlayCircle, ChevronRight, FileText, ArrowRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export function ClientModules() {
  const { data: modules, isLoading } = useListClientModules();
  // Surface the agreement gate at the top of the modules list so a client
  // who's hit "locked" episodes immediately sees WHY and where to go next.
  const { data: dashboard } = useGetClientDashboard();
  const agreementPending = dashboard?.sprint?.prerequisites?.agreementSigned === false;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 mb-8" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (!modules) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Modules</h1>
        <p className="text-muted-foreground mt-1">Complete these modules to prepare for your sprint.</p>
      </div>

      {agreementPending && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Sign your agreement to unlock the lessons.</p>
              <p className="text-sm text-amber-800/80">All modules stay locked until your agreement is on file.</p>
            </div>
          </div>
          <Link href="/agreements">
            <Button size="sm" className="shrink-0">Review &amp; sign <ArrowRight className="w-3 h-3 ml-2" /></Button>
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {modules.map((mod, index) => {
          const completedCount = mod.episodes.filter(e => e.completed).length;
          const progress = mod.episodes.length > 0 ? (completedCount / mod.episodes.length) * 100 : 0;
          
          return (
            <Card key={mod.id} className={`border-border/50 shadow-sm overflow-hidden transition-all duration-300 ${mod.status === 'locked' ? 'opacity-75 bg-muted/30' : 'hover:shadow-md'}`}>
              <div className="flex flex-col md:flex-row">
                <div className="p-6 md:w-1/3 flex flex-col justify-center bg-muted/10 border-b md:border-b-0 md:border-r border-border">
                  <div className="flex items-center gap-3 mb-2">
                    {mod.status === 'locked' ? <Lock className="w-5 h-5 text-muted-foreground" /> :
                     mod.status === 'complete' ? <CheckCircle2 className="w-5 h-5 text-success" /> :
                     <PlayCircle className="w-5 h-5 text-primary" />}
                    <h2 className="text-xl font-bold">{mod.title}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{mod.description}</p>
                  <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs font-medium text-muted-foreground">
                      <span>Progress</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} className="h-1.5" />
                  </div>
                </div>
                <div className="p-0 md:w-2/3 flex flex-col">
                  {mod.episodes.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground flex items-center justify-center h-full">
                      No episodes yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {mod.episodes.map((ep, i) => {
                        const rowInner = (
                          <>
                            <div className="flex items-center gap-3">
                              <span className="text-muted-foreground text-sm font-medium w-6">{i + 1}.</span>
                              <span className={`font-medium ${ep.locked ? 'text-muted-foreground' : ''}`}>{ep.title}</span>
                            </div>
                            {ep.locked ? (
                              <Lock className="w-4 h-4 text-muted-foreground/50" />
                            ) : ep.completed ? (
                              <span className="flex items-center text-sm font-medium text-muted-foreground">
                                <CheckCircle2 className="w-5 h-5 text-success mr-2" /> Review
                                <ChevronRight className="w-4 h-4 ml-1" />
                              </span>
                            ) : (
                              <span className="flex items-center text-sm font-medium text-primary">
                                Start <ChevronRight className="w-4 h-4 ml-1" />
                              </span>
                            )}
                          </>
                        );
                        return ep.locked ? (
                          <div
                            key={ep.id}
                            className="p-4 flex items-center justify-between cursor-not-allowed opacity-80"
                          >
                            {rowInner}
                          </div>
                        ) : (
                          <Link
                            key={ep.id}
                            href={`/episodes/${ep.id}`}
                            className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer"
                          >
                            {rowInner}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
