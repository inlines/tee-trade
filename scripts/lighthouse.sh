#!/usr/bin/env bash
# Requires Node >=22 and a local Chrome installation. Run against a production build.
set -euo pipefail
base="${BASE_URL:-http://localhost:4200}"
output="${REPORT_DIR:-/tmp/futba-lighthouse}"
mkdir -p "$output"
for page in home catalog product; do
  case "$page" in
    home) route=/ ;;
    catalog) route=/catalog ;;
    product) route="${PRODUCT_PATH:-/product/17}" ;;
  esac
  npx --yes lighthouse@12.8.2 "${base%/}$route" \
    --chrome-flags='--headless=new' \
    --only-categories=performance,accessibility,best-practices,seo \
    --output=json --output=html --output-path="$output/$page" --quiet
done
