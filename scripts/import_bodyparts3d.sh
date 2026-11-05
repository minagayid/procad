#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$ROOT/app/public/dental-library/bodyparts3d-teeth-4.3"
DEST="$DEST_DIR/teeth.glb"
TMP="$DEST.tmp"
URL="https://raw.githubusercontent.com/organui/teeth-3d/f2cfe96f19dba7ec3982f2b06e6a34a1f6670450/public/models/teeth.glb"
EXPECTED_SHA256="89a1074b0806eb41c318d38c78a269134c5070be7b90cb2f93ab2de7d35ec239"

mkdir -p "$DEST_DIR"
trap 'rm -f "$TMP"' EXIT
curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --output "$TMP" "$URL"

if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$EXPECTED_SHA256" "$TMP" | sha256sum --check --status
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP" | awk '{print $1}')"
  test "$ACTUAL" = "$EXPECTED_SHA256"
else
  echo "Need sha256sum or shasum to verify the downloaded model." >&2
  exit 1
fi

mv "$TMP" "$DEST"
echo "Verified and installed: $DEST"
echo "Review attribution, share-alike license and educational-use limitations before redistribution or clinical use."
