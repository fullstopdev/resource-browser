#!/bin/bash
# Backfill missing CRD folders across patch releases in the same minor line.
#
# When CRDs are fetched from kubectl, only apps installed on the cluster at fetch
# time are captured (e.g. prometheus, gitlab, github, kafka). Sibling patch releases
# in the same train (25.12.1, 25.12.2, 25.12.3) may therefore be missing CRD folders
# that exist in another patch. This script unions CRDs per train and copies any
# missing folder from the highest patch sibling that has it.
#
# Usage (from repo root or static/):
#   ./static/lib/backfill-subrelease-crds.sh [OPTIONS] [RELEASE]
#   ./lib/backfill-subrelease-crds.sh [OPTIONS] [RELEASE]
#
# Arguments:
#   RELEASE    Optional release to limit backfill to its train (e.g. 25.12.2)
#
# Options:
#   --dry-run  Show planned copies without modifying files
#   -h, --help Show this help
#
# Examples:
#   ./static/lib/backfill-subrelease-crds.sh --dry-run
#   ./static/lib/backfill-subrelease-crds.sh --dry-run 25.12.3
#   ./static/lib/backfill-subrelease-crds.sh 26.4.1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOURCES_DIR="${STATIC_DIR}/resources"
PYTHON_SCRIPT="${SCRIPT_DIR}/backfill-subrelease-crds.py"

DRY_RUN=false
SCOPE_RELEASE=""

usage() {
  sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
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
      SCOPE_RELEASE="$1"
      shift
      ;;
  esac
done

if [ $# -gt 0 ]; then
  echo "Error: Unexpected argument(s): $*" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

if [ ! -f "$PYTHON_SCRIPT" ]; then
  echo "Error: Python backfill script not found: $PYTHON_SCRIPT" >&2
  exit 1
fi

if ! command -v python3 &> /dev/null; then
  echo "Error: python3 is required but not installed" >&2
  exit 1
fi

ARGS=("$RESOURCES_DIR")
if [ -n "$SCOPE_RELEASE" ]; then
  ARGS+=("$SCOPE_RELEASE")
fi
if [ "$DRY_RUN" = true ]; then
  ARGS+=("--dry-run")
fi

python3 "$PYTHON_SCRIPT" "${ARGS[@]}"
