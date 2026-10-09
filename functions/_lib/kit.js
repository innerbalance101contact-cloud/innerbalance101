/**
 * Kit webhook processing (pure logic, no Request/Response).
 * Called by functions/kit-webhook.js and by the local tests.
 *
 * Kit webhook shapes (per developers.kit.com):
 *   purchase.purchase_create → { id, transaction_id, status, email_address,
 *                                products: [{ name, sku, unit_price, quantity }], ... }
 *   subscriber.tag_add / tag_remove → { subscriber: { email_address, ... } }
 * Kit does not document request signing, so the endpoint URL carries a
 * secret (?s=...) and each hook says what it means (?ev=...&slug=...).
 */
import { PRODUCT_RULES } from "./config.js";

const DENY_STATUS = new Set(["failed"]);
const REVOKE_STATUS = new Set(["refunded", "canceled", "cancelled", "voided", "disputed", "chargeback"]);
const DAY = 86400000;

export function emailOf(body) {
  const e =
    body?.email_address ||
    body?.subscriber?.email_address ||
    body?.purchase?.email_address ||
    body?.email ||
    "";
  return String(e).trim().toLowerCase();
}

export function purchaseOf(body) {
  return body?.purchase && typeof body.purchase === "object" ? body.purchase : body;
}

// Which grants does this purchase create?
export function grantsForPurchase(purchase) {
  const products = Array.isArray(purchase?.products) ? purchase.products : [];
  const out = [];
  const unmatched = [];
  for (const p of products) {
    const text = `${p?.name || ""} ${p?.sku || ""}`;
    const rule = PRODUCT_RULES.find((r) => r.match.test(text));
    if (!rule) { unmatched.push(p?.name || p?.sku || "(unnamed product)"); continue; }
    out.push({ slug: rule.slug, days: typeof rule.days === "function" ? rule.days(text) : rule.days || null });
  }
  return { grants: out, unmatched };
}

async function readAccess(kv, email) {
  const rec = await kv.get(`access:${email}`, { type: "json" });
  return rec && rec.grants ? rec : { grants: {} };
}

export async function applyGrant(kv, email, slug, { days = null, src = "kit", now = Date.now() } = {}) {
  const rec = await readAccess(kv, email);
  const prev = rec.grants[slug];
  const until = days ? new Date(now + days * DAY).toISOString() : null;
  // Keep the later expiry if a renewal arrives early.
  const keepUntil = prev?.until && until && new Date(prev.until) > new Date(until) ? prev.until : until;
  rec.grants[slug] = {
    at: prev?.at || new Date(now).toISOString(),
    renewedAt: new Date(now).toISOString(),
    until: days ? keepUntil : null,
    revoked: false,
    src,
  };
  await kv.put(`access:${email}`, JSON.stringify(rec));
  return rec;
}

export async function applyRevoke(kv, email, slug, { now = Date.now(), reason = null } = {}) {
  const rec = await readAccess(kv, email);
  rec.grants[slug] = { ...(rec.grants[slug] || { at: new Date(now).toISOString() }), revoked: true, revokedAt: new Date(now).toISOString(), ...(reason ? { revokedReason: reason } : {}) };
  await kv.put(`access:${email}`, JSON.stringify(rec));
  return rec;
}

/**
 * @param kv      KV namespace
 * @param params  { ev, slug, days } from the webhook URL query string
 * @param body    parsed JSON from Kit
 * @returns       { ok, action, detail }
 */
export async function processKitEvent(kv, params, body, now = Date.now()) {
  const ev = params.ev || "";
  const email = emailOf(body);
  if (!email) return { ok: true, action: "ignored", detail: "no email in payload" };

  if (ev === "purchase") {
    const purchase = purchaseOf(body);
    const status = String(purchase?.status || "").toLowerCase();
    if (DENY_STATUS.has(status)) return { ok: true, action: "ignored", detail: `status ${status}` };

    if (REVOKE_STATUS.has(status)) {
      const { grants: rg } = grantsForPurchase(purchase);
      for (const g of rg) await applyRevoke(kv, email, g.slug, { now, reason: status });
      return { ok: true, action: "revoked", detail: `${status}: ${rg.map((g) => g.slug).join(",") || "nothing matched"}` };
    }

    const txn = purchase?.transaction_id || purchase?.id;
    if (txn) {
      if (await kv.get(`txn:${txn}`)) return { ok: true, action: "duplicate", detail: String(txn) };
      await kv.put(`txn:${txn}`, "1", { expirationTtl: 60 * 60 * 24 * 90 });
    }

    const { grants, unmatched } = grantsForPurchase(purchase);
    for (const g of grants) await applyGrant(kv, email, g.slug, { days: g.days, src: "purchase", now });
    if (unmatched.length) {
      await kv.put(`unmatched:${now}:${email}`, JSON.stringify({ email, unmatched, txn }), { expirationTtl: 60 * 60 * 24 * 180 });
    }
    return { ok: true, action: "granted", detail: grants.map((g) => g.slug).join(",") || "nothing matched", unmatched };
  }

  if (ev === "tag_add" || ev === "tag_remove") {
    const slug = params.slug || "";
    if (!slug) return { ok: false, action: "error", detail: "tag event without slug" };
    if (ev === "tag_add") {
      const days = params.days ? parseInt(params.days, 10) : null;
      await applyGrant(kv, email, slug, { days: Number.isFinite(days) ? days : null, src: "tag", now });
      return { ok: true, action: "granted", detail: slug };
    }
    await applyRevoke(kv, email, slug, { now });
    return { ok: true, action: "revoked", detail: slug };
  }

  return { ok: false, action: "error", detail: `unknown ev "${ev}"` };
}

/**
 * Asks Kit for purchases and marks anyone refunded there as "refunded, access still on".
 * Needs a Kit v4 API key in env KIT_V4_API_KEY. Never switches access off by itself.
 */
export async function syncKitRefunds(kv, env, slug, now = Date.now()) {
  if (!env.KIT_V4_API_KEY) return { ok: false, error: "Add KIT_V4_API_KEY in Cloudflare to let the site check Kit for refunds." };
  const statuses = {}; const flagged = []; let after = null;
  try {
    for (let page = 0; page < 5; page++) {
      const url = "https://api.kit.com/v4/purchases?per_page=200" + (after ? `&after=${encodeURIComponent(after)}` : "");
      const r = await fetch(url, { headers: { "X-Kit-Api-Key": String(env.KIT_V4_API_KEY).trim(), Accept: "application/json" } });
      if (!r.ok) return { ok: false, error: `Kit answered ${r.status}`, statuses };
      const d = await r.json();
      for (const p of d.purchases || []) {
        const st = String(p.status || "").toLowerCase();
        statuses[st || "(blank)"] = (statuses[st || "(blank)"] || 0) + 1;
        if (!st || st === "paid" || st === "succeeded") continue;
        if (!/refund|cancel|void|dispute|chargeback/.test(st)) continue;
        const email = String(p.email_address || "").trim().toLowerCase();
        if (!email) continue;
        const rec = await readAccess(kv, email);
        const g = rec.grants?.[slug];
        if (!g || g.revoked || g.refundHold) continue;
        g.refundHold = new Date(now).toISOString(); g.refundSrc = "kit";
        await kv.put(`access:${email}`, JSON.stringify(rec));
        flagged.push(email);
      }
      if (!d.pagination?.has_next_page) break;
      after = d.pagination.end_cursor;
    }
  } catch (e) { return { ok: false, error: String(e.message || e), statuses }; }
  return { ok: true, statuses, flagged, at: new Date(now).toISOString() };
}
