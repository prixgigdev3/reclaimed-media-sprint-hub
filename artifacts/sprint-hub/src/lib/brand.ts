/**
 * Brand constants for the frontend.
 *
 * To rebrand for a new client, set the VITE_BRAND_NAME environment variable
 * (and optionally VITE_BRAND_APP_NAME). Every alt-text, title, heading, and
 * descriptive string that names the product will use the new name.
 *
 * VITE_BRAND_NAME        default: "Reclaimed Media"
 * VITE_BRAND_APP_NAME    default: "<BRAND_NAME> Sprint Hub"
 */

export const BRAND_NAME: string =
  (import.meta.env.VITE_BRAND_NAME as string | undefined) ?? "Reclaimed Media";

export const BRAND_APP_NAME: string =
  (import.meta.env.VITE_BRAND_APP_NAME as string | undefined) ??
  `${BRAND_NAME} Sprint Hub`;
