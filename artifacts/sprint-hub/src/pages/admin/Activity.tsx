import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { api } from "@/lib/api";

interface ActivityEvent {
  id: number;
  kind: string;
  message: string;
  clientId: number | null;
  createdAt: string;
}

interface ActivityPage {
  items: ActivityEvent[];
  nextCursor: number | null;
}

export function AdminActivity() {
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void loadPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPage(c: number | null, initial = false) {
    if (initial) setLoading(true);
    else setLoadingMore(true);
    try {
      const qs = c ? `?cursor=${c}&limit=50` : `?limit=50`;
      const data = await api<ActivityPage>(`/admin/activity${qs}`);
      setItems((prev) => (initial ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
      if (!data.nextCursor) setDone(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <Link href="/admin">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Back to dashboard</Button>
        </Link>
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Client Activity</h1>
        <p className="text-muted-foreground mt-1">
          Every client-facing event from logins and module progress to support replies. Admin housekeeping
          (logins, impersonation) is excluded.
        </p>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">All activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground italic">No activity yet.</div>
          ) : (
            <>
              <div className="space-y-5">
                {items.map((event) => (
                  <div key={event.id} className="flex items-start gap-4">
                    <div className="mt-0.5 rounded-full p-1.5 bg-muted">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground break-words">{event.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="uppercase tracking-wide font-medium mr-2">{event.kind}</span>
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {event.clientId && (
                      <Link href={`/admin/clients/${event.clientId}`}>
                        <Button variant="ghost" size="sm" className="h-8 text-xs">
                          View client <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </Link>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-6 flex justify-center">
                {done ? (
                  <span className="text-xs text-muted-foreground">— end of feed —</span>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => void loadPage(cursor)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
