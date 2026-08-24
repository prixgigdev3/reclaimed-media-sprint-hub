import { Badge } from "@/components/ui/badge";

export type ClientStage =
  | "agreement_pending"
  | "modules_in_progress"
  | "icp_pending"
  | "awaiting_review"
  | "sprint_active"
  | "sprint_complete"
  | "monthly"
  | "offboarded"
  | "paused";

export const STAGE_LABEL: Record<ClientStage, string> = {
  agreement_pending: "Agreement pending",
  modules_in_progress: "Modules in progress",
  icp_pending: "ICP pending",
  awaiting_review: "Awaiting review",
  sprint_active: "Sprint active",
  sprint_complete: "Sprint complete",
  monthly: "Monthly retainer",
  offboarded: "Offboarded",
  paused: "Paused",
};

export function StageBadge({ stage }: { stage: string }) {
  const label = STAGE_LABEL[stage as ClientStage] ?? stage;
  switch (stage as ClientStage) {
    case "agreement_pending":
      return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600">{label}</Badge>;
    case "modules_in_progress":
      return <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">{label}</Badge>;
    case "icp_pending":
      return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600">{label}</Badge>;
    case "awaiting_review":
      return <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">{label}</Badge>;
    case "sprint_active":
      return <Badge className="bg-primary hover:bg-primary/90">{label}</Badge>;
    case "sprint_complete":
      return <Badge className="bg-success hover:bg-success/90">{label}</Badge>;
    case "monthly":
      return <Badge className="bg-secondary hover:bg-secondary/90">{label}</Badge>;
    case "offboarded":
      return <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">{label}</Badge>;
    case "paused":
      return <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}
