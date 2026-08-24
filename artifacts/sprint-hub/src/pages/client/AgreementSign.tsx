import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  memo,
  createContext,
  useContext,
  Fragment,
  Children,
  isValidElement,
  cloneElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, apiPdfUrl } from "@/lib/api";
import { PdfPage } from "@/components/PdfViewer";
import { SignaturePad, type SignatureResult } from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2, Download, Pencil } from "lucide-react";
import reclaimedLogo from "@/assets/reclaimed-media-wordmark-blue.png";
import { BRAND_NAME } from "@/lib/brand";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";

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
}
interface Placeholder {
  key: string;
  label: string;
  type: "text" | "name" | "businessName" | "date" | "initial";
  required?: boolean;
  role?: "admin" | "client";
  defaultValue?: string;
}
interface Assignment {
  id: number;
  status: "pending" | "viewed" | "client_signed" | "completed";
  hasSignedPdf: boolean;
  fieldValues: FieldValue[];
  placeholderValues: Record<string, string>;
  template: {
    id: number;
    kind: "uploaded" | "builder";
    title: string;
    pageCount: number;
    fields: Field[];
    bodyMarkdown: string;
    placeholders: Placeholder[];
  } | null;
}

export function ClientAgreementSign() {
  const { id } = useParams();
  const aid = Number(id);
  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const fullName = `${me?.user?.firstName ?? ""} ${me?.user?.lastName ?? ""}`.trim();
  const businessName = me?.client?.businessName ?? "";
  // The backend hard-blocks /me/agreements/:id/sign when an admin is
  // previewing as a client (so admins can't accidentally sign on the
  // client's behalf). Surface that state in the UI here so the "Sign and
  // submit" button is visibly disabled with a clear inline notice instead
  // of failing silently behind a 403 toast that's easy to miss above the
  // fold of a long agreement.
  const isImpersonating = !!(me as unknown as { isImpersonating?: boolean })?.isImpersonating;

  const { data, isLoading } = useQuery<Assignment>({
    queryKey: ["client-agreement", aid],
    queryFn: () => api(`/me/agreements/${aid}`),
    enabled: !!aid,
  });

  if (isLoading || !data) return <Skeleton className="h-screen w-full" />;
  const t = data.template;
  if (!t) return <div>Template missing.</div>;

  if (t.kind === "builder") {
    return (
      <BuilderAgreement
        aid={aid}
        data={data}
        fullName={fullName}
        businessName={businessName}
        isImpersonating={isImpersonating}
      />
    );
  }
  return <UploadedAgreement aid={aid} data={data} fullName={fullName} qc={qc} isImpersonating={isImpersonating} />;
}

// ============================================================
// Builder (in-platform) agreement view
// ============================================================
function BuilderAgreement({
  aid,
  data,
  fullName,
  businessName,
  isImpersonating,
}: {
  aid: number;
  data: Assignment;
  fullName: string;
  businessName: string;
  isImpersonating: boolean;
}) {
  const t = data.template!;
  const qc = useQueryClient();
  const isReadOnly = data.status === "client_signed" || data.status === "completed";
  const showSigned = data.status === "completed" && data.hasSignedPdf;

  // Seed placeholder values: prior submission > admin default > profile default > empty.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = { ...data.placeholderValues };
    for (const p of t.placeholders ?? []) {
      if (seed[p.key]) continue;
      // Admin-role placeholders ALWAYS use the admin's default (locked from
      // the client). Falling through here would let profile defaults win.
      if (p.role === "admin") {
        if (p.defaultValue) seed[p.key] = p.defaultValue;
        continue;
      }
      if (p.defaultValue) {
        seed[p.key] = p.defaultValue;
      } else if (p.type === "name" && fullName) seed[p.key] = fullName;
      else if (p.type === "businessName" && businessName) seed[p.key] = businessName;
      else if (p.type === "date") seed[p.key] = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
    }
    return seed;
  });
  const [signature, setSignature] = useState<SignatureResult | null>(null);

  const placeholdersByKey = useMemo(
    () => new Map((t.placeholders ?? []).map((p) => [p.key, p])),
    [t.placeholders],
  );

  // Admin-role placeholders are locked & filled by us, so they never gate
  // submission. We only care about required client-role placeholders.
  const missing = (t.placeholders ?? []).filter(
    (p) => (p.role ?? "client") === "client" && p.required !== false && !values[p.key]?.trim(),
  );
  const canSubmit = !isReadOnly && missing.length === 0 && !!signature && !isImpersonating;

  const signM = useMutation({
    mutationFn: () =>
      api(`/me/agreements/${aid}/sign`, {
        method: "POST",
        json: {
          placeholderValues: values,
          signatureDataUrl: signature?.value,
          signatureMethod: signature?.method,
        },
      }),
    onSuccess: () => {
      toast.success("Signed! Your PDF is being generated.");
      qc.invalidateQueries({ queryKey: ["client-agreement", aid] });
      qc.invalidateQueries({ queryKey: ["client-agreements"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setVal = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  // Stable context wrapper so PlaceholderInput consumers re-render on each
  // keystroke WITHOUT the surrounding ReactMarkdown tree being torn down.
  // Previously the `components={...}` prop passed to ReactMarkdown contained
  // arrow functions defined inline in renderBody, so every render produced
  // brand-new component types — React reconciliation then unmounted and
  // remounted every input on every keystroke, which is the well-known
  // "loses focus after one letter" bug the user hit.
  const ctxValue = useMemo<PlaceholderCtxValue>(
    () => ({ values, setVal, placeholdersByKey, readOnly: isReadOnly }),
    [values, placeholdersByKey, isReadOnly],
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-20 max-w-4xl mx-auto">
      <Link href="/">
        <Button variant="ghost" className="-ml-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <Badge variant={isReadOnly ? "default" : "outline"} className="mt-1">{data.status}</Badge>
        </div>
        {showSigned && (
          <a href={apiPdfUrl(`/me/agreements/${aid}/pdf?signed=1`)} download target="_blank" rel="noreferrer">
            <Button variant="outline"><Download className="w-4 h-4 mr-2" /> Download signed PDF</Button>
          </a>
        )}
      </div>

      {/*
        Single paper-like card containing BOTH the agreement body and the
        signature block. The PDF export bakes the signature into the same
        document right below the body, so the on-screen view should match —
        a separate "Sign here" card below the page made it feel like a side
        panel, which the user (correctly) flagged as not part of the agreement.
      */}
      <Card className="bg-white">
        <CardContent className="prose prose-sm max-w-none py-10 px-8 md:px-14 leading-relaxed text-[15px] text-slate-800 font-serif">
          {/*
            Centered Reclaimed Media wordmark above the agreement title so the on-screen
            preview matches the exported signed PDF (which now embeds the same
            logo at the top of page 1). Kept inside the prose card so the
            visual hierarchy reads logo → title → body in both views.
          */}
          <div className="not-prose flex justify-center mb-8">
            <img
              src={reclaimedLogo}
              alt={BRAND_NAME}
              className="h-16 md:h-20 w-auto"
            />
          </div>
          <PlaceholderCtx.Provider value={ctxValue}>
            <MarkdownBody body={t.bodyMarkdown} />
          </PlaceholderCtx.Provider>

          <div className="mt-10 pt-6 border-t border-slate-200 not-prose">
            <h3 className="font-sans font-semibold text-base text-slate-900 mb-3">Signature</h3>
            {!isReadOnly ? (
              <div className="space-y-4">
                <SignaturePad defaultName={fullName} onChange={setSignature} />
                <div className="text-xs text-slate-600">
                  Signed by <span className="font-semibold text-slate-900">{fullName || "(your name)"}</span> on{" "}
                  {new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}
                </div>
                {missing.length > 0 && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 font-sans">
                    Please fill in: {missing.map((m) => m.label).join(", ")}
                  </div>
                )}
                {isImpersonating && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 font-sans">
                    You're previewing as this client. Exit preview mode (top banner) to sign on their behalf is disabled — only the actual client can submit a signature.
                  </div>
                )}
                <Button
                  onClick={() => signM.mutate()}
                  disabled={!canSubmit || signM.isPending}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {signM.isPending ? "Submitting…" : "Sign and submit"}
                </Button>
                <p className="text-xs text-slate-500 font-sans">
                  By clicking sign, you acknowledge that this is your electronic signature. We will record the
                  time, date, IP address, and browser used to complete signing in the audit trail bound to the
                  signed PDF.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded p-4 font-sans">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-slate-900">Signed</p>
                  <p className="text-slate-600">
                    Your signature is bound to this document. Download the signed PDF — it includes the agreement,
                    your signature, and the full audit trail in one file.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TOKEN_RE = /\{\{\s*([a-zA-Z][\w]*)(?::([^}]+))?\s*\}\}/g;
// Sentinel inserted into the markdown source in place of each {{token}}. It
// uses unicode bracket chars that markdown will not interpret, so it survives
// the parser intact and we can split text nodes on it after rendering.
const SENTINEL_RE = /⟦PH:(\d+)⟧/g;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}

function resolveKey(rawKey: string, arg?: string): string | null {
  if (rawKey === "name" || rawKey === "businessName" || rawKey === "date") return rawKey;
  if (rawKey === "initial") return arg ? `initial_${slug(arg)}` : "initial";
  if (rawKey === "text") return arg ? `text_${slug(arg)}` : null;
  return rawKey;
}

interface TokenSpec { raw: string; key: string | null; }

interface PlaceholderCtxValue {
  values: Record<string, string>;
  setVal: (k: string, v: string) => void;
  placeholdersByKey: Map<string, Placeholder>;
  readOnly: boolean;
}
const PlaceholderCtx = createContext<PlaceholderCtxValue | null>(null);

/**
 * Pre-process the body: replace each {{token}} match with a unique sentinel
 * that survives markdown parsing, and stash the resolved placeholder key so
 * we can swap the sentinel for an interactive PlaceholderInput later.
 */
function extractTokens(body: string): { source: string; tokens: TokenSpec[] } {
  const tokens: TokenSpec[] = [];
  TOKEN_RE.lastIndex = 0;
  const source = body.replace(TOKEN_RE, (raw, rawKey: string, arg?: string) => {
    const key = resolveKey(rawKey, arg?.trim());
    const idx = tokens.length;
    tokens.push({ raw, key });
    return `⟦PH:${idx}⟧`;
  });
  return { source, tokens };
}

/**
 * Walk react-markdown's rendered children. Whenever a string child contains
 * one of our sentinels, split it and substitute either a PlaceholderInput
 * (for known tokens) or an unobtrusive amber span (for unknown ones).
 *
 * IMPORTANT: This intentionally takes ONLY `tokens` as a closed-over
 * dependency. PlaceholderInput pulls its mutable state (`values`, `setVal`,
 * `readOnly`, the placeholder lookup) from `PlaceholderCtx` instead of as
 * props. That keeps the entire markdown component tree referentially stable
 * across keystrokes so React reconciles the existing inputs in place.
 */
function transformChildrenStable(children: ReactNode, tokens: TokenSpec[]): ReactNode {
  return Children.map(children, (child, idx) => {
    if (typeof child === "string") {
      if (!SENTINEL_RE.test(child)) return child;
      SENTINEL_RE.lastIndex = 0;
      const parts: ReactNode[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      let i = 0;
      while ((m = SENTINEL_RE.exec(child)) !== null) {
        if (m.index > last) parts.push(child.slice(last, m.index));
        const tok = tokens[parseInt(m[1], 10)];
        if (tok?.key) {
          parts.push(<PlaceholderInput key={`ph-${idx}-${i}-${tok.key}`} phKey={tok.key} />);
        } else if (tok) {
          parts.push(
            <span key={`unk-${idx}-${i}`} className="text-amber-700">{tok.raw}</span>,
          );
        }
        last = m.index + m[0].length;
        i++;
      }
      if (last < child.length) parts.push(child.slice(last));
      return <Fragment>{parts}</Fragment>;
    }
    if (isValidElement(child)) {
      const props = child.props as { children?: ReactNode };
      if (props.children !== undefined) {
        return cloneElement(child, undefined, transformChildrenStable(props.children, tokens));
      }
    }
    return child;
  });
}

/**
 * Render the builder-template body as proper markdown (headings, lists,
 * bold, italics, links, blockquotes, etc.) with `{{placeholder}}` tokens
 * swapped for interactive inputs.
 *
 * Memoized on `body` alone — PlaceholderInput reads its current value from
 * PlaceholderCtx so this whole subtree never has to re-render when the
 * user types into an input. That fixes the "loses focus after one letter"
 * bug caused by the old inline-`components` prop creating new function
 * types on every render.
 */
const MarkdownBody = memo(function MarkdownBody({ body }: { body: string }) {
  const { source, tokens } = useMemo(() => extractTokens(body), [body]);
  const components = useMemo(() => {
    const wrap = (children: ReactNode) => transformChildrenStable(children, tokens);
    return {
      h1: ({ children }: { children?: ReactNode }) => <h2 className="font-sans font-bold text-xl mt-6 mb-3 text-slate-900">{wrap(children)}</h2>,
      h2: ({ children }: { children?: ReactNode }) => <h3 className="font-sans font-semibold text-base mt-5 mb-2 text-slate-900">{wrap(children)}</h3>,
      h3: ({ children }: { children?: ReactNode }) => <h4 className="font-sans font-semibold text-sm mt-4 mb-2 text-slate-900 uppercase tracking-wide">{wrap(children)}</h4>,
      h4: ({ children }: { children?: ReactNode }) => <h5 className="font-sans font-semibold text-sm mt-3 mb-1 text-slate-700">{wrap(children)}</h5>,
      p: ({ children }: { children?: ReactNode }) => <p className="my-3 leading-relaxed">{wrap(children)}</p>,
      ul: ({ children }: { children?: ReactNode }) => <ul className="list-disc pl-6 my-3 space-y-1">{children}</ul>,
      ol: ({ children }: { children?: ReactNode }) => <ol className="list-decimal pl-6 my-3 space-y-1">{children}</ol>,
      li: ({ children }: { children?: ReactNode }) => <li>{wrap(children)}</li>,
      strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold">{wrap(children)}</strong>,
      em: ({ children }: { children?: ReactNode }) => <em className="italic">{wrap(children)}</em>,
      blockquote: ({ children }: { children?: ReactNode }) => <blockquote className="border-l-4 border-slate-300 pl-4 my-3 text-slate-600 italic">{children}</blockquote>,
      a: ({ children, href }: { children?: ReactNode; href?: string }) => {
        // Only allow http(s) links to keep stored XSS off the table.
        const safe = typeof href === "string" && /^https?:\/\//i.test(href) ? href : undefined;
        return safe
          ? <a href={safe} target="_blank" rel="noopener noreferrer" className="text-primary underline">{wrap(children)}</a>
          : <span>{wrap(children)}</span>;
      },
      hr: () => <hr className="my-6 border-slate-200" />,
      code: ({ children }: { children?: ReactNode }) => <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-800 text-sm">{children}</code>,
    };
  }, [tokens]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Disable raw HTML in templates — we never want admins to inject markup
      // that bypasses the placeholder/input pipeline.
      skipHtml
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
});

function InitialImage({ value }: { value: string }) {
  return (
    <img
      src={value}
      alt="initial"
      className="inline-block align-middle h-8 w-auto mx-1 bg-white border border-blue-200 rounded px-1"
    />
  );
}

function DrawnInitialButton({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 align-middle mx-1 h-8 px-2 rounded bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium font-sans hover:bg-amber-100"
        title={label}
      >
        {value && value.startsWith("data:image/") ? (
          <InitialImage value={value} />
        ) : value ? (
          <span
            className="text-base text-slate-900 px-1"
            style={{ fontFamily: "'Brush Script MT','Lucida Handwriting','Segoe Script',cursive" }}
          >
            {value}
          </span>
        ) : (
          <>
            <Pencil className="w-3 h-3" />
            <span>Initial here</span>
          </>
        )}
      </button>
      <InitialDialog
        open={open}
        onOpenChange={setOpen}
        label={label}
        onSave={(dataUrl) => {
          onChange(dataUrl);
          setOpen(false);
        }}
      />
    </>
  );
}

function InitialDialog({
  open,
  onOpenChange,
  label,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  onSave: (dataUrl: string) => void;
}) {
  const [sig, setSig] = useState<SignatureResult | null>(null);
  // Reset captured signature when dialog re-opens.
  useEffect(() => {
    if (open) setSig(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <SignaturePad defaultName="" onChange={setSig} height={140} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!sig} onClick={() => sig && onSave(sig.value)}>Save initial</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlaceholderInput({ phKey }: { phKey: string }) {
  const ctx = useContext(PlaceholderCtx);
  if (!ctx) return null;
  const placeholder = ctx.placeholdersByKey.get(phKey);
  if (!placeholder) return null;
  const value = ctx.values[phKey] ?? "";
  const onChange = (v: string) => ctx.setVal(phKey, v);
  const readOnly = ctx.readOnly;
  const isAdminLocked = (placeholder.role ?? "client") === "admin";
  const baseInline =
    "inline-block align-baseline mx-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-slate-900 font-medium font-sans text-[14px] focus:outline-none focus:ring-2 focus:ring-amber-400";

  // Admin-role: render as a locked, styled span using the admin's value (no edit).
  if (isAdminLocked) {
    if (placeholder.type === "initial" && value && value.startsWith("data:image/")) {
      return <InitialImage value={value} />;
    }
    return (
      <span
        className="inline-block mx-1 px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-900 font-semibold font-sans text-[14px]"
        title={`Filled by ${BRAND_NAME}`}
      >
        {value || placeholder.label}
      </span>
    );
  }

  if (readOnly) {
    if (placeholder.type === "initial") {
      if (value && value.startsWith("data:image/")) return <InitialImage value={value} />;
      return (
        <span className="inline-flex items-center justify-center w-12 h-7 mx-1 align-middle bg-blue-50 border border-blue-300 rounded text-blue-900 font-bold text-xs">
          {value || "—"}
        </span>
      );
    }
    return (
      <span className="inline-block mx-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-slate-900 font-medium font-sans text-[14px]">
        {value || "—"}
      </span>
    );
  }
  if (placeholder.type === "initial") {
    return <DrawnInitialButton value={value} onChange={onChange} label={placeholder.label} />;
  }
  if (placeholder.type === "date") {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={placeholder.label}
        className={`${baseInline} w-44`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder.label}
      title={placeholder.label}
      className={`${baseInline} min-w-[180px]`}
      style={{ width: `${Math.max(180, (value.length || placeholder.label.length) * 9 + 20)}px` }}
    />
  );
}

// ============================================================
// Uploaded (PDF + overlay) agreement view — original flow
// ============================================================
function UploadedAgreement({
  aid,
  data,
  fullName,
  qc,
  isImpersonating,
}: {
  aid: number;
  data: Assignment;
  fullName: string;
  qc: ReturnType<typeof useQueryClient>;
  isImpersonating: boolean;
}) {
  const t = data.template!;
  const [values, setValues] = useState<Record<string, FieldValue>>({});

  const signM = useMutation({
    mutationFn: () =>
      api(`/me/agreements/${aid}/sign`, {
        method: "POST",
        json: { fieldValues: Object.values(values) },
      }),
    onSuccess: () => {
      toast.success("Submitted! Awaiting counter-signature.");
      qc.invalidateQueries({ queryKey: ["client-agreement", aid] });
      qc.invalidateQueries({ queryKey: ["client-agreements"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const clientFields = (t.fields ?? []).filter((f) => f.role === "client");
  const allFilled = clientFields.every((f) => values[f.id]?.value);
  const isReadOnly = data.status === "client_signed" || data.status === "completed";
  const showSigned = data.status === "completed" && data.hasSignedPdf;
  const pdfUrl = apiPdfUrl(`/me/agreements/${aid}/pdf${showSigned ? "?signed=1" : ""}`);

  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-20">
      <Link href="/">
        <Button variant="ghost" className="-ml-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <Badge variant="outline" className="mt-1">{data.status}</Badge>
        </div>
        {showSigned && (
          <a href={pdfUrl} download target="_blank" rel="noreferrer">
            <Button variant="outline"><Download className="w-4 h-4 mr-2" /> Download signed PDF</Button>
          </a>
        )}
      </div>

      {!isReadOnly && clientFields.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Complete the fields below</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {clientFields.map((f) => (
              <div key={f.id} className="space-y-2 border-b last:border-0 pb-4 last:pb-0">
                <div className="text-sm font-medium">
                  {f.label || f.type.toUpperCase()} <span className="text-xs text-muted-foreground">(page {f.page})</span>
                </div>
                <ClientFieldInput
                  field={f}
                  defaultName={fullName}
                  onChange={(v) => setValues((p) => ({ ...p, [f.id]: v }))}
                />
              </div>
            ))}
            {isImpersonating && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                You're previewing as this client. Signing is disabled in preview — exit preview mode to take this action.
              </div>
            )}
            <Button onClick={() => signM.mutate()} disabled={!allFilled || signM.isPending || isImpersonating} size="lg">
              <CheckCircle2 className="w-4 h-4 mr-2" /> Submit signed agreement
            </Button>
          </CardContent>
        </Card>
      )}

      {!isReadOnly && clientFields.length === 0 && (
        <Card>
          <CardContent className="py-6 flex items-center justify-between">
            <div>No client fields are required. Acknowledge to continue.</div>
            <Button onClick={() => signM.mutate()} disabled={signM.isPending || isImpersonating}>
              {isImpersonating ? "Disabled in preview" : "Acknowledge"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {Array.from({ length: t.pageCount }, (_, i) => i + 1).map((p) => (
          <TrackedPage key={p} pdfUrl={pdfUrl} pageNumber={p} aid={aid} />
        ))}
      </div>
    </div>
  );
}

function TrackedPage({ pdfUrl, pageNumber, aid }: { pdfUrl: string; pageNumber: number; aid: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !fired.current) {
          fired.current = true;
          api(`/me/agreements/${aid}/page-view`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: pageNumber }),
          }).catch(() => {});
        }
      }
    }, { threshold: 0.4 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [aid, pageNumber]);
  return (
    <div ref={ref}>
      <PdfPage pdfUrl={pdfUrl} pageNumber={pageNumber} scale={1.2} />
    </div>
  );
}

function ClientFieldInput({
  field,
  defaultName,
  onChange,
}: {
  field: Field;
  defaultName: string;
  onChange: (v: FieldValue) => void;
}) {
  if (field.type === "signature" || field.type === "initial") {
    return (
      <SignaturePad
        defaultName={defaultName}
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
  if (field.type === "name") {
    return (
      <input
        type="text"
        className="border border-border rounded px-2 py-1 w-full"
        defaultValue={defaultName}
        onChange={(e) => onChange({ fieldId: field.id, value: e.target.value })}
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
