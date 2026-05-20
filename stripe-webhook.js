/**
 * Cloudflare Pages Function: /stripe-webhook
 * ─────────────────────────────────────────────
 * Listens for Stripe payment events. On a successful checkout, grants
 * the user access by writing to Firestore via the REST API.
 *
 * Uses only Web Platform APIs (fetch, crypto.subtle) — no Node.js or npm required.
 *
 * Environment variables (Cloudflare Pages → Settings → Environment Variables):
 *   STRIPE_WEBHOOK_SECRET      — Stripe webhook signing secret (whsec_...)
 *   FIREBASE_PROJECT_ID        — e.g. "innerbalance101"
 *   FIREBASE_CLIENT_EMAIL      — from the service account JSON (client_email field)
 *   FIREBASE_PRIVATE_KEY       — from the service account JSON (private_key field)
 *                                 Paste the full value including \n characters
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

  // ── 2. Handle the event ────────────────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session     = event.data.object;
    const userId      = session.metadata?.userId;
    const productSlug = session.metadata?.productSlug;

    if (!userId || !productSlug) {
      console.warn("[stripe-webhook] Missing metadata, skipping Firestore update");
      return new Response("OK (no metadata)", { status: 200 });
    }

    try {
      const accessToken = await getFirestoreToken(env);
      await grantProductAccess(env.FIREBASE_PROJECT_ID, userId, productSlug, accessToken);
      console.log(`[stripe-webhook] Granted "${productSlug}" to user ${userId}`);
    } catch (err) {
      console.error("[stripe-webhook] Firestore update failed:", err.message);
      return new Response("Firestore update failed", { status: 500 });
    }
  }

  return new Response("OK", { status: 200 });
}

// ── Stripe signature verification ─────────────────────────────────────────────
// Uses Web Crypto API (HMAC-SHA256) — no Stripe npm package needed.
async function verifyStripeWebhook(payload, signature, secret) {
  if (!signature || !secret) throw new Error("Missing signature or secret");

  const parts     = signature.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  const v1        = parts.find(p => p.startsWith("v1="))?.slice(3);

  if (!timestamp || !v1) throw new Error("Invalid Stripe-Signature header");

  // Reject events older than 5 minutes (replay attack prevention)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) throw new Error("Webhook timestamp too old");

  const encoder     = new TextEncoder();
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

// ── Get Firestore access token from service account ────────────────────────────
// Generates a signed JWT, exchanges it for a Google OAuth2 access token.
async function getFirestoreToken(env) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss:   env.FIREBASE_CLIENT_EMAIL,
    sub:   env.FIREBASE_CLIENT_EMAIL,
    aud:   "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat:   now,
    exp:   now + 3600,
  };

  const enc        = new TextEncoder();
  const headerB64  = base64urlEncode(JSON.stringify(header));
  const claimB64   = base64urlEncode(JSON.stringify(claimSet));
  const sigInput   = `${headerB64}.${claimB64}`;

  // Parse the PEM private key
  const pemBody = env.FIREBASE_PRIVATE_KEY
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\\n/g, "")
    .replace(/\n/g, "")
    .trim();

  const keyDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    enc.encode(sigInput)
  );

  const jwt = `${sigInput}.${arrayBufferToBase64url(sigBuffer)}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

// ── Update Firestore user document ────────────────────────────────────────────
async function grantProductAccess(projectId, userId, productSlug, accessToken) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${userId}`;
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type":  "application/json",
  };

  // Fetch the current document
  const getRes  = await fetch(baseUrl, { headers });
  const getBody = await getRes.json();

  // Build the updated purchases array (deduplicated)
  let purchases = [];
  if (getRes.ok && getBody.fields?.purchases?.arrayValue?.values) {
    purchases = getBody.fields.purchases.arrayValue.values.map(v => v.stringValue);
  }

  if (!purchases.includes(productSlug)) purchases.push(productSlug);

  // Buying the full system unlocks all individual guides too
  if (productSlug === "inner-balance-system") {
    const all = [
      "inner-balance-system", "practice-bundle",
      "overwhelm-guide", "pressure-guide", "self-doubt-guide",
      "uncertainty-guide", "guilt-guide",
    ];
    for (const slug of all) {
      if (!purchases.includes(slug)) purchases.push(slug);
    }
  }

  const firestoreValues = purchases.map(s => ({ stringValue: s }));

  // Merge-patch the document (creates it if it doesn't exist)
  const existingFields = getRes.ok ? (getBody.fields || {}) : {};
  const patchRes = await fetch(
    `${baseUrl}?updateMask.fieldPaths=purchases&updateMask.fieldPaths=updatedAt`,
    {
      method:  "PATCH",
      headers,
      body: JSON.stringify({
        fields: {
          ...existingFields,
          uid:       { stringValue: userId },
          purchases: { arrayValue: { values: firestoreValues } },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  );

  if (!patchRes.ok) {
    const errBody = await patchRes.text();
    throw new Error(`Firestore PATCH failed: ${errBody}`);
  }
}

// ── Base64url helpers ──────────────────────────────────────────────────────────
function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function arrayBufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
