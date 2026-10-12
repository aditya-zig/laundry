# Production readiness discovery

Date: 12 Oct 2026. Scope: read only. Owner of this file only. Main handles deploy and implementation.

Method: code read only plus native computer use inspection of Zen. No secret values read or copied. No upgrades, payments, legal accepts, charges, or sent messages. No other project credentials used.

## Zen evidence

Zen was running as pid 10106. Active window title was ChatGPT.

Visible documents in the accessibility tree:

* Wandary Partner demo page, with demo rider sign in button
* One empty document
* One New Tab with Zen search
* ChatGPT settings on Usage
* Convex dashboard page titled Health dev galaxy-d Laundry
* Boot.dev Learn AWS page

I saw no tabs for Razorpay, Meta WhatsApp Business or Cloud API, SMS OTP vendor, or rider provider such as Shadowfax, Porter, Dunzo, or similar. The tab bar did not expose extra provider names through the accessibility tree. I did not open new provider pages or sign in anywhere.

Convex sign in is confirmed by the dashboard content:

* Team galaxy-d, project Laundry, dev deployment hidden-trout-436
* Region Asia Pacific Sydney, deployment class S16, Convex package 1.46.0
* Last deployed less than a minute ago at inspection time, by Galaxy D
* Public cloud URL https://hidden-trout-436.ap-southeast-2.convex.cloud
* HTTP actions URL https://hidden-trout-436.ap-southeast-2.convex.site
* Health page showed All clear with no function call data yet

This matches docs/implementation/convex-project-ready.md. I created no duplicate project.

ChatGPT Usage showed 5 hour limit 77 percent left and weekly limit 81 percent left at inspection time. I took no upgrade or reload action.

## Provider configuration availability

All four Laundry specific providers are unconfigured for production in code. This is from .env.example and module source, not from secret values.

SMS auth: not available. modules/shared/src/auth.ts uses local OTP challenges and DEMO_MODE. Production OTP needs a real SMS vendor. No vendor client exists in the tree. Demo phones and demo code are dev only.

Razorpay: not available. modules/billing/src/billing.ts throws PROVIDER_UNAVAILABLE when RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET are missing. Refund path marks SUCCEEDED locally when unconfigured, which must not run in production. Webhook verification needs the secret. No Razorpay dashboard tab was visible in Zen to confirm an account.

WhatsApp Business voice agent: not available. modules/conversations/src/whatsapp.ts returns not-configured when WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID are missing, and simulated while DEMO_MODE is not false. Webhook verification needs WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN. Voice notes need Cloud API media retrieval plus transcription selection. No Meta developer or Business Manager tab was visible in Zen to confirm a number, app, or template.

Rider provider: not available beyond manual. apps/api billing controller rejects logistics provider other than manual with PROVIDER_UNAVAILABLE. Partner app supports manual OTP handover and read only provider managed jobs. No commercial dispatch contract, webhook, or tracking integration exists. No rider provider tab was visible in Zen.

## WhatsApp self recipient

Status: still unconfirmed after authorized open attempt.

I tried to open https://web.whatsapp.com in Zen with computer use. Steps were ctrl+t, ctrl+l, click on the address combo, type the address, and Return. I rechecked Zen state after each step. The visible documents stayed the same. No WhatsApp document appeared. I sent nothing and read no chats.

Earlier state had no WhatsApp Web tab. That alone does not prove the account is missing. It only proves I could not confirm a Message yourself chat from open tabs. I recorded no phone numbers.

The user authorized a completion message on WhatsApp only after verified works. That path stays blocked until a self chat can be confirmed without reading other chats, and until production itself is verified by Main.

## Follow-up on 12 Oct 2026

Authorized browser opens did not change Zen tabs through the current computer use path. Synthetic address bar focus and typing left the accessibility tree identical across checks. Same five documents remained. No WhatsApp, Razorpay, or Meta developer document appeared.

So signed in status for Razorpay and Meta developer resources remains unknown, not confirmed missing. I did not push further navigation to avoid churning user tabs. I did not sign in anywhere, copy secrets, pay, create contracts, or call paid APIs.

## Production blockers

* Real SMS OTP vendor missing. Demo auth must stay off in production.
* Razorpay live keys, webhook secret, and account verification missing.
* WhatsApp Business number, Cloud API token, app secret, verify token, templates, consent handling, and voice transcription choice missing.
* Rider contract missing. Only manual dispatch works now.
* Service area, rate card, tax, capacity, and refund policy inputs missing per product spec.
* Convex functions show no calls yet. Backend migration and deploy remain with Main.
* WhatsApp completion recipient not confirmed.

I claim no production success. All sends and real charges remain disabled.
