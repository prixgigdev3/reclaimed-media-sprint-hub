import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, uploadFormData } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BRAND_NAME } from "@/lib/brand";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Save, Sparkles, ImageIcon, Trash2, Upload, Wand2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface AutoFormatResponse {
  body: string;
  changed: boolean;
  inserted: string[];
  warnings: string[];
}

// Friendly label for each token kind so the review dialog reads as
// "Client name" rather than "{{name}}". Falls back to the raw token if
// the AI emits something unusual (the server still validates the kind).
function describeToken(token: string): string {
  const m = /^\{\{\s*([a-zA-Z][\w]*)(?::([^}]+))?\s*\}\}$/.exec(token);
  if (!m) return token;
  const [, kind, label] = m;
  switch (kind) {
    case "name":
      return label ? `Named person — ${label.trim()}` : "Client name";
    case "businessName":
      return label ? `Named business — ${label.trim()}` : "Client business name";
    case "date":
      return "Signature date";
    case "initial":
      return label ? `Initial box — ${label.trim().replace(/_/g, " ")}` : "Initial box";
    case "text":
      return label ? `Text input — ${label.trim()}` : "Text input";
    default:
      return token;
  }
}

// Find the first line in `body` that contains `token` so the review
// dialog can show the admin where exactly each new field landed.
function lineContext(body: string, token: string): string {
  const idx = body.indexOf(token);
  if (idx < 0) return "";
  const lineStart = body.lastIndexOf("\n", idx - 1) + 1;
  const lineEndRaw = body.indexOf("\n", idx);
  const lineEnd = lineEndRaw < 0 ? body.length : lineEndRaw;
  return body.slice(lineStart, lineEnd).trim();
}

const STARTER_BODY = `# Coaching agreement

This agreement is made between **{{name:Coach name}}** of **{{businessName:Coach business}}** and **{{name}}** of **{{businessName}}**, dated {{date}}.

## 1. Scope of work
${BRAND_NAME} will deliver the agreed coaching programme over a 90-day sprint, including weekly modules, monthly check-ins, and on-demand support.

## 2. Confidentiality
Both parties agree to keep all shared materials, strategies, and business information confidential.

I confirm I have read and understood this section. {{initial:scope}}

## 3. Principal place of business
Client confirms their principal place of business is: {{text:Principal place of business}}

## 4. Acceptance
By signing below, the parties agree to the terms set out in this document.`;

const TOKEN_HELP: { token: string; description: string }[] = [
  { token: "{{name}}", description: "Client's full name (auto-filled from their profile, editable)." },
  { token: "{{businessName}}", description: "Client's business name (auto-filled, editable)." },
  { token: "{{date}}", description: "Signature date (auto-filled at signing)." },
  { token: "{{initial:section}}", description: "Drawable initial box for the named section." },
  { token: "{{text:Label}}", description: "Free-text input the client must fill in. Label shows above the box." },
  { token: "**bold**", description: "Markdown bold — wrap any text in double asterisks." },
];

const TOKEN_RE = /\{\{\s*([a-zA-Z][\w]*)(?::([^}]+))?\s*\}\}/g;

type Role = "admin" | "client";
type PlaceholderType = "text" | "name" | "businessName" | "date" | "initial";
interface Placeholder {
  key: string;
  label: string;
  type: PlaceholderType;
  required?: boolean;
  role: Role;
  defaultValue?: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}

/**
 * Mirrors server-side extractPlaceholders so the editor previews the same
 * placeholder list (and merges admin overrides so role/defaultValue persist
 * across body edits).
 */
function detectPlaceholders(body: string, existing: Placeholder[]): Placeholder[] {
  const existingByKey = new Map(existing.map((p) => [p.key, p]));
  const out: Placeholder[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const rawKey = m[1];
    const arg = m[2]?.trim();
    let key = rawKey;
    let type: PlaceholderType = "text";
    let label = rawKey;
    if (rawKey === "name") {
      type = "name";
      label = "Full name";
    } else if (rawKey === "businessName") {
      type = "businessName";
      label = "Business name";
    } else if (rawKey === "date") {
      type = "date";
      label = "Date";
    } else if (rawKey === "initial") {
      type = "initial";
      key = arg ? `initial_${slug(arg)}` : "initial";
      label = arg ? `Initial — ${arg}` : "Initial";
    } else if (rawKey === "text") {
      type = "text";
      const lab = arg || "Field";
      key = `text_${slug(lab)}`;
      label = lab;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const prior = existingByKey.get(key);
    out.push({
      key,
      label,
      type,
      required: type !== "date",
      role: prior?.role ?? "client",
      defaultValue: prior?.defaultValue,
    });
  }
  return out;
}

interface TemplateData {
  id: number;
  title: string;
  description: string;
  bodyMarkdown: string;
  placeholders: Placeholder[];
  hasLogo: boolean;
  logoUrl: string | null;
}

export function AdminAgreementBuilder() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId !== null && !Number.isNaN(editId);

  const { data: existing, isLoading: loadingTemplate } = useQuery<TemplateData>({
    queryKey: ["admin-agreement-template", editId],
    queryFn: () => api(`/admin/agreements/templates/${editId}`),
    enabled: isEdit,
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(STARTER_BODY);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [hasServerLogo, setHasServerLogo] = useState(false);
  const [logoBust, setLogoBust] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate from server when editing.
  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title);
    setDescription(existing.description ?? "");
    setBody(existing.bodyMarkdown);
    setPlaceholders(existing.placeholders ?? []);
    setHasServerLogo(existing.hasLogo);
  }, [existing]);

  // Re-detect placeholders whenever the body changes — but preserve admin overrides.
  useEffect(() => {
    setPlaceholders((prev) => detectPlaceholders(body, prev));
  }, [body]);

  // Local logo preview cleanup.
  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const placeholderCount = placeholders.length;

  const updatePh = (key: string, patch: Partial<Placeholder>) =>
    setPlaceholders((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const uploadLogoFor = async (templateId: number) => {
    if (!logoFile) return;
    const fd = new FormData();
    fd.append("file", logoFile);
    await uploadFormData(`/admin/agreements/templates/${templateId}/logo`, fd);
  };

  // Holds the AI's proposed body + inserted token list while the admin
  // reviews it in the dialog. Set when the mutation returns successfully
  // with changes; cleared when the admin applies or discards.
  const [autoFormatPreview, setAutoFormatPreview] = useState<AutoFormatResponse | null>(null);

  // Ask the server to insert placeholder tokens (name, businessName, date,
  // initials, free-text fields) into the body using the LLM. The server
  // guards against any word-level rewrites and returns warnings if the
  // suggestion was rejected. Successful results open a review dialog so
  // the admin can SEE what the AI proposed before it overwrites their text.
  const autoFormatM = useMutation({
    mutationFn: () =>
      api<AutoFormatResponse>("/admin/agreements/auto-format", {
        method: "POST",
        json: { body },
      }),
    onSuccess: (res) => {
      if (res.warnings.length > 0) {
        toast.warning(res.warnings.join(" "));
        return;
      }
      if (!res.changed || res.inserted.length === 0) {
        toast.info(
          "AI scanned the document but didn't find any new fields to add — your existing placeholders look complete.",
        );
        return;
      }
      setAutoFormatPreview(res);
    },
    onError: (e) => toast.error((e as Error).message || "Auto-format failed"),
  });

  function applyAutoFormat() {
    if (!autoFormatPreview) return;
    setBody(autoFormatPreview.body);
    const n = autoFormatPreview.inserted.length;
    toast.success(n === 1 ? "Added 1 placeholder field." : `Added ${n} placeholder fields.`);
    setAutoFormatPreview(null);
  }

  const removeServerLogo = useMutation({
    mutationFn: () =>
      api(`/admin/agreements/templates/${editId}/logo`, { method: "DELETE" }),
    onSuccess: () => {
      setHasServerLogo(false);
      qc.invalidateQueries({ queryKey: ["admin-agreement-template", editId] });
      qc.invalidateQueries({ queryKey: ["admin-agreement-templates"] });
      toast.success("Logo removed");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const saveM = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description,
        bodyMarkdown: body,
        placeholders: placeholders.map((p) => ({
          key: p.key,
          label: p.label,
          type: p.type,
          required: p.required,
          role: p.role,
          defaultValue: p.defaultValue ?? "",
        })),
      };
      if (isEdit) {
        const res = await api<TemplateData>(`/admin/agreements/templates/${editId}`, {
          method: "PATCH",
          json: payload,
        });
        if (logoFile) {
          await uploadLogoFor(editId!);
        }
        return res;
      } else {
        const created = await api<{ id: number }>("/admin/agreements/templates/builder", {
          method: "POST",
          json: payload,
        });
        if (logoFile && created.id) {
          await uploadLogoFor(created.id);
        }
        return created;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Agreement saved" : "Agreement created");
      qc.invalidateQueries({ queryKey: ["admin-agreement-templates"] });
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ["admin-agreement-template", editId] });
        setLogoFile(null);
        setHasServerLogo((prev) => prev || !!logoFile);
        setLogoBust((b) => b + 1);
      } else {
        navigate("/admin/agreements");
      }
    },
    onError: (e) => toast.error((e as Error).message || "Failed to save"),
  });

  const canSave = title.trim().length > 0 && body.trim().length > 0 && !saveM.isPending;
  const adminCount = placeholders.filter((p) => p.role === "admin").length;
  const clientCount = placeholders.filter((p) => p.role === "client").length;

  if (isEdit && loadingTemplate) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Button variant="ghost" className="-ml-3 text-muted-foreground" onClick={() => navigate("/admin/agreements")}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to agreements
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-secondary flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" /> {isEdit ? "Edit agreement" : "Build a new agreement"}
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Compose the agreement, mark which fields you fill versus the client, and add a logo. Markdown bold
            (<code className="text-xs bg-muted px-1 py-0.5 rounded">**bold**</code>) and placeholder tokens like{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{name}}"}</code> render properly in the
            signed PDF.
          </p>
        </div>
        <Button onClick={() => saveM.mutate()} disabled={!canSave} size="lg">
          <Save className="w-4 h-4 mr-2" /> {saveM.isPending ? "Saving…" : isEdit ? "Save changes" : "Save agreement"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coaching agreement" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Internal description (optional)</Label>
                <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Standard 90-day sprint contract" />
              </div>
              {/* Logo */}
              <div className="space-y-2">
                <Label>Brand logo (optional)</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-20 h-20 rounded border border-border bg-muted/40 flex items-center justify-center overflow-hidden">
                    {logoPreview ? (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img src={logoPreview} alt="logo preview" className="max-w-full max-h-full object-contain" />
                    ) : hasServerLogo && isEdit ? (
                      <img
                        src={`/api/admin/agreements/templates/${editId}/logo?t=${logoBust}`}
                        alt="logo"
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-7 h-7 text-muted-foreground" />
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 5 * 1024 * 1024) {
                        toast.error("Logo must be 5MB or smaller");
                        return;
                      }
                      setLogoFile(f);
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-4 h-4 mr-2" />
                    {logoFile ? "Replace" : hasServerLogo ? "Replace logo" : "Upload logo"}
                  </Button>
                  {logoFile && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLogoFile(null)}>
                      Cancel
                    </Button>
                  )}
                  {!logoFile && hasServerLogo && isEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeServerLogo.mutate()}
                      disabled={removeServerLogo.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG or JPEG, max 5MB. Appears in the top-right corner of the signed PDF.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Body</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{placeholderCount} field{placeholderCount === 1 ? "" : "s"}</Badge>
                <Badge variant="secondary">{adminCount} admin · {clientCount} client</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => autoFormatM.mutate()}
                  disabled={autoFormatM.isPending || body.trim().length === 0}
                  title="Use AI to insert name, business name, date, initial, and signature fields where they belong. Your wording is never changed."
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  {autoFormatM.isPending ? "Detecting fields…" : "Auto-detect fields with AI"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={26}
                className="font-mono text-sm leading-relaxed"
                placeholder="Paste or type your agreement here. Use # for headings, ## for subheadings, - for bullets, **bold** for emphasis, blank lines between paragraphs. Then click 'Auto-detect fields with AI' to drop in the signing inputs."
              />
              <p className="text-xs text-muted-foreground">
                Formatting: <code className="bg-muted px-1 rounded">#</code> heading,{" "}
                <code className="bg-muted px-1 rounded">##</code> subheading,{" "}
                <code className="bg-muted px-1 rounded">-</code> bullet,{" "}
                <code className="bg-muted px-1 rounded">**bold**</code>, blank line for new paragraph. Auto-detect
                only inserts placeholder tokens — your wording is never changed.
              </p>
            </CardContent>
          </Card>

          {/* Field roles & defaults */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who fills each field?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {placeholders.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Add a placeholder token above (like <code className="bg-muted px-1 rounded">{"{{name}}"}</code>) to
                  configure who fills it.
                </p>
              )}
              {placeholders.map((p) => (
                <div
                  key={p.key}
                  className="grid grid-cols-1 md:grid-cols-[1fr_140px_1.4fr] gap-2 items-center border border-border rounded p-2"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground truncate">{p.key}</div>
                    <div className="text-sm font-medium truncate">{p.label}</div>
                  </div>
                  <Select value={p.role} onValueChange={(v) => updatePh(p.key, { role: v as Role })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Client fills</SelectItem>
                      <SelectItem value="admin">You (admin) fill</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder={
                      p.role === "admin"
                        ? "Default value (locked for client)"
                        : "Pre-filled value (client can edit)"
                    }
                    value={p.defaultValue ?? ""}
                    onChange={(e) => updatePh(p.key, { defaultValue: e.target.value })}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2">
                Set <strong>You (admin) fill</strong> for fields like your own name and business — clients see them
                as read-only. Use the default value to bake in the exact text.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="text-base">Placeholder tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {TOKEN_HELP.map((h) => (
              <div key={h.token} className="space-y-1">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-semibold">{h.token}</code>
                <p className="text-xs text-muted-foreground">{h.description}</p>
              </div>
            ))}
            <div className="pt-3 mt-3 border-t border-border/60 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">How signing works</p>
              <p>
                The client reads the document inline, fills any client-role inputs, and signs once at the bottom.
                Admin-role fields are locked using the defaults you set. The exported PDF includes an audit page
                with view/sign timestamps, IP addresses, and user agents.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI auto-detect review dialog. The mutation no longer overwrites
          the body silently — it stages the proposal here so the admin can
          see exactly what fields were inserted (and where) before
          accepting. Discard leaves the original body untouched. */}
      <Dialog
        open={!!autoFormatPreview}
        onOpenChange={(open) => {
          if (!open) setAutoFormatPreview(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI suggested {autoFormatPreview?.inserted.length ?? 0} new field
              {autoFormatPreview?.inserted.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Review what the AI proposes to add. Your wording is never changed — only signing
              placeholders are inserted. Apply to accept, or discard to keep the document as-is.
            </DialogDescription>
          </DialogHeader>

          {autoFormatPreview && (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {autoFormatPreview.inserted.map((token, i) => {
                const ctx = lineContext(autoFormatPreview.body, token);
                const before = ctx.split(token)[0] ?? "";
                const after = ctx.slice(before.length + token.length);
                return (
                  <div
                    key={`${token}-${i}`}
                    className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {token}
                      </Badge>
                      <span className="text-sm font-medium">{describeToken(token)}</span>
                    </div>
                    {ctx && (
                      <p className="text-xs text-muted-foreground pl-6 leading-relaxed">
                        <span className="opacity-70">…{before.slice(-60)}</span>
                        <span className="bg-primary/15 text-foreground font-mono px-1 rounded mx-0.5">
                          {token}
                        </span>
                        <span className="opacity-70">{after.slice(0, 80)}…</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setAutoFormatPreview(null)}>
              Discard
            </Button>
            <Button onClick={applyAutoFormat}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Apply {autoFormatPreview?.inserted.length ?? 0} field
              {autoFormatPreview?.inserted.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
