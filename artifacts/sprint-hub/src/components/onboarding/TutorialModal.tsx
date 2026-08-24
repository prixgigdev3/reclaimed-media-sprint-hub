import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen, FileSignature, LifeBuoy, PartyPopper } from "lucide-react";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { BRAND_APP_NAME } from "@/lib/brand";

const STEPS = [
  {
    icon: PartyPopper,
    title: `Welcome to ${BRAND_APP_NAME}`,
    body: "This is your space to work through the sprint. Quick tour — about 30 seconds.",
  },
  {
    icon: BookOpen,
    title: "Modules & Episodes",
    body: "Learning content is organised into modules. Episodes unlock as you complete them in order.",
  },
  {
    icon: FileSignature,
    title: "Agreements",
    body: "Some episodes require you to sign a short agreement first. Your signature is logged with the time and your IP for our records.",
  },
  {
    icon: LifeBuoy,
    title: "Support is one click away",
    body: "Stuck on something? Open the Support page from the sidebar and we'll get back to you by email.",
  },
];

export function TutorialModal({ open }: { open: boolean }) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();
  const Icon = STEPS[step].icon;
  const last = step === STEPS.length - 1;

  const finish = async () => {
    setSubmitting(true);
    try {
      await api("/me/onboarding/tutorial-complete", { method: "POST" });
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Icon className="w-6 h-6" />
          </div>
          <DialogTitle className="text-center">{STEPS[step].title}</DialogTitle>
          <DialogDescription className="text-center pt-2">{STEPS[step].body}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-1.5 py-2">
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"}`} />
          ))}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
          {last ? (
            <Button onClick={finish} disabled={submitting}>{submitting ? "Saving…" : "Get started"}</Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
