# Dependency hardening — 24 October 2026

Scope: existing NestJS/Expo workspace, not a production release certificate.

## Changes and compatibility

The initial production-dependency audit reported 56 advisories: one critical,
31 high, 19 moderate and five low. NestJS common/core/platform-express now use
11.2.8 together. Scoped pnpm overrides pin patched tar, qs, PostCSS, xmldom,
send, body-parser, undici, path-to-regexp, fast-uri, multer and uuid versions.

Two major/module-format upgrades needed explicit compatibility patches:

- `image-size` 2.0.3 fixes both reported infinite-loop advisories. Metro 0.81.5
  expects the old callable CommonJS export and synchronous path API. The checked-in
  pnpm patch adapts the named export and reads path inputs before decoding. Tests
  exercise buffers, filesystem assets, archive-buffer paths, density metadata,
  empty/non-image inputs and a zero-length ICNS entry in a time-bounded process.
- `decode-uri-component` 0.5.0 fixes malformed-percent-input denial of service.
  A scoped override and one-line `query-string` 7.1.3 import adapter preserve the
  existing public query API. Both apps still explicitly supply query-string:
  Expo Router 4 imports it without declaring it. Attempted removal based only on
  application-source imports failed the actual Expo build and was reverted.
  Tests cover Hindi text, arrays, spaces, null query values, fragments, malformed
  input and a large malformed run in a time-bounded process.

The compatibility regressions first reproduced `getImageSize is not a function`
and `decodeComponent is not a function`, then passed with the patches. The patch
files are version-pinned and hashed in the frozen lockfile; they are not edits
that depend on retaining a developer's node_modules directory.

## Verification

- Frozen lockfile install, full workspace build, `pnpm check`, contract generation
  check and all 612 PostgreSQL-backed/workspace tests pass locally.
- Tooling tests: 59 pass, including nine new dependency/security-gate cases.
- Final `pnpm audit --prod --json`: exit **1**, two high advisories, no critical,
  moderate or low advisories. The removed 54 findings are registry-reported
  improvements, not a claim of comprehensive vulnerability absence.
- `pnpm release:security` preserves audit failure. The separate **Dependency
  security gate** workflow runs on pushes/PRs, manual dispatch and weekly schedule,
  and retains the audit log even on failure. It has no ignore list,
  continue-on-error or success-producing pipeline. It is expected to stay red
  until the following findings are actually resolved.

## Unresolved release blockers

- [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv):
  registry reports no patched version. It enters through Expo CLI/code-signing and
  development-certificate dependencies. Do not treat tooling placement as a waiver
  or invent a patched version. Re-evaluate an upstream correction or reviewed Expo
  toolchain migration before release; web checks do not establish native safety.
- [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5):
  audit requires >=4.6.6 while current wire contracts and consumers use 3.23.8.
  A coordinated migration must preserve input/output, defaults, errors, OpenAPI,
  SDK and native compatibility. Forcing every consumer onto a new major version,
  or importing the old v3 implementation through a newer package to silence the
  audit, is not an acceptable remediation.

No risk acceptance is inferred. Production ordering remains disabled independently
of these findings. New cloud build/browser/restore runs must be observed for this
change; the prior green runs at `5378029` are not evidence for a later revision.
