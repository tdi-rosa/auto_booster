export const PROJECT_REF = "cyrxjeppjqsxxjayfrur";
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
export const SITE_URL = "https://www.wiki-masters.com";
export const COOKIE_BASE = `sb-${PROJECT_REF}-auth-token`;

export const DEFAULT_INTERVAL_MINUTES = 100;
export const ALLOWED_INTERVALS = new Set([15, 30, 60, 90, 100, 120, 180]);

export const PWA_ORIGINS = new Set([
  "https://tdi-rosa.github.io",
  "http://localhost:8000",
  "http://localhost:5173"
]);

export const WIKI_ORIGINS = new Set([
  "https://www.wiki-masters.com",
  "https://wiki-masters.com"
]);

export function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
