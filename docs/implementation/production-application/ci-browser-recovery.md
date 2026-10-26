# CI browser recovery — first failure only

The first scoped CI reproduction (`b0eeac91b`) built the workspace successfully, then failed `e2e/fulfillment.spec.ts:75` waiting for the old demo T-shirt link. Its actual browser trace showed `GET http://127.0.0.1:4499/v2/catalog/services` failing with `net::ERR_CONNECTION_REFUSED`: the ordinary export had retained the previous synthetic API URL after that public environment variable was unset.

## Small build repair

Customer and rider release exports now use `expo export --platform web --clear`. This trades a fresh Metro export at build checkpoints for reproducible public configuration; it does not affect the development server or add a new build framework. Two focused regression cases first failed on the old scripts; all four Metro workspace checks then passed. Run `b19ce78df` verified both actual fresh exports: the previous configured endpoint was absent from both bundles. The unchanged browser test then still failed, now showing the correct fail-closed message `Configure the explicit v2 API URL before using product sessions`, rather than contacting the stale test server. This isolates the remaining CI configuration/journey mismatch; it is not a green CI run.

## Remaining CI gate

The existing fulfillment and smoke specs still name demo login, v1 garment baskets and simulated gateway capture; the actual product is now the v2 service/unit, OTP and pay-on-return flow. Correcting stale environment output alone cannot establish those journeys. Do not skip these tests, invent missing UI, or label service-only rider calls as real rider-app verification. Preserve the customer quantity/deep-link checks, both real rider-app handovers (including wrong-code rejection and no premature delivery), real ops intake/care/QC, payment provenance, review eligibility/duplicates and PostgreSQL assertions when aligning the gate. CI remains red until the complete replacement coverage passes.

No production deployment, live ordering, real payment or provider activation is authorized by this work.
