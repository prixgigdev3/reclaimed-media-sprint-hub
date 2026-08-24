import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { BRAND_APP_NAME } from "@/lib/brand";

export function ConsentModal({ open }: { open: boolean }) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const submit = async () => {
    if (!checked) return;
    setSubmitting(true);
    try {
      await api("/me/onboarding/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
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
            <ShieldCheck className="w-6 h-6" />
          </div>
          <DialogTitle className="text-center">Terms & Privacy</DialogTitle>
          <DialogDescription className="text-center pt-2">
            Before you continue, please confirm you have read and accept the terms.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm text-muted-foreground bg-muted rounded-md p-4 space-y-2">
          <p>By using {BRAND_APP_NAME} you agree that:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>We record your sign-in time and IP address for security and audit.</li>
            <li>Agreements you sign on this platform are time- and IP-stamped and stored as a PDF.</li>
            <li>Episode progress (pages viewed, video watch time) is logged so we can support you.</li>
            <li>You can request deletion of your data at any time via the Support page.</li>
          </ul>
        </div>
        <label className="flex items-start gap-3 cursor-pointer pt-2">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" />
          <span className="text-sm">I have read and accept the terms and privacy notice.</span>
        </label>
        <DialogFooter>
          <Button onClick={submit} disabled={!checked || submitting} className="w-full">
            {submitting ? "Submitting…" : "Accept & continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
