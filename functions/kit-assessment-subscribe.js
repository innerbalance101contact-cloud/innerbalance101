/**
 * Cloudflare Pages Function: /kit-assessment-subscribe
 * Subscribes assessment leads to Kit and writes result custom fields.
 *
 * Environment variable:
 *   KIT_API_KEY - Kit public API key
 */

const KIT_FORM_ID = "9180408";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function onRequestPost({ request, env }) {
  if (!env.KIT_API_KEY) {
    return json({ message: "Missing KIT_API_KEY" }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Invalid JSON" }, 400);
  }

  if (!payload.email) {
    return json({ message: "Missing email" }, 400);
  }

  const kitPayload = {
    api_key: env.KIT_API_KEY,
    email: payload.email,
    first_name: payload.first_name || "",
    fields: payload.fields || {},
  };

  const response = await fetch(`https://api.convertkit.com/v3/forms/${KIT_FORM_ID}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(kitPayload),
  });

  const text = await response.text();

  if (!response.ok) {
    return new Response(text || JSON.stringify({ message: "Kit request failed" }), {
      status: response.status,
      headers: corsHeaders,
    });
  }

  return new Response(text || JSON.stringify({ ok: true }), {
    status: 200,
    headers: corsHeaders,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}
