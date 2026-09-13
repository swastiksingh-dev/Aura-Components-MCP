// Module: config — one small interface (loadConfig) over all env parsing.
// Callers learn one function; env names, defaults, and clamping live here.

const num = (raw, fallback, { min = 1, max = 100 } = {}) => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const bool = (raw, fallback) => {
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
};

export function loadConfig(env = process.env) {
  const defaultKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvaXJxcmtkZ2JtdnB3dXR3dXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM2Nzc2NTAsImV4cCI6MjA1OTI1MzY1MH0._UsCSHsTELn7m54tOhX3ySm67WEhcyHAPbuxEQZsl3c";
  return {
    supabaseUrl: env.AURA_SUPABASE_URL ?? "https://hoirqrkdgbmvpwutwuwj.supabase.co",
    anonKey: env.AURA_SUPABASE_ANON_KEY ?? defaultKey,
    timeoutMs: num(env.AURA_TIMEOUT_MS, 12_000, { min: 1_000, max: 60_000 }),
    retries: num(env.AURA_RETRIES, 2, { min: 0, max: 5 }),
    cacheTtlMs: num(env.AURA_CACHE_TTL_MS, 60_000, { min: 0, max: 3_600_000 }),
    defaultLimit: num(env.AURA_DEFAULT_LIMIT, 10, { min: 1, max: 50 }),
    maxLimit: num(env.AURA_MAX_LIMIT, 25, { min: 1, max: 50 }),
    codeChars: num(env.AURA_CODE_CHARS, 12_000, { min: 1_000, max: 60_000 }),
    contentChars: num(env.AURA_CONTENT_CHARS, 12_000, { min: 1_000, max: 60_000 }),
    freeOnlyDefault: bool(env.AURA_FREE_ONLY_DEFAULT, true),
    userAgent: env.AURA_USER_AGENT ?? "aura-components-mcp/1.0.0",
  };
}
