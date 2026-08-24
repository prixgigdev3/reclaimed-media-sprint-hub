import { useParams, Link, useLocation } from "wouter";
import { useGetClientEpisode, useCompleteClientEpisode, useUpdateClientEpisodeChecklist, useListClientModules, useGetMe, getGetClientEpisodeQueryKey, getListClientModulesQueryKey, getGetClientDashboardQueryKey } from "@workspace/api-client-react";
import { IcpForm } from "./Icp";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BRAND_NAME } from "@/lib/brand";
import { ArrowLeft, CheckCircle2, Video, Link2, Type, Paperclip, Upload, FileIcon, Trash2, Download, Lock } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { uploadFile, formatBytes } from "@/lib/uploads";

export function ClientEpisode() {
  const { episodeId } = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: episode, isLoading } = useGetClientEpisode(Number(episodeId), {
    query: { enabled: !!episodeId, queryKey: getGetClientEpisodeQueryKey(Number(episodeId)) }
  });

  // We need the full module list so we can figure out the next lesson to jump
  // to after a successful "Mark as complete".
  const { data: modules } = useListClientModules({
    query: { queryKey: getListClientModulesQueryKey() },
  });

  const completeMutation = useCompleteClientEpisode({
    mutation: {
      onSuccess: async () => {
        toast.success("Episode completed");
        queryClient.invalidateQueries({ queryKey: getGetClientEpisodeQueryKey(Number(episodeId)) });
        queryClient.invalidateQueries({ queryKey: getListClientModulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetClientDashboardQueryKey() });

        // Auto-advance: always fetch a fresh module list from the server here
        // rather than trusting the cached `modules` query, which may not have
        // populated yet if the user navigated straight into a lesson. The
        // server response includes the just-completed episode marked complete,
        // so the first non-completed episode after this one is the right
        // next stop. Falls through any number of fully-completed modules.
        let next: { id: number } | undefined;
        try {
          const fresh = (modules && modules.length > 0)
            ? modules
            : await api<Array<{ id: number; episodes: Array<{ id: number; completed: boolean }> }>>(
                "/me/modules",
              );
          const flat = fresh.flatMap((m) => m.episodes);
          const idx = flat.findIndex((e) => e.id === Number(episodeId));
          next = idx >= 0 ? flat.slice(idx + 1).find((e) => !e.completed) : undefined;
        } catch {
          /* fall through to module page */
        }
        if (next) {
          setLocation(`/episodes/${next.id}`);
        } else if (episode?.moduleId) {
          setLocation(`/modules/${episode.moduleId}`);
        }
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to mark complete";
        toast.error(msg);
      },
    }
  });

  const checklistMutation = useUpdateClientEpisodeChecklist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientEpisodeQueryKey(Number(episodeId)) });
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to update checklist";
        toast.error(msg);
      },
    }
  });

  // ICP-kind episodes render the questionnaire inline (see render below).
  // They used to redirect to a separate /icp page; now ICP lives entirely
  // inside the lesson tree so clients stay in context.

  // Episode watch tracking: ping initial view + position every 20s
  const startedAt = useRef<number>(Date.now());
  const lastSent = useRef<number>(0);
  useEffect(() => {
    if (!episode || episode.kind === 'icp') return;
    const epId = episode.id;
    startedAt.current = Date.now();
    // initial view + increment watch count
    api(`/me/episodes/${epId}/progress`, {
      method: "PATCH",
      json: { positionSeconds: 0, incrementWatchCount: true },
    }).catch(() => {});

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      if (elapsed - lastSent.current >= 15) {
        lastSent.current = elapsed;
        api(`/me/episodes/${epId}/progress`, {
          method: "PATCH",
          json: { positionSeconds: elapsed },
        }).catch(() => {});
      }
    };
    const interval = window.setInterval(tick, 15000);
    const onUnload = () => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      try {
        navigator.sendBeacon?.(
          `/api/me/episodes/${epId}/progress`,
          new Blob([JSON.stringify({ positionSeconds: elapsed })], { type: "application/json" }),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
      onUnload();
    };
  }, [episode?.id, episode?.kind]);

  if (isLoading) {
    return <Skeleton className="h-[60vh] w-full" />;
  }

  if (!episode) return <div>Episode not found.</div>;

  // Hard backstop: if the backend says this episode is locked (agreement
  // pending, previous module incomplete, or `requirePrevious` not met) we
  // refuse to render the lesson body so the client can't bypass the gate
  // by typing the URL directly. Direct them back where they need to go.
  if (episode.locked) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300 pb-20">
        <Link href={`/modules/${episode.moduleId}`}>
          <Button variant="ghost" className="-ml-4 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Module
          </Button>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold">{episode.title}</h1>
          <p className="text-muted-foreground">
            This lesson isn't available yet. Sign your agreement and finish the previous lessons to unlock it.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Link href="/">
              <Button>Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (episode.kind === 'icp') {
    return (
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
        <Link href={`/modules/${episode.moduleId}`}>
          <Button variant="ghost" className="-ml-4 text-muted-foreground mb-2">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Module
          </Button>
        </Link>
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{episode.title}</h1>
          <p className="text-muted-foreground">
            Complete the 34-question Ideal Customer Profile. Submitting marks this lesson complete.
          </p>
          {episode.completed && (
            <div className="inline-flex items-center text-sm font-medium text-success bg-success/10 px-3 py-1 rounded-full">
              <CheckCircle2 className="w-4 h-4 mr-2" /> Completed
            </div>
          )}
        </div>
        <IcpForm embedded />
      </div>
    );
  }

  const handleToggleChecklist = (id: number, checked: boolean) => {
    const current = episode.checklistChecked || [];
    const updated = checked ? [...current, id] : current.filter(itemId => itemId !== id);
    checklistMutation.mutate({ episodeId: episode.id, data: { checked: updated } });
  };

  const handleSaveResponse = (id: number, value: string) => {
    const current = (episode as { checklistResponses?: Record<string, string> }).checklistResponses ?? {};
    const updated = { ...current, [String(id)]: value };
    api(`/me/episodes/${episode.id}/checklist`, {
      method: "PATCH",
      json: { responses: updated },
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: getGetClientEpisodeQueryKey(episode.id) });
        toast.success("Saved");
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <Link href={`/modules/${episode.moduleId}`}>
        <Button variant="ghost" className="-ml-4 text-muted-foreground mb-2">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Module
        </Button>
      </Link>

      <div className="space-y-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{episode.title}</h1>
        {episode.completed && (
          <div className="inline-flex items-center text-sm font-medium text-success bg-success/10 px-3 py-1 rounded-full">
            <CheckCircle2 className="w-4 h-4 mr-2" /> Completed
          </div>
        )}
      </div>

      {/* Video Player Area — only render the dark player block when the
          admin has actually attached a video. Direct video files (.mp4/.webm)
          and uploads served from /storage/lesson-videos/ render with a
          native <video> element so seek/playback works; embeds from
          YouTube/Vimeo/Loom render in an iframe. */}
      {episode.videoUrl && (() => {
        const url = episode.videoUrl;
        // Lesson-video uploads are stored with the api-server's `/api` prefix
        // baked in (e.g. `/api/storage/lesson-videos/<id>`), so the browser
        // can hit them directly through the shared path-routed proxy.
        const isLessonUpload =
          url.startsWith("/api/storage/lesson-videos/") ||
          url.startsWith("/storage/lesson-videos/");
        const isDirectFile = /\.(mp4|webm)(\?|#|$)/i.test(url);
        if (isLessonUpload || isDirectFile) {
          // Tolerate older relative `/storage/lesson-videos/...` values by
          // adding the `/api` prefix at render time.
          const src = url.startsWith("/storage/lesson-videos/") ? `/api${url}` : url;
          return (
            <div className="w-full aspect-video bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-border">
              <video
                controls
                preload="metadata"
                playsInline
                className="w-full h-full block"
                data-testid="video-episode-player"
              >
                <source src={src} />
                Your browser does not support embedded video. <a href={src} className="underline">Download</a>.
              </video>
            </div>
          );
        }
        return (
          <div className="w-full aspect-video bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-border flex items-center justify-center relative">
            <iframe
              src={url}
              className="w-full h-full absolute inset-0"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            ></iframe>
          </div>
        );
      })()}

      {/* Content Area */}
      {episode.copy && (
        <div className="prose prose-slate dark:prose-invert max-w-none">
          {episode.copy.split('\n\n').map((paragraph, i) => {
            // Filename-only (no slashes, no '..', must end in .mp4 or .webm).
            // This intentionally cannot escape the public /walkthroughs/ folder.
            const videoMatch = paragraph.trim().match(/^\[\[VIDEO:([a-zA-Z0-9_\-]+\.(?:mp4|webm))\]\](?:\s*([\s\S]*))?$/);
            if (videoMatch) {
              const file = videoMatch[1];
              const caption = videoMatch[2]?.trim();
              return (
                <VideoWalkthrough key={i} file={file} caption={caption} index={i} />
              );
            }
            return <p key={i}>{paragraph}</p>;
          })}
        </div>
      )}

      {/* Checklist Area */}
      {episode.kind === 'checklist' && episode.checklistItems && episode.checklistItems.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4 mt-8">
          <h3 className="text-xl font-bold">Action Items</h3>
          <div className="space-y-4">
            {episode.checklistItems.map((item) => {
              const it = item as { id: number; label: string; kind?: 'check' | 'url' | 'text' };
              const kind = it.kind ?? 'check';
              const responses = (episode as { checklistResponses?: Record<string, string> }).checklistResponses ?? {};
              const savedValue = responses[String(it.id)] ?? "";
              if (kind === 'url' || kind === 'text') {
                return (
                  <ChecklistInput
                    key={it.id}
                    item={it}
                    kind={kind}
                    initialValue={savedValue}
                    onSave={(v) => handleSaveResponse(it.id, v)}
                  />
                );
              }
              const isChecked = episode.checklistChecked?.includes(it.id) || false;
              return (
                <div key={it.id} className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id={`check-${it.id}`}
                    checked={isChecked}
                    onCheckedChange={(checked) => handleToggleChecklist(it.id, checked as boolean)}
                    className="mt-1"
                  />
                  <label
                    htmlFor={`check-${it.id}`}
                    className={`text-base font-medium leading-none cursor-pointer ${isChecked ? 'line-through text-muted-foreground' : ''}`}
                  >
                    {it.label}
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resources from the team */}
      <EpisodeResources episodeId={episode.id} />

      {/* Client uploads */}
      <EpisodeUploads episodeId={episode.id} />

      {/* Action Footer */}
      <div className="pt-8 border-t border-border flex justify-end">
        <Button 
          size="lg" 
          onClick={() => completeMutation.mutate({ episodeId: episode.id })}
          disabled={episode.completed || completeMutation.isPending}
          className={episode.completed ? 'bg-success text-success-foreground' : ''}
        >
          {episode.completed ? (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" /> Completed
            </>
          ) : (
            'Mark as Complete'
          )}
        </Button>
      </div>
    </div>
  );
}

interface AssetRow {
  id: number;
  name: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}
interface UploadRow extends AssetRow {
  checklistItemId: number | null;
  kind: "file" | "link";
  objectPath: string | null;
  linkUrl: string | null;
}

function VideoWalkthrough({ file, caption, index }: { file: string; caption?: string; index: number }) {
  const [errored, setErrored] = useState(false);
  const src = `${import.meta.env.BASE_URL}walkthroughs/${file}`;
  if (errored) {
    return (
      <div className="not-prose my-6 rounded-xl border border-border bg-muted/30 p-4 text-sm" data-testid={`video-walkthrough-${index}-error`}>
        <p className="font-medium">Walkthrough video is temporarily unavailable.</p>
        <p className="text-muted-foreground mt-1">
          You can still follow the written steps below. <a href={src} className="underline">Try downloading the video</a> or contact support if this persists.
        </p>
      </div>
    );
  }
  return (
    <figure className="not-prose my-6 rounded-xl overflow-hidden border border-border bg-black">
      <video
        controls
        preload="metadata"
        playsInline
        className="w-full h-auto block"
        onError={() => setErrored(true)}
        data-testid={`video-walkthrough-${index}`}
      >
        <source src={src} type="video/mp4" />
        Your browser does not support embedded video. <a href={src} className="underline">Download the walkthrough</a>.
      </video>
      {caption && (
        <figcaption className="px-4 py-2 text-sm text-muted-foreground bg-card">{caption}</figcaption>
      )}
    </figure>
  );
}

function EpisodeResources({ episodeId }: { episodeId: number }) {
  const [items, setItems] = useState<AssetRow[] | null>(null);
  useEffect(() => {
    api<AssetRow[]>(`/me/episodes/${episodeId}/assets`).then(setItems).catch(() => setItems([]));
  }, [episodeId]);
  if (!items || items.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
      <h3 className="text-xl font-bold flex items-center gap-2"><Paperclip className="w-5 h-5" /> Resources</h3>
      <div className="space-y-2">
        {items.map((a) => (
          <a
            key={a.id}
            href={`/api/me/files/asset/${a.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileIcon className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</div>
              </div>
            </div>
            <Download className="w-4 h-4 text-muted-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}

function EpisodeUploads({ episodeId }: { episodeId: number }) {
  const [items, setItems] = useState<UploadRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The backend blocks /me/* writes when an admin is impersonating a client
  // (otherwise the activity feed would falsely show the client uploading).
  // Detect that here so we can disable the buttons and explain why instead
  // of letting the click silently 403.
  const { data: me } = useGetMe();
  const impersonating = !!(me as unknown as { impersonating?: boolean })?.impersonating;
  // Inline "share a link" form state. Kept inline (not a modal) so the
  // client doesn't have to context-switch — most people sharing a Drive or
  // Dropbox link are pasting from clipboard, not browsing.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const linkValid = linkUrl.trim() === "" || /^https?:\/\//i.test(linkUrl.trim());

  const refresh = () => api<UploadRow[]>(`/me/episodes/${episodeId}/uploads`).then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); }, [episodeId]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile(file);
      await api(`/me/episodes/${episodeId}/uploads`, { method: "POST", json: { kind: "file", ...up } });
      toast.success("Uploaded");
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const submitLink = async () => {
    const url = linkUrl.trim();
    const name = linkName.trim() || url;
    if (!url || !/^https?:\/\//i.test(url)) {
      toast.error("Link must start with http:// or https://");
      return;
    }
    setBusy(true);
    try {
      await api(`/me/episodes/${episodeId}/uploads`, {
        method: "POST",
        json: { kind: "link", name, linkUrl: url },
      });
      toast.success("Link saved");
      setLinkName("");
      setLinkUrl("");
      setLinkOpen(false);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save link";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api(`/me/uploads/${id}`, { method: "DELETE" });
      await refresh();
    } catch {
      toast.error("Could not delete");
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xl font-bold flex items-center gap-2"><Upload className="w-5 h-5" /> Your uploads</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setLinkOpen((v) => !v)} disabled={busy || impersonating}>
            <Link2 className="w-4 h-4 mr-2" /> Add link
          </Button>
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy || impersonating}>
            <Upload className="w-4 h-4 mr-2" /> {busy ? "Working…" : "Upload file"}
          </Button>
          <input ref={inputRef} type="file" className="hidden" onChange={onPick} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Share deliverables, screenshots, files, or links to a Google Drive / Dropbox / Figma / Loom with the {BRAND_NAME} team.</p>
      {impersonating && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm px-3 py-2">
          You're previewing as a client. Uploads and links are read-only here — exit preview to add them as the actual client.
        </div>
      )}
      {linkOpen && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <Label className="text-sm">Share a link</Label>
          <Input
            placeholder="Label (optional, e.g. 'Brand assets folder')"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
          />
          <Input
            placeholder="https://drive.google.com/..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            inputMode="url"
          />
          {!linkValid && (
            <div className="text-xs text-destructive">URL must start with http:// or https://</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => { setLinkOpen(false); setLinkName(""); setLinkUrl(""); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitLink} disabled={busy || !linkUrl.trim() || !linkValid}>
              Save link
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {items === null ? null : items.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-4">Nothing shared yet.</div>
        ) : items.map((u) => {
          const isLink = u.kind === "link";
          const href = isLink ? (u.linkUrl ?? "#") : `/api/me/files/upload/${u.id}`;
          const Icon = isLink ? Link2 : FileIcon;
          const meta = isLink
            ? `Link · ${new Date(u.createdAt).toLocaleString()}`
            : `${formatBytes(u.sizeBytes)} · ${new Date(u.createdAt).toLocaleString()}`;
          return (
            <div key={u.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background">
              <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 min-w-0 flex-1 hover:underline">
                <Icon className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{u.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{meta}</div>
                </div>
              </a>
              <Button variant="ghost" size="icon" onClick={() => remove(u.id)} aria-label="Delete">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChecklistInput({
  item,
  kind,
  initialValue,
  onSave,
}: {
  item: { id: number; label: string };
  kind: "url" | "text";
  initialValue: string;
  onSave: (v: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const dirty = value !== initialValue;
  const Icon = kind === "url" ? Link2 : Type;
  const validUrl = kind !== "url" || value.trim() === "" || /^https?:\/\//i.test(value.trim());
  return (
    <div className="p-3 rounded-lg hover:bg-muted/50 transition-colors space-y-2">
      <Label htmlFor={`resp-${item.id}`} className="flex items-center gap-2 text-base font-medium">
        <Icon className="w-4 h-4 text-primary" /> {item.label}
      </Label>
      {kind === "text" ? (
        <Textarea
          id={`resp-${item.id}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (dirty) onSave(value);
          }}
          placeholder="Type your response..."
          className="min-h-[80px]"
        />
      ) : (
        <Input
          id={`resp-${item.id}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (dirty && validUrl) onSave(value.trim());
          }}
          placeholder="https://..."
          inputMode="url"
        />
      )}
      {!validUrl && (
        <div className="text-xs text-destructive">URL must start with http:// or https://</div>
      )}
      {kind === "url" && initialValue && /^https?:\/\//i.test(initialValue) && (
        <a
          href={initialValue}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          <Link2 className="w-3 h-3" /> Open saved link
        </a>
      )}
    </div>
  );
}
