/**
 * innerbalance101 — shared helpers for Pages Functions
 * Web Platform APIs only. No npm packages.
 *
 * Environment (Cloudflare Pages → Settings):
 *   SESSION_SECRET        long random string, signs the session cookie
 *   KIT_WEBHOOK_SECRET    long random string, must appear in webhook URLs
 *   ADMIN_EMAILS          optional, comma separated, full access for testing
 * KV binding:
 *   IB101_DATA            stores access grants, progress and webhook logs
 */
import {
  FIREBASE_PROJECT_ID, SESSION_DAYS, STAGES, DAYS_PER_STAGE,
  STAGES_ARE_SEQUENTIAL, STAGE_REQUIRES, PROTECTED,
} from "./config.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
export const COOKIE_NAME = "ib101_session";

// ── base64url ────────────────────────────────────────────────────────────────
export function b64uEncode(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function kvOf(env) {
  return env.IB101_DATA || env.IB101_PURCHASES || null;
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...extra },
  });
}

// ── HMAC session cookie ──────────────────────────────────────────────────────
async function hmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signSession(payload, secret) {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), enc.encode(body));
  return `${body}.${b64uEncode(sig)}`;
}

export async function readSessionToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), b64uDecode(sig), enc.encode(body));
  } catch { return null; }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(dec.decode(b64uDecode(body))); } catch { return null; }
  if (!payload?.email || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function getSession(request, env) {
  return readSessionToken(getCookie(request, COOKIE_NAME), env.SESSION_SECRET);
}

export function sessionCookie(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export async function makeSessionCookie({ email, name, uid }, env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await signSession({ email: email.toLowerCase(), name: name || "", uid, exp }, env.SESSION_SECRET);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

// Same-origin check for state-changing requests.
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

// ── Firebase ID token verification (RS256 via Google's published JWKs) ──────
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

async function firebaseKeys() {
  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error("Could not load Firebase signing keys");
  return (await res.json()).keys || [];
}

export async function verifyFirebaseIdToken(idToken, projectId = FIREBASE_PROJECT_ID, keysLoader = firebaseKeys) {
  const parts = (idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const header = JSON.parse(dec.decode(b64uDecode(parts[0])));
  const payload = JSON.parse(dec.decode(b64uDecode(parts[1])));
  if (header.alg !== "RS256") throw new Error("Unexpected algorithm");

  const jwk = (await keysLoader()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64uDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error("Bad signature");

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("Wrong audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Wrong issuer");
  if (!payload.sub) throw new Error("No subject");
  if (payload.exp <= now) throw new Error("Token expired");
  if (payload.iat > now + 60) throw new Error("Token issued in the future");
  return payload;
}

// ── Access grants (written by the Kit webhook) ───────────────────────────────
// KV key  access:{email}  →  { grants: { [slug]: { at, until, revoked, src } } }
export async function getAccessRecord(kv, email) {
  if (!kv) return { grants: {} };
  const rec = await kv.get(`access:${email.toLowerCase()}`, { type: "json" });
  return rec && typeof rec === "object" && rec.grants ? rec : { grants: {} };
}

export function grantActive(grant, now = Date.now()) {
  if (!grant || grant.revoked) return false;
  if (grant.until && new Date(grant.until).getTime() < now) return false;
  return true;
}

export function isAdmin(email, env) {
  return (env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(email.toLowerCase());
}

export function hasSlug(rec, slug, now = Date.now()) {
  return grantActive(rec.grants?.[slug], now);
}

export function canOpenStages(rec, now = Date.now()) {
  return STAGE_REQUIRES.some((s) => hasSlug(rec, s, now));
}

// ── Progress ─────────────────────────────────────────────────────────────────
// KV key  progress:{email}  →  { stages: { "stage-1": { days: ["2026-10-08", ...], completedAt } } }
export async function getProgress(kv, email) {
  if (!kv) return { stages: {} };
  const p = await kv.get(`progress:${email.toLowerCase()}`, { type: "json" });
  return p && p.stages ? p : { stages: {} };
}

export function stageSummary(progress, slug, todayStr) {
  const days = [...new Set(progress.stages?.[slug]?.days || [])].sort();
  const count = Math.min(days.length, DAYS_PER_STAGE);
  return {
    days,
    count,
    pct: Math.round((count / DAYS_PER_STAGE) * 100),
    complete: days.length >= DAYS_PER_STAGE,
    doneToday: todayStr ? days.includes(todayStr) : false,
    streak: streakOf(days, todayStr),
  };
}

export function streakOf(days, todayStr) {
  if (!days.length || !todayStr) return 0;
  const set = new Set(days);
  let cursor = new Date(todayStr + "T00:00:00Z");
  if (!set.has(todayStr)) cursor = new Date(cursor.getTime() - 86400000); // yesterday still counts
  let n = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    n++;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return n;
}

// Is this stage open for this person, given sequencing?
export function stageOpen(progress, stageIndex) {
  if (!STAGES_ARE_SEQUENTIAL || stageIndex === 0) return true;
  return stageSummary(progress, STAGES[stageIndex - 1].slug).complete;
}

export function summarizeAll(progress, todayStr) {
  const out = {};
  for (const s of STAGES) out[s.slug] = stageSummary(progress, s.slug, todayStr);
  return out;
}


// ── Route matching for the hard lock ─────────────────────────────────────────
export function normalisePath(pathname) {
  let p = pathname;
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  p = p.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return p.replace(/\.(html|pdf)$/, "");
}

export function matchRule(pathname) {
  const p = normalisePath(pathname);
  if (p.startsWith("/outdated")) return { kind: "block" };
  return PROTECTED.find((r) => r.path === p) || null;
}

// Browser-local date from the client, accepted only within a day of UTC.
export function cleanDate(d, now = Date.now()) {
  const utcStr = new Date(now).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return utcStr;
  const t = Date.parse(d + "T00:00:00Z");
  const utc = Date.parse(utcStr + "T00:00:00Z");
  return Number.isFinite(t) && Math.abs(t - utc) <= 86400000 ? d : utcStr;
}
