/**
 * innerbalance101 — member system configuration
 * ─────────────────────────────────────────────
 * The one file to edit when products, access rules or stages change.
 *
 * Kit (Commerce) handles checkout. Kit tells us about purchases through
 * webhooks (see functions/kit-webhook.js). Everything below decides what a
 * purchase unlocks on the site.
 *
 * Scope today: The Inner Balance System only. The library and the $17
 * practices are retired. When a library returns after Stage 3, add its
 * product rule and protected paths here.
 */

// Firebase project used for login (public value, same as js/auth.js).
export const FIREBASE_PROJECT_ID = "innerbalance101-33628";

// Session cookie lifetime. Access itself is checked live on every request,
// so this only controls how often a member has to sign in again.
export const SESSION_DAYS = 7;

// ── Product map ──────────────────────────────────────────────────────────────
// Kit sends the product NAME (and SKU if you set one). The first rule whose
// pattern matches name + sku decides what the purchase unlocks.
// `days` (optional) = how long a grant lasts before a renewal is needed.
// Anything that matches nothing is saved under "unmatched:" in KV so no
// purchase is silently lost.
export const PRODUCT_RULES = [
  { match: /inner balance system/i, slug: "inner-balance-system" },
];

// ── Stages ───────────────────────────────────────────────────────────────────
export const DAYS_PER_STAGE = 21;

export const STAGES = [
  { slug: "stage-1", label: "Stage 1: The SOS",       path: "/stage1-sos" },
  { slug: "stage-2", label: "Stage 2: The Clarity",   path: "/stage2-clarity" },
  { slug: "stage-3", label: "Stage 3: Inner Balance", path: "/stage3-inner-balance" },
];

// Stage 2 opens after 21 completed days of Stage 1, Stage 3 after Stage 2.
export const STAGES_ARE_SEQUENTIAL = true;

// Which grants open the stages.
export const STAGE_REQUIRES = ["inner-balance-system"];

// ── Protected routes (hard lock, enforced in functions/_middleware.js) ───────
// Paths are matched after lowercasing and stripping ".html" and trailing "/".
export const PROTECTED = [
  ...STAGES.map((s, i) => ({ path: s.path, kind: "stage", stageIndex: i })),
  // Printable guides: locked the same way as the stage they belong to.
  { path: "/guides/stage-1-sos-guide", kind: "stage", stageIndex: 0 },
  { path: "/guides/stage-2-clarity-guide", kind: "stage", stageIndex: 1 },
  { path: "/guides/stage-3-inner-balance-guide", kind: "stage", stageIndex: 2 },
  { path: "/dashboard", kind: "account" },
  { path: "/admin", kind: "admin" },
];
