import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiPdfUrl } from "@/lib/api";
import { PdfPage } from "@/components/PdfViewer";
import { SignaturePad, type SignatureResult } from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface Field {
  id: string;
  type: "signature" | "initial" | "date" | "text" | "name";
  role: "client" | "admin";
  page: number;
  x: number; y: number; width: number; height: number;
  label?: string;
}
interface FieldValue {
  fieldId: string;
  value: string;
  signatureMethod?: "drawn" | "typed";
  signedAt?: string;
}
interface Assignment {
  id: number;
  templateId: number;
  clientId: number;
  status: "pending" | "viewed" | "client_signed" | "completed";
  fieldValues: FieldValue[];
  hasSignedPdf: boolean;
  clientSignedAt: string | null;
  adminSignedAt: string | null;
  template: { id: number; title: string; pageCount: number; fields: Field[] } | null;
  client: { id: number; firstName: string; lastName: string; email: string } | null;
  events?: Array<{ id: number; kind: string; actorType: string; actorEmail: string | null; ip: string | null; createdAt: string; metadata?: { page?: number } | null }>;
}

export function AdminAgreementReview() {
  const { id } = useParams();
  const aid = Number(id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [adminValues, setAdminValues] = useState<Record<string, FieldValue>>({});

  const { data, isLoading } = useQuery<Assignment>({
    queryKey: ["admin-assignment", aid],
    queryFn: () => api(`/admin/agreements/assignments/${aid}`),
    enabled: !!aid,
  });

  const signM = useMutation({
    mutationFn: () =>
      api(`/admin/agreements/assignments/${aid}/sign`, {
        method: "POST",
        json: { fieldValues: Object.values(adminValues) },
      }),
    onSuccess: () => {
      toast.success("Counter-signed");
      qc.invalidateQueries({ queryKey: ["admin-assignment", aid] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading || !data) return <Skeleton className="h-screen w-full" />;

  const t = data.template;
  if (!t) return <div>Template missing.</div>;

  const adminFields = (t.fields ?? []).filter((f) => f.role === "admin");
  const allAdminFilled = adminFields.every((f) => adminValues[f.id]?.value);
  const showSignedPdf = data.status === "completed" && data.hasSignedPdf;
  const pdfUrl = apiPdfUrl(showSignedPdf
    ? `/admin/agreements/assignments/${aid}/signed.pdf`
    : `/admin/agreements/templates/${t.id}/pdf`);

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <Link href="/admin/agreements">
        <Button variant="ghost" className="-ml-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <div className="text-sm text-muted-foreground">
            For {data.client?.firstName} {data.client?.lastName} · {data.client?.email}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data.status === "completed" ? "default" : "secondary"}>{data.status}</Badge>
          {showSignedPdf && (
            <a href={pdfUrl} download>
              <Button size="sm" variant="outline"><Download className="w-4 h-4 mr-2" /> Signed PDF</Button>
            </a>
          )}
        </div>
      </div>

      {data.status === "client_signed" && adminFields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Counter-sign</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {adminFields.map((f) => (
              <div key={f.id} className="space-y-2">
                <div className="text-sm font-medium">
                  {f.label || f.type.toUpperCase()} <span className="text-xs text-muted-foreground">(page {f.page})</span>
                </div>
                <AdminFieldInput
                  field={f}
                  onChange={(v) => setAdminValues((p) => ({ ...p, [f.id]: v }))}
                />
              </div>
            ))}
            <Button onClick={() => signM.mutate()} disabled={!allAdminFilled || signM.isPending}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Counter-sign & finalize
            </Button>
          </CardContent>
        </Card>
      )}

      {data.status === "client_signed" && adminFields.length === 0 && (
        <Card>
          <CardContent className="py-6 flex items-center justify-between">
            <div className="text-sm">Client has signed. No admin fields — finalize to generate the signed PDF.</div>
            <Button onClick={() => signM.mutate()} disabled={signM.isPending}>Finalize</Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {Array.from({ length: t.pageCount }, (_, i) => i + 1).map((p) => (
          <PdfPage key={p} pdfUrl={pdfUrl} pageNumber={p} scale={1.3} />
        ))}
      </div>

      {data.events && data.events.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const pageViews = data.events!.filter((e) => e.kind === "page_view");
              const seen = new Map<number, string>();
              for (const e of pageViews) {
                const p = e.metadata?.page;
                if (typeof p === "number" && !seen.has(p)) seen.set(p, e.createdAt);
              }
              if (seen.size === 0) return null;
              const pages = Array.from(seen.entries()).sort((a, b) => a[0] - b[0]);
              return (
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Pages viewed by client</div>
                  <div className="flex flex-wrap gap-2">
                    {pages.map(([p, t]) => (
                      <Badge key={p} variant="secondary" title={new Date(t).toLocaleString()}>
                        Page {p} · {new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })()}
            <ul className="space-y-1 text-sm">
              {data.events.filter((e) => e.kind !== "page_view").map((e) => (
                <li key={e.id} className="flex items-center justify-between border-b last:border-0 py-1">
                  <span><span className="font-medium uppercase text-xs">{e.kind}</span> · {e.actorType} {e.actorEmail ? `(${e.actorEmail})` : ""} {e.ip ? `· ${e.ip}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AdminFieldInput({ field, onChange }: { field: Field; onChange: (v: FieldValue) => void }) {
  if (field.type === "signature" || field.type === "initial") {
    return (
      <SignaturePad
        onChange={(r: SignatureResult | null) => {
          if (r) onChange({ fieldId: field.id, value: r.value, signatureMethod: r.method });
        }}
      />
    );
  }
  if (field.type === "date") {
    return (
      <input
        type="date"
        className="border border-border rounded px-2 py-1"
        defaultValue={new Date().toISOString().slice(0, 10)}
        onChange={(e) => onChange({ fieldId: field.id, value: new Date(e.target.value).toLocaleDateString() })}
      />
    );
  }
  return (
    <input
      type="text"
      className="border border-border rounded px-2 py-1 w-full"
      onChange={(e) => onChange({ fieldId: field.id, value: e.target.value })}
    />
  );
}
