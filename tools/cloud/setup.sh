#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node 24+ is required"); process.exit(1); }'
if ! command -v pnpm >/dev/null; then
  echo 'Install pnpm 10.33.2 in the cloud environment, then rerun bash tools/cloud/setup.sh.' >&2
  exit 1
fi
if [ "$(pnpm --version)" != '10.33.2' ]; then
  echo 'Use the pinned pnpm 10.33.2 toolchain for this repository.' >&2
  exit 1
fi
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
printf '%s\n' 'Dependencies and Chromium prepared. Provision an isolated local PostgreSQL database named laundry_verify_<run> before tests.'
printf '%s\n' 'Then set DATABASE_URL, build/check/test, and run pnpm verify:browser. No task, deployment or model call was launched.'
