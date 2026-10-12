# Laundry display-name correction

The customer, delivery partner and operations apps now display **Laundry**, not
the former working name. This includes home/navigation headings, browser/app
titles and partner employment copy. The README and OpenAPI display title agree.

Compatibility identifiers remain unchanged: `@wandary/*` package imports,
`WandaryClient`, persisted demo-session keys, Expo slugs/deep-link schemes,
GitHub repository/branch and existing Vercel URLs. This is a display correction,
not an infrastructure or authentication migration. All demo warnings remain.
Historical reports and the previously sent screen recording retain the former name.

Local verification:

- Five branding regressions failed against the former names, then passed.
- Operations: 11 tests; customer: 8; partner: 6; contracts: 11 passed.
- `pnpm check`, `pnpm check:convex`, `pnpm build`, `git diff --check` passed.

Git-built deployment and browser verification are tracked separately after push.
This change does not enable live merchant production readiness.
