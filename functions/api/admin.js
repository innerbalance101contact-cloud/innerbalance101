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
      refunded: grant?.revokedReason === "refunded",
      refundHold: !!(grant && grant.refundHold && !grant.revoked),
      refundHoldAt: grant?.refundHold || null,
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
  // Account trail: where each person got to on the login page.
  const logKeys = await listKeys(kv, "log:", 500);
  const seenSet = new Set(seenKeys.map((k) => k.slice("seen:".length)));
  const memberMap = new Map(members.map((m) => [m.email, m]));
  const people = (await Promise.all(logKeys.map(async (k) => {
    const email = k.slice("log:".length);
    const log = (await kv.get(k, { type: "json" })) || [];
    if (!log.length) return null;
    const activated = seenSet.has(email) || log.some((x) => x.e === "activated" || x.e === "signed_in");
    const m = memberMap.get(email);
    const last = log[log.length - 1];
    const status = m && m.active ? "member"
      : activated ? "activated"
      : log.some((x) => x.e === "signup_created") ? "not_activated"
      : "trying";
    return { email, status, last: last.t, steps: log.slice(-12) };
  }))).filter(Boolean).sort((a, b) => b.last - a.last).slice(0, 150);

  // What Kit has told us lately (14 days): purchases, refunds, tag changes.
  const evtKeys = (await listKeys(kv, "evt:", 400)).slice(-40).reverse();
  const events = (await Promise.all(evtKeys.map(async (k) => {
    const v = await kv.get(k, { type: "json" });
    if (!v) return null;
    const p = v.payload || {};
    const pur = p.purchase && typeof p.purchase === "object" ? p.purchase : p;
    return {
      at: v.at, ev: v.ev, action: v.result?.action, detail: v.result?.detail,
      email: p.email_address || p.subscriber?.email_address || pur.email_address || "",
      status: pur.status || "",
      products: Array.isArray(pur.products) ? pur.products.map((x) => x?.name).filter(Boolean) : [],
      amount: pur.total ?? pur.amount ?? null,
    };
  }))).filter(Boolean);

  return json({ members, waiting, unmatched, people, events, daysPerStage: DAYS_PER_STAGE, stageLabels: STAGES.map((s) => s.label) });
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
  } else if (body.action === "refund-hold" || body.action === "refund-hold-clear") {
    // Money has been (or is being) returned, but access stays on until Naomi turns it off.
    const rec = await getAccessRecord(kv, email);
    const g = rec.grants?.[slug];
    if (!g) return json({ error: "no access record for that email" }, 400);
    if (body.action === "refund-hold") g.refundHold = new Date().toISOString(); else delete g.refundHold;
    await kv.put(`access:${email}`, JSON.stringify(rec));
  } else if (body.action === "refund") {
    // Records that the money was returned (done in Kit/Stripe) and switches access off.
    await applyRevoke(kv, email, slug, { reason: "refunded" });
    const rec2 = await getAccessRecord(kv, email);
    if (rec2.grants?.[slug]) { delete rec2.grants[slug].refundHold; await kv.put(`access:${email}`, JSON.stringify(rec2)); }
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
