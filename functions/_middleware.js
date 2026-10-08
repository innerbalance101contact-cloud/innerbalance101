/**
 * Hard lock for paid content.
 * Runs before static files are served. A direct URL does nothing without a
 * valid signed-in session AND the right grant (saved by the Kit webhook).
 *
 *   stage pages  → The Inner Balance System, in order (stage 2 after 21 days of stage 1)
 *   /dashboard   → any signed-in member
 */
import {
  kvOf, getSession, getAccessRecord, getProgress, canOpenStages, stageOpen, isAdmin, matchRule,
} from "./_lib/shared.js";

function redirect(to) {
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "private, no-store" } });
}

function locked(res) {
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();

  const url = new URL(request.url);
  const rule = matchRule(url.pathname);
  if (!rule) return next();
  if (rule.kind === "block") return new Response("Not found", { status: 404 });

  const session = await getSession(request, env);
  if (!session) return redirect(`/login.html?next=${encodeURIComponent(url.pathname)}`);
  if (rule.kind === "account") return locked(await next());

  const kv = kvOf(env);
  const admin = isAdmin(session.email, env);
  if (rule.kind === "admin") return admin ? locked(await next()) : redirect("/dashboard.html");
  if (admin) return locked(await next());

  const rec = await getAccessRecord(kv, session.email);

  if (rule.kind === "stage") {
    if (!canOpenStages(rec)) return redirect("/dashboard.html?locked=system");
    if (rule.stageIndex > 0) {
      const progress = await getProgress(kv, session.email);
      if (!stageOpen(progress, rule.stageIndex, rec)) return redirect("/dashboard.html?locked=sequence");
    }
    return locked(await next());
  }


  return next();
}
