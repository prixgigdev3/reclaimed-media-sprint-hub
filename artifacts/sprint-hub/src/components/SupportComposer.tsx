import { useRef, useState, type FormEvent } from "react";
import { Paperclip, Image as ImageIcon, Link2, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "sonner";

export interface AttachmentDraft {
  kind: "image" | "file" | "link";
  name: string;
  url?: string | null;
  objectPath?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  // local-only previews
  previewUrl?: string;
}

interface AttachmentChipProps {
  att: AttachmentDraft;
  onRemove?: () => void;
}

function Chip({ att, onRemove }: AttachmentChipProps) {
  const Icon = att.kind === "image" ? ImageIcon : att.kind === "link" ? Link2 : Paperclip;
  return (
    <div className="inline-flex items-center gap-1.5 max-w-full text-xs px-2 py-1 rounded-md border bg-muted/50">
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate max-w-[200px]">{att.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-1 text-muted-foreground hover:text-destructive">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

const URL_RE = /\bhttps?:\/\/\S+/i;

function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("loom.com")) return `Loom video — ${u.pathname.split("/").filter(Boolean).pop() ?? "share"}`;
    return u.hostname;
  } catch {
    return url.slice(0, 80);
  }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function SupportComposer({
  onSend,
  placeholder,
  disabled,
}: {
  onSend: (body: string, attachments: AttachmentDraft[]) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [body, setBody] = useState("");
  const [atts, setAtts] = useState<AttachmentDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleBodyChange = (val: string) => {
    setBody(val);
    // Auto-detect a pasted URL when one appears that we haven't already chipped.
    const m = val.match(URL_RE);
    if (m && !atts.some((a) => a.kind === "link" && a.url === m[0])) {
      setAtts((cur) => [...cur, { kind: "link", name: describeUrl(m[0]), url: m[0] }]);
    }
  };

  const removeAt = (idx: number) => setAtts((cur) => cur.filter((_, i) => i !== idx));

  const onPickFile = async (file: File) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("File too large (max 8 MB)");
      return;
    }
    setUploading(true);
    try {
      const meta = await api<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
        method: "POST",
        json: { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      });
      const put = await fetch(meta.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");
      const isImage = file.type.startsWith("image/");
      setAtts((cur) => [...cur, {
        kind: isImage ? "image" : "file",
        name: file.name,
        objectPath: meta.objectPath,
        contentType: file.type || null,
        sizeBytes: file.size,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() && atts.length === 0) return;
    setBusy(true);
    try {
      await onSend(body.trim(), atts);
      setBody("");
      setAtts([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border-t p-3 flex flex-col gap-2">
      <Textarea
        value={body}
        onChange={(e) => handleBodyChange(e.target.value)}
        placeholder={placeholder ?? "Type your reply… (paste a Loom link or attach a screenshot)"}
        rows={3}
        maxLength={8000}
        disabled={disabled || busy}
      />
      {atts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {atts.map((a, i) => <Chip key={i} att={a} onRemove={() => removeAt(i)} />)}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); }}
          />
          <Button
            type="button" size="sm" variant="ghost"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || disabled}
          >
            <Paperclip className="w-4 h-4 mr-1" /> {uploading ? "Uploading…" : "Attach"}
          </Button>
        </div>
        <Button type="submit" size="sm" disabled={busy || disabled || (!body.trim() && atts.length === 0)}>
          <Send className="w-4 h-4 mr-2" /> {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

export interface RenderedAttachment {
  id: number;
  kind: "image" | "file" | "link" | string;
  name: string;
  url: string | null;
  objectPath: string | null;
  contentType: string | null;
  sizeBytes: number | null;
}

/**
 * Renders a row of attachments below a chat bubble. For image/file uploads,
 * uses /me/files/<rest> proxy (auth-scoped). For links, opens externally.
 */
export function AttachmentList({ items }: { items: RenderedAttachment[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((a) => {
        if (a.kind === "link" && a.url) {
          return (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-background/40 border border-current/20 hover:bg-background/70">
              <Link2 className="w-3.5 h-3.5" />
              <span className="truncate max-w-[220px]">{a.name}</span>
            </a>
          );
        }
        if (a.kind === "image" && a.objectPath) {
          const src = `/api/me/files${a.objectPath.replace(/^\/objects/, "")}`;
          return (
            <a key={a.id} href={src} target="_blank" rel="noopener noreferrer" className="block">
              <img src={src} alt={a.name} className="max-h-40 max-w-[260px] rounded-md border" />
            </a>
          );
        }
        if (a.objectPath) {
          const src = `/api/me/files${a.objectPath.replace(/^\/objects/, "")}`;
          return (
            <a key={a.id} href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-background/40 border border-current/20 hover:bg-background/70">
              <Paperclip className="w-3.5 h-3.5" />
              <span className="truncate max-w-[220px]">{a.name}</span>
            </a>
          );
        }
        return null;
      })}
    </div>
  );
}
