/**
 * Cloudflare Pages Function: /kit-webhook
 * Receives Kit webhooks and records what each customer has access to.
 *
 * Register these webhooks in Kit (target URL on the left):
 *   /kit-webhook?s=SECRET&ev=purchase
 *       ← purchase.purchase_create. Grants The Inner Balance System.
 *   /kit-webhook?s=SECRET&ev=tag_remove&slug=inner-balance-system
 *       ← subscriber.tag_remove for a Kit tag such as "Refunded". Takes access away.
 *   /kit-webhook?s=SECRET&ev=tag_add&slug=inner-balance-system
 *       ← subscriber.tag_add for a tag such as "Access granted manually". Optional.
 */
import { kvOf } from "./_lib/shared.js";
import { processKitEvent } from "./_lib/kit.js";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);

  if (!env.KIT_WEBHOOK_SECRET || !safeEqual(params.s || "", env.KIT_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const kv = kvOf(env);
  if (!kv) return new Response("KV not bound", { status: 500 });

  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  let result;
  try {
    result = await processKitEvent(kv, params, body);
  } catch (err) {
    console.error("[kit-webhook] failed:", err.message);
    // 500 so Kit can retry if it supports retries.
    return new Response("Processing failed", { status: 500 });
  }

  // Short-lived log so the first real test purchase can be inspected in the KV dashboard.
  const now = Date.now();
  await kv.put(
    `evt:${now}`,
    JSON.stringify({ at: new Date(now).toISOString(), ev: params.ev, slug: params.slug, result, payload: body }),
    { expirationTtl: 60 * 60 * 24 * 14 }
  );

  return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: { "Content-Type": "application/json" } });
}
