/**
 * Cloudflare Pages Function: /create-checkout
 * ─────────────────────────────────────────────
 * Creates a Stripe Checkout session and returns the redirect URL.
 * Called by js/stripe.js → checkout()
 *
 * Environment variables (set in Cloudflare Pages → Settings → Environment Variables):
 *   STRIPE_SECRET_KEY   — Stripe secret key (sk_live_... or sk_test_...)
 */

export async function onRequestPost({ request, env }) {
  // CORS headers — allow your domain
  const corsHeaders = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ message: "Invalid JSON" }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { priceId, productSlug, email, userId, successUrl, cancelUrl } = body;

  if (!priceId || !successUrl || !cancelUrl) {
    return new Response(JSON.stringify({ message: "Missing required fields" }), {
      status: 400, headers: corsHeaders,
    });
  }

  // ── Call Stripe API directly (no npm needed) ──────────────────────────────
  // Cloudflare Workers use the Fetch API, so we call Stripe's REST API directly.
  const params = new URLSearchParams({
    mode:                          "payment",
    "line_items[0][price]":        priceId,
    "line_items[0][quantity]":     "1",
    success_url:                   successUrl,
    cancel_url:                    cancelUrl,
    "metadata[userId]":            userId      || "",
    "metadata[productSlug]":       productSlug || "",
  });

  // Pre-fill customer email if known
  if (email) {
    params.set("customer_email", email);
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method:  "POST",
    headers: {
      "Authorization":  `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type":   "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const session = await stripeResponse.json();

  if (!stripeResponse.ok) {
    console.error("[create-checkout] Stripe error:", session.error?.message);
    return new Response(JSON.stringify({ message: session.error?.message || "Stripe error" }), {
      status: 500, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200, headers: corsHeaders,
  });
}

// Handle preflight CORS
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
