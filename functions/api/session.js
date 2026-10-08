/**
 * /api/session
 *   POST   Authorization: Bearer <Firebase ID token>  → sets the session cookie
 *   DELETE                                              → clears it
 * Only verified emails get a session, so nobody can claim someone else's
 * purchase by signing up with their address.
 */
import {
  json, sameOrigin, verifyFirebaseIdToken, makeSessionCookie, sessionCookie,
} from "../_lib/shared.js";

export async function onRequestPost({ request, env }) {
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

  const cookie = await makeSessionCookie({ email: claims.email, name: claims.name, uid: claims.sub }, env);
  return json({ ok: true, email: claims.email.toLowerCase() }, 200, { "Set-Cookie": cookie });
}

export async function onRequestDelete({ request }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
