# Published forge security fixes

## Current remediation (2026-11-11)

The temporary 1.4.0 RSA backport is superseded by published `node-forge` **1.4.3**. The root override pins every consumer to that release; the obsolete patch and its single-advisory waiver are removed. Newer advisories affect more than RSA, so extending the old exception would not be safe.

`pnpm release:security` retains the raw `pnpm audit --prod --audit-level moderate --json` output and fails on any moderate, high or critical finding, muted advisory, malformed report or audit error. Low/info reports remain visible at the existing threshold. An unexpected audit exit is not converted to success.

The additional source verifier follows all four known Expo/React Native consumer chains in both customer and partner apps. Every resolved implementation must match the pinned published version and reviewed RSA source digest, then pass seven real RSA cases: valid Node SHA-256, canonical/absent optional parameters, and four malformed nested `DigestAlgorithm` signatures. Exact-source verification supplements—not replaces—the registry audit.

Router query decoding is pinned to `decode-uri-component` 0.5.1. Modern glob consumers (versions 9+) use 14.0.4 and its patched minimatch dependency; legacy glob 7 consumers retain their existing API. Regression tests retain Unicode/arrays/fragments, malformed inputs, image metadata and real Expo build coverage. The distinct-percent-run decoder denial-of-service case executes in a bounded child process.

Passing receipts must name a clean source SHA. This document describes the remediation, not a completed test run or deployment. See the current CI recovery checkpoint for results.

## Historical backport

At the earlier checkpoint, 1.4.0 was the available forge release. A one-file patch rejected unconsumed nested RSA children; its reviewed SHA256 was `5019e28f1429de036f4d13be23639c30b4ce6df7183676608a9888f2714674c9`. The narrow gate allowed only the original CVE-2026-85393 / GHSA-86w9-cpqp-85rv while its exact source and seven RSA cases passed. That is historical evidence, not a current waiver or a claim that 1.4.0 is now safe.

No live authentication, provider approval, native-device proof or physical-fulfillment gate is changed.
