#!/bin/bash
# Fetch CRDs from kubectl for a single release folder.
#
# Deprecated: prefer ./static/sync-release.sh for the full pipeline.
# This wrapper remains for fetch-only workflows.
#
# Usage:
#   ./static/get-crds-for-release.sh [OPTIONS] [RELEASE]
#   ./get-crds-for-release.sh [OPTIONS] [RELEASE]
#
# Arguments:
#   RELEASE    Release folder name (default: 25.4.2)
#
# Options:
#   -y, --yes    Skip kubectl connection confirmation prompt
#   -h, --help   Show this help
#
# Examples:
#   ./static/get-crds-for-release.sh 26.4.3
#   ./static/get-crds-for-release.sh -y 26.4.3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"

RELEASE="25.4.2"
SKIP_CONFIRM=false

usage() {
  sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -y|--yes)
      SKIP_CONFIRM=true
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Error: Unknown option: $1" >&2
      echo "" >&2
      usage >&2
      exit 1
      ;;
    *)
      RELEASE="$1"
      shift
      ;;
  esac
done

if [ $# -gt 0 ]; then
  echo "Error: Unexpected argument(s): $*" >&2
  exit 1
fi

# shellcheck source=lib/fetch-crds-for-release.sh
source "${LIB_DIR}/fetch-crds-for-release.sh"

fetch_crds_for_release "$RELEASE" "$SKIP_CONFIRM"

echo ""
echo "Next step: run ./static/sync-release.sh --skip-fetch ${RELEASE}"
echo "          (or ./static/generate-manifests.sh, then npm run generate:release-notes)"
