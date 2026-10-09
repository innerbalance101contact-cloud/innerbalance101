/**
 * Admin API (ADMIN_EMAILS only).
 *   GET  /api/admin                       → members, unmatched purchases
 *   POST /api/admin {action, email, ...}  → grant | revoke | stage
 * Nothing is ever hard-deleted. Revoking keeps progress, so a paused member
 * who returns continues where they left off.
 */
import {
  json, kvOf, sameOrigin, getSession, isAdmin, getAccessRecord, getProgress,
  canOpenStages, stageSummary,
} from "../_lib/shared.js";
import { applyGrant, applyRevoke, processKitEvent } from "../_lib/kit.js";
import { STAGES, DAYS_PER_STAGE, STAGE_REQUIRES } from "../_lib/config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireAdmin(request, env) {
  const session = await getSession(request, env);
  if (!session) return { err: json({ error: "signed out" }, 401) };
  if (!isAdmin(session.email, env)) return { err: json({ error: "forbidden" }, 403) };
  return { session };
}

async function listKeys(kv, prefix, max = 1000) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && keys.length < max);
  return keys;
}

export async function onRequestGet({ request, env }) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;
  const kv = kvOf(env);
  if (!kv) return json({ error: "storage not configured" }, 500);

  const [accessKeys, unmatchedKeys, seenKeys] = await Promise.all([
    listKeys(kv, "access:"), listKeys(kv, "unmatched:", 100), listKeys(kv, "seen:"),
  ]);
  const members = await Promise.all(accessKeys.map(async (key) => {
    const email = key.slice("access:".length);
    const [rec, progress] = await Promise.all([getAccessRecord(kv, email), getProgress(kv, email)]);
    const grant = STAGE_REQUIRES.map((s) => rec.grants?.[s]).find(Boolean) || null;
    return {
      email,
      active: canOpenStages(rec),
      revoked: !!(grant && grant.revoked),
      since: grant?.at || null,
      src: grant?.src || null,
      unlockThrough: Number.isInteger(rec.unlockThrough) ? rec.unlockThrough : null,
      stages: STAGES.map((s) => stageSummary(progress, s.slug).count),
      updatedAt: progress.updatedAt || null,
    };
  }));
  members.sort((a, b) => (b.since || "").localeCompare(a.since || ""));

  const activeSet = new Set(members.filter((m) => m.active).map((m) => m.email));
  const waiting = (await Promise.all(seenKeys.map(async (key) => {
    const email = key.slice("seen:".length);
    if (activeSet.has(email)) return null;
    const v = await kv.get(key, { type: "json" });
    return { email, at: v?.at || null, name: v?.name || "" };
  }))).filter(Boolean).sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const unmatched = (await Promise.all(unmatchedKeys.map((k) => kv.get(k, { type: "json" })))).filter(Boolean);
  return json({ members, waiting, unmatched, daysPerStage: DAYS_PER_STAGE, stageLabels: STAGES.map((s) => s.label) });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  const { err, session } = await requireAdmin(request, env);
  if (err) return err;
  const kv = kvOf(env);
  if (!kv) return json({ error: "storage not configured" }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "enter a valid email" }, 400);
  const slug = STAGE_REQUIRES[0];

  if (body.action === "grant") {
    await applyGrant(kv, email, slug, { src: "admin" });
  } else if (body.action === "revoke") {
    await applyRevoke(kv, email, slug);
  } else if (body.action === "stage") {
    const v = body.unlockThrough;
    if (v !== null && ![0, 1, 2].includes(v)) return json({ error: "bad stage" }, 400);
    const rec = await getAccessRecord(kv, email);
    if (v === null) delete rec.unlockThrough; else rec.unlockThrough = v;
    await kv.put(`access:${email}`, JSON.stringify(rec));
  } else if (body.action === "simulate-purchase") {
    // Test only: runs the same code path as the Kit purchase webhook, with a Kit-shaped payload.
    const now0 = Date.now();
    const r = await processKitEvent(kv, { ev: "purchase" }, {
      id: `test-${now0}`, transaction_id: `test-${now0}`, status: "paid", email_address: email,
      products: [{ name: "The Inner Balance System", sku: "", unit_price: 0, quantity: 1 }],
    }, now0);
    if (r.action !== "granted" || r.detail === "nothing matched") return json({ error: `webhook logic returned ${r.action}: ${r.detail}` }, 400);
  } else if (body.action === "remove") {
    // Clears this site's records for the email (access, progress, sign-up note).
    // The login account (Firebase) and the Kit subscriber are separate and stay.
    if (isAdmin(email, env)) return json({ error: "admin emails cannot be removed here" }, 400);
    await Promise.all([`access:${email}`, `progress:${email}`, `seen:${email}`].map((k) => kv.delete(k)));
  } else {
    return json({ error: "unknown action" }, 400);
  }

  const now = Date.now();
  await kv.put(`audit:${now}`, JSON.stringify({ at: new Date(now).toISOString(), by: session.email, ...body, email }), { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ ok: true });
}
