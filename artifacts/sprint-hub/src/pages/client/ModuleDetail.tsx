import { useParams, Link } from "wouter";
import { useListClientModules } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PlayCircle, CheckCircle2, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function ClientModuleDetail() {
  const { moduleId } = useParams();
  const { data: modules, isLoading } = useListClientModules();

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const mod = modules?.find(m => m.id === Number(moduleId));
  if (!mod) {
    return <div>Module not found.</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <Link href="/modules">
        <Button variant="ghost" className="-ml-4 text-muted-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Modules
        </Button>
      </Link>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{mod.title}</h1>
        <p className="text-muted-foreground text-lg">{mod.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {mod.episodes.map((ep, i) => (
          <Card key={ep.id} className={`transition-colors ${ep.locked ? 'opacity-60 bg-muted/20' : 'hover:border-primary/50'}`}>
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${ep.completed ? 'bg-success/10 text-success' : ep.locked ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                  {ep.locked ? <Lock className="w-6 h-6" /> : ep.completed ? <CheckCircle2 className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Episode {i + 1}</div>
                  <h3 className="text-xl font-semibold">{ep.title}</h3>
                </div>
              </div>
              
              {!ep.locked && (
                <Link href={`/episodes/${ep.id}`}>
                  <Button variant={ep.completed ? "outline" : "default"}>
                    {ep.completed ? "Review" : "Start Episode"}
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
        {mod.episodes.length === 0 && (
          <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
            No episodes in this module yet.
          </div>
        )}
      </div>
    </div>
  );
}
