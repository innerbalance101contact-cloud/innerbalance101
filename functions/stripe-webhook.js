/**
 * Cloudflare Pages Function: /stripe-webhook
 * ─────────────────────────────────────────────
 * Listens for Stripe payment events. On a successful checkout, grants
 * the user access by writing to Cloudflare KV (IB101_PURCHASES).
 *
 * Uses only Web Platform APIs — no Node.js or npm required.
 *
 * Environment variables (Cloudflare Pages → Settings → Variables and Secrets):
 *   STRIPE_WEBHOOK_SECRET  — Stripe webhook signing secret (whsec_...)
 *
 * KV Binding (Cloudflare Pages → Settings → Bindings):
 *   IB101_PURCHASES        — KV namespace for storing purchase records
 *
 * KV data structure:
 *   Key:   "user:{email}"  (e.g. "user:naomi@example.com")
 *   Value: JSON array of purchased product slugs
 *          e.g. ["inner-balance-system", "self-assurance-practice"]
 */

export async function onRequestPost({ request, env }) {
  const body      = await request.text();
  const signature = request.headers.get("stripe-signature");

  // ── 1. Verify Stripe signature ─────────────────────────────────────────────
  let event;
  try {
    event = await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] Signature invalid:", err.message);
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  // ── 2. Handle checkout completed ──────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session     = event.data.object;
    const email       = session.customer_details?.email || session.metadata?.email;
    const productSlug = session.metadata?.productSlug;

    if (!email || !productSlug) {
      console.warn("[stripe-webhook] Missing email or productSlug, skipping KV update");
      return new Response("OK (no metadata)", { status: 200 });
    }

    try {
      await grantProductAccess(env.IB101_PURCHASES, email, productSlug);
      console.log(`[stripe-webhook] Granted "${productSlug}" to ${email}`);
    } catch (err) {
      console.error("[stripe-webhook] KV update failed:", err.message);
      return new Response("KV update failed", { status: 500 });
    }
  }

  return new Response("OK", { status: 200 });
}

// ── Grant access by writing to KV ─────────────────────────────────────────────
async function grantProductAccess(kv, email, productSlug) {
  const key      = `user:${email.toLowerCase()}`;
  const existing = await kv.get(key, { type: "json" });
  const purchases = Array.isArray(existing) ? existing : [];

  if (!purchases.includes(productSlug)) purchases.push(productSlug);

  // Buying the full system also unlocks all individual guides
  if (productSlug === "inner-balance-system") {
    const bundled = [
      "inner-balance-system",
      "self-assurance-practice",
      "self-trust-practice",
      "grounded-practice",
      "uncertainty-reset",
      "guilt-practice",
    ];
    for (const slug of bundled) {
      if (!purchases.includes(slug)) purchases.push(slug);
    }
  }

  await kv.put(key, JSON.stringify(purchases));
}

// ── Stripe signature verification ─────────────────────────────────────────────
async function verifyStripeWebhook(payload, signature, secret) {
  if (!signature || !secret) throw new Error("Missing signature or secret");

  const parts     = signature.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  const v1        = parts.find(p => p.startsWith("v1="))?.slice(3);

  if (!timestamp || !v1) throw new Error("Invalid Stripe-Signature header");

  // Reject events older than 5 minutes (replay attack prevention)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) throw new Error("Webhook timestamp too old");

  const encoder       = new TextEncoder();
  const signedPayload = `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computed  = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed !== v1) throw new Error("Signature mismatch");

  return JSON.parse(payload);
}
