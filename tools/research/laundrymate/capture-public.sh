#!/usr/bin/env bash
# Capture the public LaundryMate surface for repeat analysis.
#
# The capture directory is outside the product source tree on purpose.
# Raw artifacts are evidence, not source. Commit only the findings.
#
# Usage: capture-public.sh <output-directory>
set -euo pipefail

OUT="${1:-/tmp/laundrymate-capture}"
mkdir -p "$OUT/raw/bundles"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"

PAGES=(
  "https://laundrymate.in/"
  "https://laundrymate.in/our-services/wash-and-fold"
  "https://laundrymate.in/our-services/wash-and-iron"
  "https://laundrymate.in/our-services/steam-iron"
  "https://laundrymate.in/our-services/dry-clean"
  "https://laundrymate.in/login"
  "https://laundrymate.in/help-and-support"
  "https://laundrymate.in/offers"
)

for url in "${PAGES[@]}"; do
  name="$(printf '%s' "$url" | sed 's|https://laundrymate.in/||; s|/|_|g')"
  [ -z "$name" ] && name="index"
  curl -sL -m 30 -A "$UA" "$url" -o "$OUT/raw/${name}.html"
  printf '%s  %s\n' "$(sha256sum "$OUT/raw/${name}.html" | cut -d' ' -f1)" "$url"
done

curl -sL -m 30 -A "$UA" "https://laundrymate.in/" -o "$OUT/raw/shell.html"
for asset in $(grep -oE '(src|href)="[^"]+\.(js|css)"' "$OUT/raw/shell.html" | sed 's/.*="//; s/"$//' | sort -u); do
  curl -sL -m 60 -A "$UA" "https://laundrymate.in/${asset#./}" -o "$OUT/raw/bundles/$(basename "$asset")"
done

( cd "$OUT/raw/bundles" && sha256sum ./* > SHA256SUMS )
printf 'captured into %s\n' "$OUT"
