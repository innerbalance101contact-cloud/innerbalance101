# innerbalance101 repo map

Last organised: 8 October 2026. Updated for the member system. Site root is the repo root, so live pages stay at the top level. Moving a live page changes its web address.

## 1. Live and current (redesigned, forest/bark/Vollkorn)
- index.html (home)
- about.html
- the-system.html
- contact.html
- emotional_load_assessment.html (free assessment, 5 minutes)
- resources.html (free tools: Emotions and Sensations Chart, Feelings List, assessment)
- login.html, dashboard.html (member sign in and progress, noindex)
- stage1-sos.html, stage2-clarity.html, stage3-inner-balance.html (locked: sign in and a purchase are required, enforced by functions/_middleware.js)
- blog/ (index plus 30 posts) and blog/post-template.html
- images/, fonts/, favicon.svg, naomi.jpeg

## 2. Live, not redesigned yet (older look)
- bundle-download.html
- system-offer-a.html, system-offer-b.html
- privacy-policy.html, terms-and-conditions.html
- hb-gift.html (free "Come Back to Yourself" guide, noindex)
- Resources/ (Emotions and Feelings-List PDFs)

## 3. Plumbing (do not move)
- functions/_middleware.js (the lock), kit-webhook.js (Kit purchases and tags), kit-assessment-subscribe, api/session.js, api/me.js, api/progress.js, _lib/ (config, shared, kit)
- js/auth.js (Firebase sign in), js/progress-widget.js (the "I did today's practice" card)
- Data lives in Cloudflare KV (IB101_DATA): access, progress, webhook log
- _redirects, robots.txt, sitemap.xml
- functions/1 and js/1 are empty placeholder files that keep folders in git
- Retired Stripe code (functions/create-checkout.js, functions/stripe-webhook.js, js/stripe.js): delete once the new login and dashboard are live. Kit handles payment.

## 4. Outdated (kept for history, safe to delete from GitHub when ready)
- library-outdated/ holds library.html, the five 10-minute practice pages and their PDFs (library-outdated/pdfs/).
  Old addresses redirect here through _redirects, so nothing 404s. Pages are noindex and out of the sitemap.
  Still pointing at them: bundle-download.html and some blog posts.
  When you delete the folder, remove those links and the library lines in _redirects first.
- outdated-misc/ holds auth.js and create-checkout.js (identical copies of js/auth.js and functions/create-checkout.js, not referenced anywhere) and REVERT_ad734857_message.md (a stray git note).

## 5. Reference documents published at the root (decide later)
- innerbalance101-brand-board.html
- emotions-sensations-chart.html
