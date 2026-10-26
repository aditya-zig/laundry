# Customer post-delivery review checkpoint

## Scope

Connect the existing v2 review service to the customer's owned-order screen. This does not replace the backend's eligibility, ownership, version, uniqueness or publication checks.

- No preselected rating; an explicit overall score from 1–5 is required.
- The order must be delivered and its owner-specific eligibility read must permit a new review. Recorded reviews suppress the new-review form.
- The command captures the exact order/version, written feedback and publication consent. Consent defaults off. No media IDs are fabricated.
- Publication still requires consent **and** moderation; a submitted private review is not a public testimonial.
- An uncertain result restores the original actor-bound body/key through the first-party foundation/SDK. It never silently changes the score, consent or expected version. Corrupt/ambiguous or unavailable retained intent blocks replacement submission.
- Queue/session defaults remain memory-only. This is not native secure-storage or process-death acceptance.

## Reproduction and verification

A new foundation regression first failed (`b612a1b86`) with `No approved replay sender exists; reconcile the retained intent`. The foundation had no approved `reviews.create` dispatch even though the backend/SDK route already existed. Added a typed, fixed first-party SDK sender; persisted route text is not executed dynamically.

New customer cases cover delivered/eligibility/order-ID checks, score and text bounds, explicit private/public consent, exact frozen replay, unrelated intents and corrupt/ambiguous records. Foundation coverage checks reply-loss recovery and rejects altered publication consent under the retained key. The five new input safeguards passed (`bee0809af`). The full foundation suite (37 tests), customer suite (112 tests) and workspace typechecks passed (`b419d0c38`).

The extended actual-browser run `b2ab4dce6` passed: finish the existing synthetic return/manual-collection flow; leave one private review; replace its committed reply with an HTTP 503; navigate away/back; reconcile the same review/key; prove one row, no publication consent/publication, and no second-review form. No page errors were reported. Desktop and 390px mobile screenshots were inspected and the desktop had no horizontal overflow. This is dirty-worktree evidence; clean-revision full regression and restore evidence are still pending.

The dirty-worktree restore rehearsal `b22027f12` passed: all 91 PostgreSQL 18.6 tables and sequences matched, private consent/publication facts survived, encrypted identity recovery worked, and a duplicate review with a **different** review ID was rejected by one-review-per-order uniqueness (not merely by its primary key). Clean-revision repetition remains pending.

## Remaining gates

- Support ticket creation/messages are the next distinct UI task; they are not included by this checkpoint.
- Live authentication/provider approvals, staff MFA, physical fulfillment, rider-device/offline/process-death checks, production-host recovery and business sign-off remain open. No paid calls, live messages, ordering enablement or deployment is authorized by this work.
