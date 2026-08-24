import { useState, useEffect, useRef } from "react";
import { useGetClientIcp, useSaveClientIcp, useSubmitClientIcp, getGetClientIcpQueryKey, getGetClientDashboardQueryKey, getListClientModulesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

// Grouping structure for the 34 questions
const ICP_SECTIONS = [
  {
    id: "business",
    title: "About Your Business",
    questions: [
      { key: "q1_business_in_one_sentence", label: "Describe your business in one sentence.", type: "textarea" },
      { key: "q2_years_in_business", label: "How many years have you been in business?", type: "short" },
      { key: "q3_core_service", label: "What is your primary core service?", type: "short" },
      { key: "q4_unique_mechanism", label: "What makes your service unique?", type: "textarea" },
      { key: "q5_biggest_competitor", label: "Who is your biggest competitor?", type: "short" },
      { key: "q6_why_choose_you", label: "Why do clients choose you over them?", type: "textarea" },
      { key: "q7_current_mrr", label: "What is your current Monthly Recurring Revenue (MRR)?", type: "short" },
      { key: "q8_target_mrr", label: "What is your target MRR in 12 months?", type: "short" },
    ]
  },
  {
    id: "customers",
    title: "Your Customers",
    questions: [
      { key: "q9_ideal_client_demographic", label: "Describe your ideal client demographic.", type: "textarea" },
      { key: "q10_biggest_pain_point", label: "What is their biggest pain point right now?", type: "textarea" },
      { key: "q11_false_beliefs", label: "What false beliefs do they have about your industry?", type: "textarea" },
      { key: "q12_previous_solutions", label: "What other solutions have they tried and failed at?", type: "textarea" },
      { key: "q13_trigger_event", label: "What event triggers them to seek your service?", type: "textarea" },
      { key: "q14_dream_outcome", label: "What is their absolute dream outcome?", type: "textarea" },
      { key: "q15_objections", label: "What are their top 3 objections to buying?", type: "textarea" },
      { key: "q16_where_they_hang_out", label: "Where do they spend their time online?", type: "short" },
      { key: "q17_decision_maker", label: "Are they the sole decision maker?", type: "short" },
    ]
  },
  {
    id: "offer",
    title: "Your Offer",
    questions: [
      { key: "q18_offer_name", label: "What is the name of your core offer?", type: "short" },
      { key: "q19_offer_price", label: "What is the price?", type: "short" },
      { key: "q20_payment_terms", label: "What are the payment terms?", type: "short" },
      { key: "q21_guarantee", label: "Do you offer a guarantee? If so, what is it?", type: "textarea" },
      { key: "q22_bonuses", label: "What bonuses are included?", type: "textarea" },
      { key: "q23_time_delay", label: "How long until they see results?", type: "short" },
      { key: "q24_effort_required", label: "How much effort is required from the client?", type: "textarea" },
      { key: "q25_case_study_1", label: "Link to your best case study or testimonial.", type: "short" },
      { key: "q26_case_study_2", label: "Link to your second best case study.", type: "short" },
    ]
  },
  {
    id: "goals",
    title: "Your Goals",
    questions: [
      { key: "q27_primary_goal", label: "What is the #1 goal for this sprint?", type: "textarea" },
      { key: "q28_secondary_goal", label: "What is a secondary goal?", type: "textarea" },
      { key: "q29_current_cac", label: "What is your current Cost to Acquire a Customer (CAC)?", type: "short" },
      { key: "q30_target_cac", label: "What is your target CAC?", type: "short" },
      { key: "q31_monthly_budget", label: "What is your monthly ad budget?", type: "short" },
      { key: "q32_capacity", label: "How many new clients can you handle per month?", type: "short" },
      { key: "q33_sales_process", label: "Describe your sales process once a lead is generated.", type: "textarea" },
      { key: "q34_anything_else", label: "Anything else we should know?", type: "textarea" },
    ]
  }
];

const TOTAL_QUESTIONS = 34;

/**
 * Reusable ICP form. Renders the 34-question questionnaire, plus a submitted
 * read-only view when already submitted. Used both as a standalone page
 * (`ClientIcp`) and embedded inside ICP-kind episode lessons.
 */
export function IcpForm({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const { data: icpData, isLoading } = useGetClientIcp({
    query: { queryKey: getGetClientIcpQueryKey() }
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const saveMutation = useSaveClientIcp({
    mutation: {
      onSuccess: () => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      },
      onError: (e: unknown) => {
        setSaveStatus("idle");
        const msg = e instanceof Error ? e.message : "Auto-save failed";
        toast.error(`Couldn't save your answers: ${msg}`);
      },
    }
  });

  const submitMutation = useSubmitClientIcp({
    mutation: {
      onSuccess: () => {
        toast.success("ICP Submitted Successfully!");
        queryClient.invalidateQueries({ queryKey: getGetClientIcpQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetClientDashboardQueryKey() });
        // Modules query holds episode-completion state, including ICP-kind
        // episodes which the server auto-completes on submit. Refetch so the
        // lesson UI flips to "completed" without a manual reload.
        queryClient.invalidateQueries({ queryKey: getListClientModulesQueryKey() });
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to submit ICP";
        toast.error(msg);
      },
    }
  });

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize state once
  useEffect(() => {
    if (icpData && Object.keys(answers).length === 0) {
      setAnswers(icpData.answers || {});
    }
  }, [icpData]); // intentional: don't reset answers while typing

  const handleChange = (key: string, value: string) => {
    const newAnswers = { ...answers, [key]: value };
    setAnswers(newAnswers);
    setSaveStatus("saving");

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMutation.mutate({ data: { answers: newAnswers } });
    }, 600);
  };

  if (isLoading) return <Skeleton className="h-[60vh] w-full" />;
  if (!icpData) return null;

  const answeredCount = Object.values(answers).filter(v => v && v.trim().length > 0).length;
  const progress = (answeredCount / TOTAL_QUESTIONS) * 100;
  const canSubmit = answeredCount === TOTAL_QUESTIONS;

  if (icpData.submitted) {
    return (
      <div className={embedded ? "space-y-6" : "max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500"}>
        <div className="text-center py-8 bg-success/10 rounded-xl border border-success/20">
          <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" />
          <h2 className="text-2xl font-bold text-secondary mb-1">ICP Submitted</h2>
          <p className="text-muted-foreground">Thank you! Your operator is reviewing your profile.</p>
        </div>

        <div className="space-y-6">
          {ICP_SECTIONS.map(section => (
            <div key={section.id} className="bg-card rounded-xl border border-border p-6 md:p-8">
              <h2 className="text-xl font-bold mb-4 text-secondary pb-2 border-b border-border">{section.title}</h2>
              <div className="space-y-5">
                {section.questions.map(q => (
                  <div key={q.key}>
                    <Label className="text-sm text-muted-foreground mb-1 block">{q.label}</Label>
                    <div className="text-base font-medium">
                      {icpData.answers[q.key] || <span className="text-muted-foreground/50 italic">No answer provided</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "pb-12" : "max-w-4xl mx-auto pb-32 animate-in fade-in duration-500"}>
      {/* Sticky Progress Bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-4 border-b border-border mb-8 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-sm font-medium mb-2">
            <span>Progress</span>
            <span>{answeredCount} / {TOTAL_QUESTIONS} Answered</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-muted-foreground hidden sm:flex items-center w-20 justify-end">
            {saveStatus === "saving" && <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving</>}
            {saveStatus === "saved" && <><Save className="w-3 h-3 mr-1" /> Saved</>}
          </div>
          <Button
            size="default"
            disabled={!canSubmit || submitMutation.isPending}
            onClick={() => submitMutation.mutate({ data: { answers } })}
          >
            {submitMutation.isPending ? "Submitting..." : "Submit ICP"}
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        {ICP_SECTIONS.map(section => (
          <div key={section.id} className="bg-card rounded-xl border border-border p-6 md:p-8 shadow-sm">
            <h2 className="text-xl md:text-2xl font-bold mb-6 text-secondary">{section.title}</h2>
            <div className="space-y-6">
              {section.questions.map(q => (
                <div key={q.key} className="space-y-2">
                  <Label htmlFor={q.key} className="text-base font-semibold">
                    {q.label}
                  </Label>
                  {q.type === 'textarea' ? (
                    <Textarea
                      id={q.key}
                      value={answers[q.key] || ''}
                      onChange={(e) => handleChange(q.key, e.target.value)}
                      className="min-h-[100px] text-base"
                      placeholder="Type your answer here..."
                    />
                  ) : (
                    <input
                      id={q.key}
                      type="text"
                      value={answers[q.key] || ''}
                      onChange={(e) => handleChange(q.key, e.target.value)}
                      className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="Type your answer here..."
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          size="lg"
          className="w-full md:w-auto"
          disabled={!canSubmit || submitMutation.isPending}
          onClick={() => submitMutation.mutate({ data: { answers } })}
        >
          {submitMutation.isPending ? "Submitting..." : "Submit Completed ICP"}
        </Button>
      </div>
    </div>
  );
}

export function ClientIcp() {
  return (
    <div className="max-w-4xl mx-auto pb-32 animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-secondary">Ideal Customer Profile</h1>
        <p className="text-lg text-muted-foreground mt-2">Complete this questionnaire so we can build your high-converting sprint.</p>
      </div>
      <IcpForm />
    </div>
  );
}
