# Laundry naming migration

The founder confirmed **Laundry** as the name and requested a full current-project
rename on 12 October 2026. This supersedes the initial display-only correction.

Current naming:

- Workspace: `/home/batman/Projects/code/Laundry`.
- Private repository: https://github.com/aditya-zig/laundry.
- Default/production branch: `build/laundry`.
- Workspace packages/imports: `@laundry/*`; SDK client type: `LaundryClient`.
- Expo app names, slugs, schemes and demo-session keys use Laundry/laundry.
- CI, backend health/log labels, local database/Compose identifiers, assets,
  speech tooling, current specifications and task packets use Laundry/laundry.
- Vercel projects: `laundry-customer`, `laundry-partner`, `laundry-ops`.
- Operations URL: https://laundry-ops.vercel.app. Customer and partner URLs stay
  https://laundry-customer-five.vercel.app and https://laundry-partner.vercel.app.

The GitHub rename preserves repository identity, private visibility, commits and
secrets. Vercel Git links point to the renamed repository and production branch.
A legacy operations alias is retained for links already shared. Canonical asset
URLs use the new operations domain. Demo-session namespace changes require a new
demo sign-in; installed native clients need a rebuild to use the new schemes.

Historical Git commits, release receipts, raw evidence/screenshots and the video
already sent to WhatsApp keep their original labels: they are immutable evidence,
not current product naming. No old evidence was altered to fabricate new results.
Ignored logs, generated files and local model caches are not source artifacts.
Local database volumes are not deleted or silently migrated: the renamed Compose
configuration creates a new development namespace; export/restore any existing
local data before switching. Convex project/deployment IDs and business data are
unchanged. Fly/Render files remain unprovisioned templates, not new live services.

Verification receipts will identify the source commit and deployment results after
push. This naming migration does not enable live merchant production readiness.
