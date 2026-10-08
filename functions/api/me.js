/**
 * GET /api/me?d=YYYY-MM-DD
 * Everything the dashboard needs in one call: who is signed in, what they
 * can open, and where they are in each stage. `d` is the browser's local date.
 */
import {
  json, kvOf, getSession, getAccessRecord, getProgress, summarizeAll, stageOpen,
  canOpenStages, isAdmin, cleanDate,
} from "../_lib/shared.js";
import { STAGES, DAYS_PER_STAGE } from "../_lib/config.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "signed out" }, 401);

  const kv = kvOf(env);
  const admin = isAdmin(session.email, env);
  const [rec, progress] = await Promise.all([getAccessRecord(kv, session.email), getProgress(kv, session.email)]);
  const today = cleanDate(new URL(request.url).searchParams.get("d"));
  const summaries = summarizeAll(progress, today);

  const hasSystem = admin || canOpenStages(rec);
  const stages = STAGES.map((s, i) => ({
    slug: s.slug, label: s.label, path: s.path + ".html",
    ...summaries[s.slug],
    open: hasSystem && (admin || stageOpen(progress, i, rec)),
  }));

  return json({
    email: session.email,
    name: session.name || "",
    admin,
    daysPerStage: DAYS_PER_STAGE,
    system: hasSystem,
    stages,
    today,
  });
}
