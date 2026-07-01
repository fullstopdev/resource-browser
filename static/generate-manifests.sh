#!/bin/bash
# Generate manifest.json files for each release folder.
# Updates src/lib/releases.yaml from discovered release folders.
#
# Before generating manifests, missing CRD folders are backfilled within each
# release train (major.minor siblings). See lib/backfill-crds-lib.sh.
#
# For the full pipeline (fetch CRDs + backfill + manifests + release notes), use:
#   ./static/sync-release.sh [RELEASE]
#
# Usage:
#   ./static/generate-manifests.sh
#   cd static && ./generate-manifests.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOURCES_DIR="${SCRIPT_DIR}/resources"
LIB_DIR="${SCRIPT_DIR}/lib"

# shellcheck source=lib/generate-manifests-lib.sh
source "${LIB_DIR}/generate-manifests-lib.sh"

echo "Generating manifests for EDA releases..."

if ! check_generate_prerequisites; then
  exit 1
fi

cd "$SCRIPT_DIR"
generate_all_manifests
print_manifest_summary
