import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LogOut, FileText, ArrowRight, CheckCircle2 } from "lucide-react";

interface AgreementItem {
  id: number;
  status: "pending" | "viewed" | "client_signed" | "completed";
  hasSignedPdf: boolean;
  template: { title: string; pageCount: number } | null;
  assignedAt: string;
  completedAt: string | null;
}

const STATUS_BADGE: Record<AgreementItem["status"], { label: string; cls: string }> = {
  pending: { label: "Action required", cls: "bg-amber-500/20 text-amber-700 border-amber-500/30" },
  viewed: { label: "Action required", cls: "bg-amber-500/20 text-amber-700 border-amber-500/30" },
  client_signed: { label: "Awaiting countersign", cls: "bg-blue-500/20 text-blue-700 border-blue-500/30" },
  completed: { label: "Signed", cls: "bg-success/20 text-success border-success/30" },
};

function AgreementsSection() {
  const { data, isLoading } = useQuery<AgreementItem[]>({
    queryKey: ["client-agreements"],
    queryFn: () => api("/me/agreements"),
  });

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader>
        <CardTitle>Agreements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.length === 0 ? (
          <div className="text-sm text-muted-foreground">No agreements yet.</div>
        ) : (
          data.map((a) => {
            const st = STATUS_BADGE[a.status];
            return (
              <div
                key={a.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-border/60 rounded-lg p-4"
              >
                <div className="min-w-0">
                  <div className="font-medium text-secondary flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate">{a.template?.title ?? "Agreement"}</span>
                    <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Sent {new Date(a.assignedAt).toLocaleDateString()}
                    {a.completedAt && ` • Completed ${new Date(a.completedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {a.status === "completed" && a.hasSignedPdf && (
                    <a href={`/api/me/agreements/${a.id}/pdf?signed=1`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">
                        <CheckCircle2 className="w-3 h-3 mr-2" /> Signed PDF
                      </Button>
                    </a>
                  )}
                  <Link href={`/agreements/${a.id}`}>
                    <Button size="sm">
                      {a.status === "pending" || a.status === "viewed" ? "Review & sign" : "View"}
                      <ArrowRight className="w-3 h-3 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export function ClientAccount() {
  const { data: me, isLoading } = useGetMe();
  const { logout } = useAuth();

  if (isLoading) {
    return <Skeleton className="h-96 max-w-2xl mx-auto" />;
  }

  const client = me?.client;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Account</h1>
        <p className="text-muted-foreground mt-1">Manage your profile, agreements, and settings.</p>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle>Profile Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-muted-foreground">First Name</Label>
              <div className="font-medium text-lg">{client?.firstName || '-'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Last Name</Label>
              <div className="font-medium text-lg">{client?.lastName || '-'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Email</Label>
              <div className="font-medium text-lg">{client?.email || '-'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Phone</Label>
              <div className="font-medium text-lg">{client?.phone || '-'}</div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-muted-foreground">Business Name</Label>
              <div className="font-medium text-lg">{client?.businessName || '-'}</div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-muted-foreground">Sprint Start Date</Label>
              <div className="font-medium text-lg">{client?.sprintStartDate ? new Date(client.sprintStartDate).toLocaleDateString() : 'Not scheduled yet'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AgreementsSection />

      <div className="pt-4 flex justify-start">
        <Button variant="destructive" onClick={logout} className="w-full md:w-auto">
          <LogOut className="w-4 h-4 mr-2" /> Log out
        </Button>
      </div>
    </div>
  );
}
