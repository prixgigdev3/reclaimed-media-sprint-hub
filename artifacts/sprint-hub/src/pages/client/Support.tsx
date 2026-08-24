import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
// Textarea is used by NewTicketForm below.
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LifeBuoy, Mail, ArrowLeft, Plus, Star } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { SupportComposer, AttachmentList, type AttachmentDraft, type RenderedAttachment } from "@/components/SupportComposer";

interface TicketSummary {
  id: number;
  subject: string;
  status: "open" | "resolved" | string;
  createdAt: string;
  lastMessageAt: string;
  resolvedAt: string | null;
}

interface TicketMessage {
  id: number;
  authorType: "client" | "admin";
  authorName: string;
  authorEmail: string | null;
  body: string;
  createdAt: string;
  attachments?: RenderedAttachment[];
}

interface TicketRating {
  resolutionRating: number;
  processRating: number;
  comment: string;
  createdAt: string;
}

interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
  rating: TicketRating | null;
}

export function ClientSupport() {
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    try {
      const list = await api<TicketSummary[]>("/me/support");
      setTickets(list);
    } catch {
      setTickets([]);
    }
  };

  useEffect(() => { void refresh(); }, []);

  if (activeId !== null) {
    return (
      <TicketView
        ticketId={activeId}
        onBack={() => { setActiveId(null); void refresh(); }}
      />
    );
  }

  if (creating) {
    return (
      <NewTicketForm
        onCancel={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); void refresh(); setActiveId(id); }}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <LifeBuoy className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Support</h1>
            <p className="text-muted-foreground">Conversations with the {BRAND_NAME} team.</p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-2" /> New request
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your tickets</CardTitle>
          <CardDescription>Click a ticket to view replies and continue the conversation.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tickets === null ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              You haven't opened any support tickets yet.
            </div>
          ) : (
            <div className="divide-y">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className="w-full text-left p-4 hover:bg-muted/40 transition-colors flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.subject}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Last update {new Date(t.lastMessageAt).toLocaleString()}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "resolved") {
    return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Resolved</Badge>;
  }
  return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Open</Badge>;
}

function NewTicketForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      const t = await api<{ id: number }>("/me/support", {
        method: "POST",
        json: { subject, body },
      });
      toast.success("Support request sent");
      onCreated(t.id);
    } catch {
      toast.error("Could not send. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-2xl">
      <Button variant="ghost" onClick={onCancel} className="-ml-3 text-muted-foreground">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to tickets
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Mail className="w-4 h-4" /> New request</CardTitle>
          <CardDescription>We typically respond within one business day.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What do you need help with?" required maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Message</Label>
              <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Tell us a bit more…" rows={8} required maxLength={8000} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !subject.trim() || !body.trim()}>
                {submitting ? "Sending…" : "Send request"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function TicketView({ ticketId, onBack }: { ticketId: number; onBack: () => void }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const t = await api<TicketDetail>(`/me/support/${ticketId}`);
      setTicket(t);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }, 50);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load ticket");
    }
  };

  useEffect(() => { void load(); }, [ticketId]);

  const send = async (body: string, attachments: AttachmentDraft[]) => {
    await api(`/me/support/${ticketId}/messages`, {
      method: "POST",
      json: { body, attachments },
    });
    await load();
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-3xl">
      <Button variant="ghost" onClick={onBack} className="-ml-3 text-muted-foreground">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to tickets
      </Button>
      {ticket === null ? (
        <Skeleton className="h-[60vh] w-full" />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Opened {new Date(ticket.createdAt).toLocaleString()}
                {ticket.resolvedAt && ` · Resolved ${new Date(ticket.resolvedAt).toLocaleString()}`}
              </p>
            </div>
            <StatusBadge status={ticket.status} />
          </div>

          <Card>
            <CardContent className="p-0">
              <div ref={scrollRef} className="max-h-[55vh] overflow-y-auto p-4 space-y-3">
                {ticket.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.authorType === "client" ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm border ${m.authorType === "client" ? "bg-primary text-primary-foreground border-primary/40" : "bg-muted text-foreground border-border"}`}>
                      <div className={`text-[11px] font-medium opacity-80 mb-0.5 ${m.authorType === "client" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {m.authorName} · {new Date(m.createdAt).toLocaleString()}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <AttachmentList items={m.attachments ?? []} />
                    </div>
                  </div>
                ))}
                {ticket.messages.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-12">
                    No messages yet.
                  </div>
                )}
              </div>
              <SupportComposer
                onSend={send}
                placeholder={ticket.status === "resolved" ? "Replying will reopen this ticket…" : "Type your reply… (paste a Loom link or attach a screenshot)"}
              />
            </CardContent>
          </Card>

          {ticket.status === "resolved" && (
            <RatingSection
              ticketId={ticket.id}
              existing={ticket.rating}
              onSaved={() => void load()}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Two 1-5 ratings shown after a ticket is resolved:
 *   - Resolution: did this actually solve your problem?
 *   - Process:    how was the experience working with us?
 * If the client has already rated, we show their scores read-only with an
 * "Update rating" affordance so they can revise.
 */
function RatingSection({
  ticketId,
  existing,
  onSaved,
}: {
  ticketId: number;
  existing: TicketRating | null;
  onSaved: () => void;
}) {
  const [resolution, setResolution] = useState<number>(existing?.resolutionRating ?? 0);
  const [process, setProcess] = useState<number>(existing?.processRating ?? 0);
  const [comment, setComment] = useState<string>(existing?.comment ?? "");
  const [editing, setEditing] = useState<boolean>(!existing);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!resolution || !process) {
      toast.error("Please pick a rating for both questions");
      return;
    }
    setSaving(true);
    try {
      await api(`/me/support/${ticketId}/rating`, {
        method: "POST",
        json: { resolutionRating: resolution, processRating: process, comment },
      });
      toast.success("Thanks for the feedback!");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save rating");
    } finally {
      setSaving(false);
    }
  };

  if (existing && !editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
            Your feedback
          </CardTitle>
          <CardDescription>
            Thanks — submitted {new Date(existing.createdAt).toLocaleDateString()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReadOnlyRating label="Did this resolve your issue?" value={existing.resolutionRating} />
          <ReadOnlyRating label="How was the experience?" value={existing.processRating} />
          {existing.comment && (
            <p className="text-sm text-muted-foreground italic border-l-2 pl-3">"{existing.comment}"</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Update rating
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How did we do?</CardTitle>
        <CardDescription>
          Now that this ticket is resolved, your honest feedback helps us improve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StarPicker label="Did this resolve your issue?" value={resolution} onChange={setResolution} />
        <StarPicker label="How was the experience getting it sorted?" value={process} onChange={setProcess} />
        <div className="space-y-1.5">
          <Label htmlFor="rating-comment" className="text-sm">Anything else? (optional)</Label>
          <Textarea
            id="rating-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What worked well, what didn't…"
          />
        </div>
        <div className="flex justify-end gap-2">
          {existing && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button onClick={submit} disabled={saving || !resolution || !process}>
            {saving ? "Saving…" : existing ? "Update rating" : "Submit rating"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StarPicker({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState<number>(0);
  const display = hover || value;
  return (
    <div>
      <div className="text-sm font-medium mb-1.5">{label}</div>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            className="p-1 -m-1 rounded hover:bg-muted transition-colors"
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
          >
            <Star
              className={`w-7 h-7 ${n <= display ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`}
            />
          </button>
        ))}
        {value > 0 && <span className="text-xs text-muted-foreground ml-2">{value}/5</span>}
      </div>
    </div>
  );
}

function ReadOnlyRating({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`w-4 h-4 ${n <= value ? "text-amber-500 fill-amber-500" : "text-muted-foreground/40"}`}
          />
        ))}
        <span className="text-xs text-muted-foreground ml-2">{value}/5</span>
      </div>
    </div>
  );
}
