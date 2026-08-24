import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ArrowRight, CheckCircle2 } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";

interface Item {
  id: number;
  status: "pending" | "viewed" | "client_signed" | "completed";
  hasSignedPdf: boolean;
  template: { title: string; pageCount: number } | null;
  assignedAt: string;
  completedAt: string | null;
}

const STATUS_BADGE: Record<Item["status"], { label: string; cls: string }> = {
  pending: { label: "Action required", cls: "bg-amber-500/20 text-amber-700 border-amber-500/30" },
  viewed: { label: "Action required", cls: "bg-amber-500/20 text-amber-700 border-amber-500/30" },
  client_signed: { label: "Awaiting countersign", cls: "bg-blue-500/20 text-blue-700 border-blue-500/30" },
  completed: { label: "Signed", cls: "bg-success/20 text-success border-success/30" },
};

export function ClientAgreements() {
  const { data, isLoading } = useQuery<Item[]>({
    queryKey: ["client-agreements"],
    queryFn: () => api("/me/agreements"),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Agreements</h1>
        <p className="text-muted-foreground mt-1">Review and sign your agreements with {BRAND_NAME}.</p>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No agreements yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {data.map((a) => {
            const st = STATUS_BADGE[a.status];
            return (
              <Card key={a.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="w-4 h-4 text-primary" /> {a.template?.title ?? "Agreement"}
                  </CardTitle>
                  <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Sent {new Date(a.assignedAt).toLocaleDateString()}
                    {a.completedAt && ` • Completed ${new Date(a.completedAt).toLocaleDateString()}`}
                  </div>
                  <div className="flex gap-2">
                    {a.status === "completed" && a.hasSignedPdf && (
                      <a href={`/api/me/agreements/${a.id}/pdf?signed=1`} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline"><CheckCircle2 className="w-3 h-3 mr-2" /> View signed PDF</Button>
                      </a>
                    )}
                    <Link href={`/agreements/${a.id}`}>
                      <Button size="sm">
                        {a.status === "pending" || a.status === "viewed" ? "Review & sign" : "View"} <ArrowRight className="w-3 h-3 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
