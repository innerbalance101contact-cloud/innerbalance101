/**
 * POST /api/progress   { stage: "stage-1", action: "complete" | "undo", date: "YYYY-MM-DD" }
 * Records one completed practice day. One entry per calendar date, so
 * pressing the button twice does nothing. Missed days never reset anything.
 */
import {
  json, kvOf, sameOrigin, getSession, getAccessRecord, getProgress, canOpenStages,
  stageOpen, stageSummary, isAdmin,
} from "../_lib/shared.js";
import { STAGES, DAYS_PER_STAGE } from "../_lib/config.js";

const DAY = 86400000;

// The browser's local date can be a day either side of UTC.
function dateAllowed(d, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return false;
  const t = Date.parse(d + "T00:00:00Z");
  if (!Number.isFinite(t)) return false;
  const utcMidnight = Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.abs(t - utcMidnight) <= DAY;
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const session = await getSession(request, env);
  if (!session) return json({ error: "signed out" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { stage, action, date } = body || {};

  const stageIndex = STAGES.findIndex((s) => s.slug === stage);
  if (stageIndex < 0) return json({ error: "unknown stage" }, 400);
  if (action !== "complete" && action !== "undo") return json({ error: "unknown action" }, 400);
  if (!dateAllowed(date)) return json({ error: "date out of range" }, 400);

  const kv = kvOf(env);
  if (!kv) return json({ error: "storage not configured" }, 500);
  const admin = isAdmin(session.email, env);
  const [rec, progress] = await Promise.all([getAccessRecord(kv, session.email), getProgress(kv, session.email)]);

  if (!admin && !canOpenStages(rec)) return json({ error: "no access" }, 403);
  if (!admin && !stageOpen(progress, stageIndex)) return json({ error: "stage not open yet" }, 403);

  const entry = progress.stages[stage] || { days: [] };
  const set = new Set(entry.days);
  if (action === "complete") set.add(date); else set.delete(date);
  entry.days = [...set].sort();
  if (entry.days.length >= DAYS_PER_STAGE && !entry.completedAt) entry.completedAt = new Date().toISOString();
  if (entry.days.length < DAYS_PER_STAGE) delete entry.completedAt;
  progress.stages[stage] = entry;
  progress.updatedAt = new Date().toISOString();

  await kv.put(`progress:${session.email}`, JSON.stringify(progress));
  return json({ ok: true, stage, ...stageSummary(progress, stage, date) });
}
