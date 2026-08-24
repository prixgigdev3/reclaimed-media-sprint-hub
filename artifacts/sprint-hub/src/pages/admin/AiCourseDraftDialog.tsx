import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";

interface DraftModule {
  title: string;
  description: string;
}

interface CourseDraft {
  title: string;
  description: string;
  modules: DraftModule[];
}

interface CreatedCourse {
  id: number;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (course: CreatedCourse) => void;
}

// Two-stage AI course builder. Stage 1 = collect source material. Stage 2 =
// review and edit the AI's draft before persisting. The admin can still go
// back to stage 1 to regenerate, and every field in stage 2 is editable so
// the AI is a starting point, never a black box.
export function AiCourseDraftDialog({ open, onOpenChange, onCreated }: Props) {
  const [stage, setStage] = useState<"input" | "review">("input");
  const [source, setSource] = useState("");
  const [hint, setHint] = useState("");
  const [moduleCount, setModuleCount] = useState<number | "">("");
  const [draft, setDraft] = useState<CourseDraft | null>(null);

  const reset = () => {
    setStage("input");
    setSource("");
    setHint("");
    setModuleCount("");
    setDraft(null);
  };

  const closeAndReset = () => {
    reset();
    onOpenChange(false);
  };

  const draftMut = useMutation({
    mutationFn: (body: { source: string; hint: string; moduleCount: number | null }) =>
      api<CourseDraft>("/admin/courses/ai-draft", { method: "POST", json: body }),
    onSuccess: (d) => {
      setDraft(d);
      setStage("review");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not draft course");
    },
  });

  const createMut = useMutation({
    mutationFn: (body: CourseDraft) =>
      api<CreatedCourse>("/admin/courses/ai-create", { method: "POST", json: body }),
    onSuccess: (created) => {
      toast.success(`Course "${created.title}" created`);
      onCreated(created);
      onOpenChange(false);
      reset();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not create course");
    },
  });

  const handleGenerate = () => {
    const trimmed = source.trim();
    if (trimmed.length < 20) {
      toast.error("Paste at least a paragraph of source material.");
      return;
    }
    draftMut.mutate({
      source: trimmed,
      hint: hint.trim(),
      moduleCount: moduleCount === "" ? null : Number(moduleCount),
    });
  };

  const handleCreate = () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error("Course needs a title.");
      return;
    }
    if (draft.modules.length === 0) {
      toast.error("Course needs at least one module.");
      return;
    }
    createMut.mutate(draft);
  };

  const updateModule = (idx: number, patch: Partial<DraftModule>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      modules: draft.modules.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    });
  };
  const removeModule = (idx: number) => {
    if (!draft) return;
    setDraft({ ...draft, modules: draft.modules.filter((_, i) => i !== idx) });
  };
  const moveModule = (idx: number, dir: -1 | 1) => {
    if (!draft) return;
    const next = [...draft.modules];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setDraft({ ...draft, modules: next });
  };
  const addModule = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      modules: [...draft.modules, { title: "Untitled module", description: "" }],
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {stage === "input" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" /> Draft a course with AI
              </DialogTitle>
              <DialogDescription>
                Paste any source material — meeting notes, a transcript, a doc dump, even rough bullet points.
                The AI will propose a course title and a module breakdown for you to review and edit before
                anything is saved.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ai-source">Source material</Label>
                <Textarea
                  id="ai-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Paste notes, transcripts, an outline, or a brain dump here…"
                  className="min-h-48 font-mono text-xs leading-relaxed"
                />
                <p className="text-xs text-muted-foreground">
                  {source.length.toLocaleString()} characters
                  {source.length > 12000 && " (will be truncated to ~12,000 for the prompt)"}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-2">
                  <Label htmlFor="ai-hint">Optional focus / tone</Label>
                  <Input
                    id="ai-hint"
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="e.g. focus on B2B onboarding, beginner audience"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-count">Modules (optional)</Label>
                  <Input
                    id="ai-count"
                    type="number"
                    min={2}
                    max={12}
                    value={moduleCount}
                    onChange={(e) => {
                      const v = e.target.value;
                      setModuleCount(v === "" ? "" : Number(v));
                    }}
                    placeholder="auto"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeAndReset}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={draftMut.isPending}>
                {draftMut.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" /> Generate draft
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" /> Review draft
              </DialogTitle>
              <DialogDescription>
                Edit anything below — title, description, or any module. Nothing is saved until you click
                <strong> Create course</strong>.
              </DialogDescription>
            </DialogHeader>
            {draft && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>Course title</Label>
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="min-h-20"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Modules ({draft.modules.length})</Label>
                    <Button type="button" variant="ghost" size="sm" onClick={addModule}>
                      <Plus className="w-3 h-3 mr-1" /> Add module
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {draft.modules.map((m, idx) => (
                      <div key={idx} className="rounded-md border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground w-6">
                            {idx + 1}.
                          </span>
                          <Input
                            value={m.title}
                            onChange={(e) => updateModule(idx, { title: e.target.value })}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={idx === 0}
                            onClick={() => moveModule(idx, -1)}
                            title="Move up"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={idx === draft.modules.length - 1}
                            onClick={() => moveModule(idx, 1)}
                            title="Move down"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeModule(idx)}
                            title="Remove module"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                        <Textarea
                          value={m.description}
                          onChange={(e) => updateModule(idx, { description: e.target.value })}
                          className="text-sm min-h-16 ml-8"
                          placeholder="Module description"
                        />
                      </div>
                    ))}
                    {draft.modules.length === 0 && (
                      <div className="text-center py-6 text-sm text-muted-foreground italic">
                        No modules — add one or go back to regenerate.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStage("input")}
                disabled={createMut.isPending}
                className="sm:mr-auto"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to prompt
              </Button>
              <Button variant="outline" onClick={closeAndReset} disabled={createMut.isPending}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createMut.isPending}>
                {createMut.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…
                  </>
                ) : (
                  <>Create course</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
