import { useGetMe } from "@workspace/api-client-react";
import { TutorialModal } from "./TutorialModal";
import { ConsentModal } from "./ConsentModal";

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data: me } = useGetMe();
  const c = me?.client as
    | { tutorialCompletedAt?: string | null; acceptedTermsAt?: string | null }
    | null
    | undefined;
  // While impersonating we skip the gate so admins can preview the portal.
  const impersonating = !!(me as unknown as { impersonating?: boolean })?.impersonating;
  const needsTutorial = !impersonating && !!c && !c.tutorialCompletedAt;
  const needsConsent = !impersonating && !!c && !!c.tutorialCompletedAt && !c.acceptedTermsAt;
  return (
    <>
      {children}
      <TutorialModal open={needsTutorial} />
      <ConsentModal open={needsConsent} />
    </>
  );
}
