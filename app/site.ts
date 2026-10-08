/**
 * The game's public address, for absolute links in shared cards and link
 * previews (X, Telegram, WhatsApp… need full URLs). Set NEXT_PUBLIC_SITE_URL
 * to the real domain; on Vercel the production domain is picked up on its
 * own; otherwise the local dev server.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const SITE_NAME = "Gugut & the Goat";
