# Temporary forge security backport

`node-forge` 1.4.0 remains the latest published release and the registry still reports CVE-2026-85393 / GHSA-86w9-cpqp-85rv. We have not changed that version, muted the advisory, or declared an unpublished version patched.

`patches/node-forge@1.4.0.patch` implements the nested `DigestAlgorithm` child-count validation described in upstream digitalbazaar/forge PR #1152. The existing outer `DigestInfo` check was insufficient: extra nested children were silently ignored. The patch rejects anything beyond the OID and optional parameters while retaining both canonical NULL and absent-parameter forms. It changes only `lib/rsa.js`.

Verification:

- Original installed source failed all four malformed-signature rejection regressions. They generate local synthetic exponent-3 RSA keys and real signatures, not mocks or production keys.
- Corrected source passes those four cases plus valid Node-generated SHA-256 signatures and canonical/absent optional parameters: seven RSA cases.
- `release-security.mjs` follows all four known Expo / React Native consumer chains in both apps; verifies the global package patch mapping, patch scope, package version and exact RSA SHA256 `5019e28f1429de036f4d13be23639c30b4ce6df7183676608a9888f2714674c9`; then runs the RSA regressions against every resolved implementation.
- The full raw audit is retained. The sole recognized version-based finding must match the exact package, version, advisory, CVE, severity and vulnerability totals. Unknown advisories, audit failures, muted advisories, altered/missing implementations and newly published patched versions fail. This is source-remediation verification, not a generic ignore list.
- Focused security/tooling tests passed; the full `tools/cloud/*.test.mjs` suite passed 66 tests. `pnpm release:security` passed with the raw high-severity upstream version finding still visible and a separate verified-backport result.

Replace this temporary backport with a published corrected version once available. This correction does not certify live integrations, cloud deployment, native builds, or physical fulfillment.
