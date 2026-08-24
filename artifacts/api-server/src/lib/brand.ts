/**
 * Brand constants for the API server.
 *
 * To rebrand for a new client, set the BRAND_NAME environment variable.
 * Everything — welcome emails, reminder emails, admin invites, support replies,
 * PDF audit stamps, and email footers — will automatically use the new name.
 *
 * BRAND_NAME        default: "Reclaimed Media"
 * BRAND_APP_NAME    default: "<BRAND_NAME> Sprint Hub"
 */

export const BRAND_NAME = process.env.BRAND_NAME ?? "Reclaimed Media";
export const BRAND_APP_NAME = process.env.BRAND_APP_NAME ?? `${BRAND_NAME} Sprint Hub`;
