/**
 * innerbalance101 — Stripe Integration Module
 * ────────────────────────────────────────────
 * Handles redirecting to Stripe Checkout for purchases.
 * Works in tandem with js/auth.js and the Netlify webhook function.
 *
 * Usage:
 *   import { checkout } from '/js/stripe.js';
 *   await checkout('inner-balance-system');
 *
 * Or from a plain button:
 *   <button onclick="IB101Stripe.checkout('inner-balance-system')">Buy</button>
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Replace STRIPE_PUBLISHABLE_KEY with your key from:
//   Stripe Dashboard → Developers → API Keys → Publishable key (starts with pk_)
const STRIPE_PUBLISHABLE_KEY = "YOUR_STRIPE_PUBLISHABLE_KEY";

// Map product slugs → Stripe Price IDs
// Create prices in: Stripe Dashboard → Products → Add product
// Each price ID starts with "price_"
const PRODUCTS = {
  // One-time purchases
  "inner-balance-system": {
    priceId:     "price_REPLACE_WITH_INNER_BALANCE_SYSTEM_PRICE_ID",
    name:        "The Inner Balance System",
    description: "Three-stage emotional regulation programme — 21 days each stage",
    type:        "one_time",
  },
  "practice-bundle": {
    priceId:     "price_REPLACE_WITH_BUNDLE_PRICE_ID",
    name:        "The Practice Bundle",
    description: "All five 10-minute practice guides (PDF + audio)",
    type:        "one_time",
  },
  "self-doubt-guide": {
    priceId:     "price_REPLACE_WITH_SELF_DOUBT_PRICE_ID",
    name:        "Self-Doubt Practice Guide",
    description: "10-minute somatic practice for self-doubt",
    type:        "one_time",
  },
  "overwhelm-guide": {
    priceId:     "price_REPLACE_WITH_OVERWHELM_PRICE_ID",
    name:        "Overwhelm Practice Guide",
    description: "10-minute somatic practice for overwhelm",
    type:        "one_time",
  },
  "pressure-guide": {
    priceId:     "price_REPLACE_WITH_PRESSURE_PRICE_ID",
    name:        "Pressure Practice Guide",
    description: "10-minute somatic practice for pressure",
    type:        "one_time",
  },
  "guilt-guide": {
    priceId:     "price_REPLACE_WITH_GUILT_PRICE_ID",
    name:        "Guilt Practice Guide",
    description: "10-minute somatic practice for guilt",
    type:        "one_time",
  },
  "uncertainty-guide": {
    priceId:     "price_REPLACE_WITH_UNCERTAINTY_PRICE_ID",
    name:        "Uncertainty Practice Guide",
    description: "10-minute somatic practice for uncertainty",
    type:        "one_time",
  },
};

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────

/**
 * Redirect the user to Stripe Checkout for a given product.
 *
 * @param {string} productSlug  — key from PRODUCTS above
 * @param {string} [email]      — pre-fill the customer's email if known
 * @param {string} [userId]     — Firebase UID, stored in Stripe metadata
 *                                 so the webhook can grant access
 */
export async function checkout(productSlug, email = "", userId = "") {
  const product = PRODUCTS[productSlug];
  if (!product) {
    console.error(`[IB101 Stripe] Unknown product: ${productSlug}`);
    return;
  }

  // Build the checkout session via your Netlify function
  const response = await fetch("/create-checkout", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      priceId:     product.priceId,
      productSlug,
      email,
      userId,
      successUrl: `${window.location.origin}/dashboard.html?purchase=success&product=${productSlug}`,
      cancelUrl:  `${window.location.origin}/the-system.html?purchase=cancelled`,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Could not create checkout session");
  }

  const { url } = await response.json();
  window.location.href = url;
}

/**
 * Check if the current user has purchased a product.
 * Reads from the user's Firestore profile (populated by the webhook).
 *
 * @param {Array<string>} purchases  — user.purchases array from Firestore
 * @param {string}        productSlug
 * @returns {boolean}
 */
export function hasPurchased(purchases = [], productSlug) {
  return Array.isArray(purchases) && purchases.includes(productSlug);
}

/**
 * Show a toast notification (used after a successful purchase redirect).
 */
export function showPurchaseToast(message = "Purchase successful! Welcome.") {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position:fixed; bottom:32px; left:50%; transform:translateX(-50%);
    background:#4F6861; color:#FAF7F2; padding:14px 28px;
    border-radius:4px; font-family:'Jost',sans-serif; font-size:0.9rem;
    font-weight:400; letter-spacing:0.03em; z-index:9999;
    box-shadow:0 4px 20px rgba(44,36,32,0.18);
    animation: fadeInUp 0.3s ease;
  `;
  toast.textContent = message;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes fadeInUp {
      from { opacity:0; transform:translateX(-50%) translateY(12px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.4s";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ─── EXPOSE GLOBALLY ─────────────────────────────────────────────────────────
window.IB101Stripe = { checkout, hasPurchased, showPurchaseToast, PRODUCTS };
