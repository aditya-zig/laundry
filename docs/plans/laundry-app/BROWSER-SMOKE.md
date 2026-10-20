# Local browser recording smoke receipt

Date: 20 October 2026 (Asia/Kolkata). Result: local recording/export passed. This is a capability check on the planning worksheet, not verification of the Laundry application.

The T3 collaborative browser opened the portable planning worksheet, selected a synthetic Q07 draft choice, exercised its portable-mode control, inspected the result, cleared local choices and verified that all five questions remained unanswered with zero checked inputs. These automated test interactions supplied no founder answers and sent no feedback.

Output: H.264 MP4, 10.2168 seconds, 1228×768, 412246 bytes, media metadata inspected using ffprobe. [Watch the local recording](/home/batman/Projects/code/.lavish/laundry-planning/evidence/local-browser-recording-smoke.mp4). [Manifest](local-browser-smoke.json) includes the file digest and scope limits. Media lives outside the Git repository in accordance with project instructions.

The review page was inspected at 1280×800 and 390×844; its scroll width stayed within both viewports. The standalone page rendered and its controls were checked. The Lavish session wrapper's artifact request returned HTTP 409 in this attempt; the portable export loaded successfully through a separate local server. Do not claim live Lavish annotation delivery was verified.

Still unverified: actual Laundry journeys; Codex cloud browser/recording support; CI recordings and assertions; PR attachment upload/playback; both founders' remote access; Android/iPhone native behavior. These have explicit gates in the setup issue packets.

The portable review worksheet uses the Laundry project's existing design colors and system typography. The HTML plus Markdown review bundle can be transferred without publishing the business material to a public service.
