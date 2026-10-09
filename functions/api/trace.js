/**
 * POST /api/trace  {event, email?, code?}
 * Records a step in a person's account trail so the admin page can show where they got stuck.
 * Errors and reset requests need no sign-in (the person is not signed in when they happen).
 * "Account created" must carry the person's Firebase token, so nobody can write it for someone else.
 */
import { json, kvOf, sameOrigin, verifyFirebaseIdToken, logEvent } from "../_lib/shared.js";

const OPEN = new Set(["signup_error", "signin_error", "signin_unverified", "reset_sent", "reset_error"]);
const TOKEN = new Set(["signup_created"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const kv = kvOf(env);
  if (!kv) return json({ ok: true });

  const e = String(b?.event || "");
  const c = String(b?.code || "").slice(0, 60).replace(/[^a-z0-9/_ -]/gi, "");
  let email = String(b?.email || "").trim().toLowerCase();

  if (TOKEN.has(e)) {
    const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    try { email = String((await verifyFirebaseIdToken(t)).email || "").toLowerCase(); }
    catch { return json({ error: "invalid token" }, 401); }
  } else if (!OPEN.has(e)) {
    return json({ error: "unknown event" }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ ok: true });
  try { await logEvent(kv, email, e, c); } catch { /* bookkeeping only */ }
  return json({ ok: true });
}
