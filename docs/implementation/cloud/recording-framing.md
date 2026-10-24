# Recording framing correction

Further manual review of the downloaded `f9b00f1` cloud recording found that its
1920×1080/30fps metadata was correct, but the active browser occupied only a
narrow part of the desktop. The second sample was **77% black canvas**. Previous
metadata/mean-brightness acceptance does not establish usable full-frame footage;
those original artifacts remain valid historical demo behavior evidence, not a
satisfactory review-quality recording.

Ordinary web acceptance retains a 390×844 phone viewport and 1280×800 operations
viewport. Isolated headed recordings instead use 1904×960 for **every** role,
leaving room for browser chrome inside the original 1920×1080 Xvfb display. No
source video is upscaled, cropped or composited to disguise unused space.

The recorder now measures black-canvas percentage for each extracted sample and
requires at least two of three samples to have at most 20% black pixels as well
as adequate brightness. This threshold is specific to the current light demo
apps; it is not a general dark-UI quality test. Human review is still mandatory.
Four new tests distinguish ordinary/recorded viewports, reject the old narrow
framing despite its passing mean luma, and fail on missing/invalid measurements.
Local check and all 68 tooling tests pass. At clean `b29d34d`, the new original
recording passed: H.264, 1920×1080, 30fps, 21.033 seconds; all three samples have
3% black pixels and were visually inspected. SHA-256:
`682d47d2a40ed5cee52b79714fb92d79cb8627771be61c481bd15acb30012043`.
The first local attempt failed because the extracted Xvfb runtime lacked its
local libselinux library path; adding the actual extracted library directory
fixed the environment, not the assertions. Cloud uses installed Xvfb. Subsequent
review exposed customer tracking/cancellation display bugs, recorded separately
in [the tracking handoff](tracking-display.md).

The previous clean commit `207cfbb` passed its local synthetic restore. Its first
post-deployment live probe returned 503 on the authenticated upstream check;
eight other boundary checks passed. A subsequent separate invocation passed all
nine. The first failure is retained in private logs and is not silently retried
into a success. The transient cause has not been established; this is not a
production availability/SLO claim. Product readiness remains closed.
