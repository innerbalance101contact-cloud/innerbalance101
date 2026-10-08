# innerbalance101 repo map

Last organised: 8 October 2026. Site root is the repo root, so live pages stay at the top level. Moving a live page changes its web address.

## 1. Live and current (redesigned, forest/bark/Vollkorn)
- index.html (home)
- about.html
- the-system.html
- contact.html
- emotional_load_assessment.html (free assessment, 5 minutes)
- stage1-sos.html, stage2-clarity.html, stage3-inner-balance.html
- blog/ (index plus 30 posts) and blog/post-template.html
- images/, fonts/, favicon.svg, naomi.jpeg

## 2. Live, not redesigned yet (older look)
- resources.html
- dashboard.html
- login.html
- bundle-download.html
- system-offer-a.html, system-offer-b.html
- privacy-policy.html, terms-and-conditions.html
- hb-gift.html (free "Come Back to Yourself" guide, noindex)
- Resources/ (Emotions and Feelings-List PDFs)

## 3. Plumbing (do not move)
- functions/ (Cloudflare Pages functions: checkout, Stripe webhook, Kit assessment subscribe)
- Payment code (functions/create-checkout.js, functions/stripe-webhook.js, js/stripe.js): decision pending, do not touch yet
- js/ (auth.js, stripe.js)
- _redirects, robots.txt, sitemap.xml
- functions/1, js/1, Resources/temp are empty placeholder files that keep folders in git

## 4. Outdated (kept for history, safe to delete from GitHub when ready)
- library-outdated/ holds library.html, the five 10-minute practice pages and their PDFs (library-outdated/pdfs/).
  Old addresses redirect here through _redirects, so nothing 404s. Pages are noindex and out of the sitemap.
  Still pointing at them: dashboard.html, bundle-download.html and the "Try a guided reset" button on 7 blog posts.
  When you delete the folder, remove those links and the library lines in _redirects first.
- outdated-misc/ holds auth.js and create-checkout.js (identical copies of js/auth.js and functions/create-checkout.js, not referenced anywhere) and REVERT_ad734857_message.md (a stray git note).

## 5. Reference documents published at the root (decide later)
- innerbalance101-brand-board.html
- emotions-sensations-chart.html
