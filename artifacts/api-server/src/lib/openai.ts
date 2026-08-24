import OpenAI from "openai";

/**
 * OpenAI client wired up via Replit's AI Integrations proxy. No user-supplied
 * key required — env vars are auto-provisioned by the platform.
 */
export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const aiAvailable = (): boolean =>
  !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY && !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
