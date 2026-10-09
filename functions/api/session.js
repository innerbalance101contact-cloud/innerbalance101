/**
 * /api/session
 *   POST   Authorization: Bearer <Firebase ID token>  → sets the session cookie
 *   DELETE                                              → clears it
 * Only verified emails get a session, so nobody can claim someone else's
 * purchase by signing up with their address.
 */
import {
  json, kvOf, sameOrigin, getAccessRecord, canOpenStages, verifyFirebaseIdToken, logEvent, makeSessionCookie, sessionCookie,
} from "../_lib/shared.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!env.SESSION_SECRET) return json({ error: "server not configured" }, 500);

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let claims;
  try {
    claims = await verifyFirebaseIdToken(token);
  } catch (err) {
    return json({ error: "invalid token" }, 401);
  }
  if (!claims.email) return json({ error: "no email on account" }, 401);
  if (claims.email_verified !== true) return json({ error: "email not verified" }, 403);

  // Remember verified sign-ups so the admin page can list people who have no access yet.
  // First time only: if they have not bought, tag them in Kit so a short "your account is
  // ready" email can go out (the automation lives in Kit; it stops when they purchase).
  const kv = kvOf(env);
  if (kv) {
    const email = claims.email.toLowerCase();
    try {
      await logEvent(kv, email, (await kv.get(`seen:${email}`)) ? "signed_in" : "activated");
      if (!(await kv.get(`seen:${email}`))) {
        await kv.put(`seen:${email}`, JSON.stringify({ at: new Date().toISOString(), name: claims.name || "" }));
        const rec = await getAccessRecord(kv, email);
        if (!canOpenStages(rec) && env.KIT_API_KEY && env.KIT_NOT_PURCHASED_TAG_ID) {
          const job = fetch(`https://api.convertkit.com/v3/tags/${encodeURIComponent(env.KIT_NOT_PURCHASED_TAG_ID)}/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ api_key: env.KIT_API_KEY, email, first_name: (claims.name || "").split(" ")[0] }),
          }).catch(() => {});
          if (waitUntil) waitUntil(job);
        }
      }
    } catch { /* never block sign-in on a bookkeeping write */ }
  }

  const cookie = await makeSessionCookie({ email: claims.email, name: claims.name, uid: claims.sub }, env);
  return json({ ok: true, email: claims.email.toLowerCase() }, 200, { "Set-Cookie": cookie });
}

export async function onRequestDelete({ request }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
