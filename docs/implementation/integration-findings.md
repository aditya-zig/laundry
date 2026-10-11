# Coordinator integration review notes

These are source-inspection leads for the independent Muse integration verifier, not verified final outcomes. Recheck against finished code.

- Speech adapter currently writes note.bin and treats subprocess stdout as plain transcript, while the Antigravity transcriber validates extensions and emits JSON {text,language,uncertainSpans}. Test actual audio endpoint integration; preserve MIME-derived suffix and parse structured output, including uncertain spans.
- Speech environment arguments currently split on spaces. Use explicit argv JSON/config or a wrapper executable to support paths with spaces without a shell. Bound stdout/stderr to avoid subprocess memory growth.
- Database migration lookup contains a workstation-specific absolute fallback. Ensure clean clone can start and built output finds migrations deterministically.
- Production startup must reject demo/default credentials and unavailable production provider wiring rather than expose demo routes implicitly. Inspect NODE_ENV behavior.
- Customer/partner web preview requires actual Expo web runtime dependencies and build scripts; verify runtime screens, not only guard-unit tests. Native API origin must be configurable.
- Ops intake must send actual measured order-line quantities and bagIds using backend contract, rather than a reason record pretending to be garment lines.
- Root tools/dev.mjs supervises a process group per app; verify all ports close after stopping, root .env loading and startup failure behavior.
- Final README/CI/env example must match actual scripts/endpoints. Do not weaken tests or use passWithNoTests. Confirm root recursive check/build/test reach all app workspaces.

- API initial CORS allowlist omitted partner :8082 and operations :5173. Static assets use process.cwd(), which differs when launched through pnpm --filter. Verify each app endpoint and image response through actual browser.
- Conversation draft lookup currently uses a shared conversation_key=demo; test separate customer and WhatsApp sender isolation, actor ownership on explicit draftId, and bound revision/quote confirmation. Do not let one user alter another draft.
- Message parser must distinguish pickup date/time from required return deadline and service intent (wash and iron must select combined wash/press rather than press-only). Test word counts and time minutes.

- Service SVG images render on web; React Native Image does not reliably support SVG on Android/iOS. Ensure native-safe catalog media (e.g. generate PNG from original SVG, serve both; keep original provenance) or appropriate SVG runtime. Native builds/device behavior must be reported unverified if not exercised.
- Local .env now configures WHISPER_COMMAND as the voice wrapper and WHISPER_CACHE_DIR under .data/whisper; public model weights copied from the verified cache, ignored by git. .env.example must show portable setup placeholders without workstation-specific paths.

- Expo public variables require static process.env.EXPO_PUBLIC_API_URL access for Metro inlining. The current dynamic globalThis.process env lookup may not configure the API URL on native/web export. Verify build-time override and use supported static syntax.

- Critical WhatsApp implementation gap: audio webhook uses empty bytes and replies only in HTTP acknowledgement; worker ignores notifications. See expanded backend-status.md and implement credential-configured media/transport plus honest demo ledger and provider-fixture tests. No actual paid/live calls.
