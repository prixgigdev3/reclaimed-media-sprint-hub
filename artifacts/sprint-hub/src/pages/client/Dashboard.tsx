import type React from "react";
import { useGetClientDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayCircle, Lock, CheckCircle2, Clock } from "lucide-react";

function PrereqRow({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 w-5 h-5 rounded-full grid place-items-center shrink-0 ${done ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : <Lock className="w-3 h-3" />}
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${done ? "text-secondary" : "text-muted-foreground"}`}>{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export function ClientDashboard() {
  const { data, isLoading } = useGetClientDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return null;

  const { client, progress, modules, sprint } = data;
  const prereq = sprint.prerequisites;
  // The agreement is the very first prerequisite. Until it's signed, the
  // dashboard's only call-to-action should be "go sign it" — every module,
  // and the ICP-as-a-lesson, are locked server-side anyway, so showing a
  // "Start ICP Questionnaire" card here just confused clients who clicked
  // it and ran into a locked screen.
  const agreementSigned = prereq.agreementSigned;

  // Three states for the countdown card:
  //   1. Locked  — prerequisites not all met yet, show what's missing.
  //   2. Active  — sprint started, "Day X of N · Y days remaining".
  //   3. Done    — sprint window has elapsed.
  let countdownBody: React.ReactNode;
  if (sprint.complete) {
    countdownBody = (
      <div>
        <div className="text-4xl font-bold text-success">Sprint complete</div>
        <div className="text-sm text-muted-foreground mt-1">Your {sprint.length}-day sprint window has finished.</div>
      </div>
    );
  } else if (sprint.started && sprint.dayNumber !== null && sprint.daysRemaining !== null) {
    countdownBody = (
      <div>
        <div className="text-4xl font-bold text-secondary">Day {sprint.dayNumber} of {sprint.length}</div>
        <div className="text-sm text-muted-foreground mt-1">
          {sprint.daysRemaining === 0 ? "Final day" : `${sprint.daysRemaining} day${sprint.daysRemaining === 1 ? "" : "s"} remaining`}
        </div>
        <Progress value={Math.round((sprint.dayNumber / sprint.length) * 100)} className="h-2 mt-3" />
      </div>
    );
  } else if (sprint.awaitingReview) {
    countdownBody = (
      <div className="space-y-3">
        <div className="text-3xl font-bold text-secondary flex items-center gap-2">
          <Clock className="w-6 h-6 text-warning" /> Awaiting review
        </div>
        <div className="text-sm text-muted-foreground">
          You've finished everything on your side. Your account manager is reviewing
          your agreement, modules, and ICP. Your {sprint.length}-day sprint will start
          as soon as they confirm.
        </div>
        <div className="space-y-2 pt-1">
          <PrereqRow done label="Agreement signed" />
          <PrereqRow done label="ICP submitted" />
          <PrereqRow done label={`All ${prereq.totalEpisodes} episodes complete`} />
        </div>
      </div>
    );
  } else {
    countdownBody = (
      <div className="space-y-3">
        <div className="text-3xl font-bold text-secondary flex items-center gap-2">
          <Lock className="w-6 h-6 text-muted-foreground" /> Locked
        </div>
        <div className="text-sm text-muted-foreground">
          Your {sprint.length}-day countdown begins once these are done:
        </div>
        <div className="space-y-2 pt-1">
          <PrereqRow done={prereq.agreementSigned} label="Sign your agreement" hint={prereq.agreementSigned ? undefined : "Open the Agreements page to review and sign."} />
          <PrereqRow
            done={prereq.episodesComplete}
            label="Complete every module"
            hint={
              !prereq.agreementSigned
                ? "Available once your agreement is signed."
                : prereq.totalEpisodes > 0
                  ? `${prereq.completedEpisodes} of ${prereq.totalEpisodes} episodes complete`
                  : "No modules published yet."
            }
          />
          <PrereqRow
            done={prereq.icpSubmitted}
            label="Submit your ICP questionnaire"
            hint={
              !prereq.episodesComplete
                ? "Unlocks once every module is complete."
                : prereq.icpSubmitted
                  ? undefined
                  : "Answer the 34 ICP questions."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Welcome back, {client.firstName}</h1>
        <p className="text-muted-foreground mt-1">Here is your sprint progress.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sprint Countdown</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>{countdownBody}</CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Overall Progress</CardTitle>
            <span className="font-bold text-primary">{Math.round(progress)}%</span>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="h-2" />
            <div className="text-xs text-muted-foreground mt-2">
              {prereq.completedEpisodes} of {prereq.totalEpisodes} episodes complete
            </div>
          </CardContent>
        </Card>
      </div>

      {!agreementSigned && (
        <Card className="bg-primary/5 border-primary/20 shadow-sm">
          <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg text-secondary">Sign your service agreement</h3>
              <p className="text-muted-foreground">Your modules and ICP unlock the moment your agreement is on file.</p>
            </div>
            <Link href="/agreements">
              <Button size="lg" className="whitespace-nowrap">Review &amp; sign</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-secondary">Your Modules</h2>
          <Link href="/modules">
            <Button variant="ghost" className="text-primary">View All</Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.slice(0, 4).map((mod) => (
            <Card key={mod.id} className={`border-border/50 shadow-sm transition-all duration-300 ${mod.status === 'locked' ? 'opacity-70 bg-muted/50' : 'hover:shadow-md'}`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 rounded-lg bg-background border border-border">
                    {mod.status === 'locked' ? <Lock className="w-5 h-5 text-muted-foreground" /> :
                     mod.status === 'complete' ? <CheckCircle2 className="w-5 h-5 text-success" /> :
                     <PlayCircle className="w-5 h-5 text-primary" />}
                  </div>
                  <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                    {mod.episodes.length} Episodes
                  </span>
                </div>
                <h3 className="font-bold text-lg mb-1">{mod.title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{mod.description}</p>
                {mod.status !== 'locked' && (
                  <Link href={`/modules/${mod.id}`}>
                    <Button variant={mod.status === 'complete' ? 'outline' : 'default'} className="w-full">
                      {mod.status === 'complete' ? 'Review Module' : 'Continue'}
                    </Button>
                  </Link>
                )}
                {mod.status === 'locked' && (
                  <Button variant="outline" className="w-full" disabled>Locked</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
