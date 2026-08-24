import { openai, aiAvailable } from "./openai";

/**
 * Result of an auto-format pass.
 *  - body: the new markdown (always returned, never mutated if guard fails)
 *  - changed: whether any tokens were actually inserted
 *  - inserted: token strings that were added (e.g. "{{name}}")
 *  - warnings: human-readable notes (e.g. guard failures, fallback reasons)
 */
export interface AutoFormatResult {
  body: string;
  changed: boolean;
  inserted: string[];
  warnings: string[];
}

const SYSTEM_PROMPT = `You are an assistant that prepares legal/coaching agreements for e-signing.

Your job: given an agreement body in Markdown, INSERT placeholder tokens at the correct spots so the document is ready for the client to sign. Tokens drop into the existing text — the system replaces them with input boxes at sign time.

ALLOWED TOKENS (and only these):
  {{name}}                       Client's full name (auto-filled from profile)
  {{businessName}}               Client's business / company name (auto-filled)
  {{date}}                       Signature date (auto-filled at signing)
  {{initial:section_label}}      Drawable initial box. Use one per acknowledgement section. Pick a short snake_case label per section, e.g. {{initial:confidentiality}}.
  {{text:Label Here}}            Free-text input the client must fill in. Use Title Case for the label, e.g. {{text:Principal Place of Business}}.
  {{name:Label}}                 (rare) A NAMED person other than the client (e.g. {{name:Coach Name}}). Only use when the doc clearly references a non-client party AND no name is provided in the source text.
  {{businessName:Label}}         (rare) Same as above for a non-client business.

PLACEMENT RULES:
- Replace obvious blanks like "_______", "[CLIENT NAME]", "[Date]", "Name: ____", "Signature: ____" with the matching token.
- For each major numbered section that requires acknowledgement (Confidentiality, Cancellation Policy, Refund Policy, etc.), append on its own line: "I confirm I have read and understood this section. {{initial:short_label}}"
- At the document end, ensure exactly one signature block exists with: "Signed: {{name}}" and "Date: {{date}}".
- Add {{businessName}} next to {{name}} if the doc references the client's company.
- Add {{text:Label}} for any explicit input the client must provide (address, ABN, phone, etc.).

ABSOLUTE CONSTRAINTS — VIOLATING THESE WILL CAUSE THE OUTPUT TO BE REJECTED:
1. Do NOT add, remove, or change ANY of the original words. You may only INSERT tokens (and remove obvious blank-line placeholders like "_______" or "[NAME]" that you replace with a token).
2. Do NOT change punctuation or sentence order.
3. Do NOT introduce any text that isn't either an existing word or one of the allowed tokens.
4. Preserve all Markdown formatting (#, ##, **, lists, blank lines).
5. Output ONLY the modified Markdown body. No commentary, no code fences, no JSON.`;

/**
 * Strip all {{...}} tokens and normalise whitespace into a lower-cased
 * sequence of "word" tokens (alphanumeric runs). Used to verify the AI did
 * not add or remove any of the user's original words.
 */
function wordsFor(text: string): string[] {
  return text
    .replace(/\{\{[^}]*\}\}/g, " ")
    // Common blank-line placeholders we explicitly ALLOW the AI to remove.
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/_{2,}/g, " ")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

/**
 * Multiset compare. Returns the words present in `original` but missing from
 * `proposed` (after token + bracket-blank stripping). If non-empty, the AI
 * dropped or rewrote content — we reject the result.
 */
function missingWords(original: string, proposed: string): string[] {
  const counts = new Map<string, number>();
  for (const w of wordsFor(original)) counts.set(w, (counts.get(w) ?? 0) + 1);
  for (const w of wordsFor(proposed)) {
    const c = counts.get(w);
    if (c !== undefined) {
      if (c <= 1) counts.delete(w);
      else counts.set(w, c - 1);
    }
  }
  return Array.from(counts.keys()).slice(0, 5);
}

const TOKEN_RE = /\{\{[^}]*\}\}/g;

function tokenSet(text: string): Set<string> {
  return new Set(text.match(TOKEN_RE) ?? []);
}

/**
 * Run the auto-format model. Always returns a result; on any failure or
 * guard violation, falls back to the original body with a warning so the
 * UI can surface what happened.
 */
export async function autoFormatAgreement(body: string): Promise<AutoFormatResult> {
  if (!aiAvailable()) {
    return { body, changed: false, inserted: [], warnings: ["AI auto-format is not configured on this server."] };
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return { body, changed: false, inserted: [], warnings: ["Document is empty."] };
  }
  if (trimmed.length > 30_000) {
    return { body, changed: false, inserted: [], warnings: ["Document is too long for auto-format (>30k chars)."] };
  }

  let raw: string;
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body },
      ],
    });
    raw = res.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    return {
      body,
      changed: false,
      inserted: [],
      warnings: [`AI request failed: ${err instanceof Error ? err.message : "unknown error"}`],
    };
  }

  if (!raw) {
    return { body, changed: false, inserted: [], warnings: ["AI returned an empty response."] };
  }

  // Strip code-fence wrapping if the model ignored instructions.
  const fenced = raw.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/i);
  const proposed = fenced ? fenced[1].trim() : raw;

  // Guard 1: every original word must still be present.
  const missing = missingWords(body, proposed);
  if (missing.length > 0) {
    return {
      body,
      changed: false,
      inserted: [],
      warnings: [
        `AI rewrote or dropped wording (missing: ${missing.join(", ")}). No changes applied — the original document is untouched.`,
      ],
    };
  }

  // Guard 2: only allowed token kinds may appear.
  const allowedKinds = new Set(["name", "businessName", "date", "initial", "text"]);
  const newTokens = Array.from(tokenSet(proposed)).filter((t) => !tokenSet(body).has(t));
  for (const t of newTokens) {
    const m = /^\{\{\s*([a-zA-Z][\w]*)/.exec(t);
    if (!m || !allowedKinds.has(m[1])) {
      return {
        body,
        changed: false,
        inserted: [],
        warnings: [`AI used an unsupported token: ${t}. No changes applied.`],
      };
    }
  }

  return {
    body: proposed,
    changed: proposed !== body,
    inserted: newTokens,
    warnings: [],
  };
}
