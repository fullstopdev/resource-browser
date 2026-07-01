#!/bin/bash
# Unified EDA release sync pipeline.
#
# Runs, in order:
#   1. Fetch CRDs from kubectl into static/resources/<RELEASE>/
#   2. Backfill missing CRDs within the release train (major.minor siblings)
#   3. Generate manifest.json files and update src/lib/releases.yaml
#   4. Build dependency-graph.json (npm run build:dependency-graph)
#   5. Generate release notes (npm run generate:release-notes)
#
# CRD backfill copies CRD folders from sibling patch releases in the same train
# (e.g. 25.12.1 → 25.12.2) when an app was not installed during kubectl fetch.
# Copied folders contain a .backfilled-from marker with the source release.
#
# Usage (from repo root or static/):
#   ./static/sync-release.sh [OPTIONS] [RELEASE]
#   ./sync-release.sh [OPTIONS] [RELEASE]
#
# Arguments:
#   RELEASE    Release folder name (default: 25.4.2). For --backfill-only, limits
#              backfill to that release's train; omit to backfill all trains.
#
# Options:
#   -y, --yes              Skip kubectl connection confirmation prompt
#   --skip-fetch           Skip CRD fetch (backfill + manifests + release notes)
#   --skip-manifests       Skip manifest generation (fetch + release notes only)
#   --skip-release-notes   Skip release notes generation
#   --skip-dependency-graph  Skip dependency-graph.json generation
#   --backfill-only        Backfill CRDs only (no fetch; manifests unless skipped)
#   --dry-run              Show planned CRD copies without modifying files
#   -h, --help             Show this help
#
# Examples:
#   ./static/sync-release.sh 26.4.3
#   ./static/sync-release.sh -y 26.4.3
#   ./static/sync-release.sh --skip-fetch
#   ./static/sync-release.sh --backfill-only
#   ./static/sync-release.sh --backfill-only 25.12.2
#   ./static/lib/backfill-subrelease-crds.sh --dry-run
#   cd static && ./sync-release.sh --skip-release-notes 25.12.3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOURCES_DIR="${SCRIPT_DIR}/resources"
LIB_DIR="${SCRIPT_DIR}/lib"

RELEASE="25.4.2"
EXPLICIT_RELEASE=false
SKIP_CONFIRM=false
SKIP_FETCH=false
SKIP_MANIFESTS=false
SKIP_RELEASE_NOTES=false
SKIP_DEPENDENCY_GRAPH=false
BACKFILL_ONLY=false
DRY_RUN=false

usage() {
  sed -n '3,35p' "$0" | sed 's/^# \{0,1\}//'
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
    --skip-fetch)
      SKIP_FETCH=true
      shift
      ;;
    --skip-manifests)
      SKIP_MANIFESTS=true
      shift
      ;;
    --skip-release-notes)
      SKIP_RELEASE_NOTES=true
      shift
      ;;
    --skip-dependency-graph)
      SKIP_DEPENDENCY_GRAPH=true
      shift
      ;;
    --backfill-only)
      BACKFILL_ONLY=true
      SKIP_FETCH=true
      shift
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
      RELEASE="$1"
      EXPLICIT_RELEASE=true
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

# shellcheck source=lib/fetch-crds-for-release.sh
source "${LIB_DIR}/fetch-crds-for-release.sh"
# shellcheck source=lib/backfill-crds-lib.sh
source "${LIB_DIR}/backfill-crds-lib.sh"
# shellcheck source=lib/generate-manifests-lib.sh
source "${LIB_DIR}/generate-manifests-lib.sh"

BACKFILL_SCOPE=""
if [ "$BACKFILL_ONLY" = true ] && [ "$EXPLICIT_RELEASE" = true ]; then
  BACKFILL_SCOPE="$RELEASE"
fi

build_dependency_graph() {
  local release="$1"
  echo "== Build dependency graph for ${release} =="
  cd "$REPO_ROOT"
  RELEASE="$release" npm run build:dependency-graph
}

echo "EDA release sync"
echo "  Release: ${RELEASE}"
echo "  Repo root: ${REPO_ROOT}"
echo ""

if [ "$BACKFILL_ONLY" = true ]; then
  echo "== Backfill CRDs within release trains =="
  if [ ! -d "$RESOURCES_DIR" ]; then
    echo "Error: Resources directory not found: $RESOURCES_DIR" >&2
    exit 1
  fi
  backfill_crds_within_trains "$BACKFILL_SCOPE" "$DRY_RUN"
  print_backfill_summary
  echo ""

  if [ "$SKIP_MANIFESTS" = false ] && [ "$DRY_RUN" = false ]; then
    echo "== Generate manifests =="
    if ! check_generate_prerequisites; then
      exit 1
    fi
    cd "$SCRIPT_DIR"
    generate_manifests_only
    print_manifest_summary
    echo ""
  elif [ "$SKIP_MANIFESTS" = false ] && [ "$DRY_RUN" = true ]; then
    echo "Dry-run: skipping manifest generation"
    echo ""
  fi

  if [ "$SKIP_DEPENDENCY_GRAPH" = false ] && [ "$DRY_RUN" = false ] && [ "$EXPLICIT_RELEASE" = true ]; then
    build_dependency_graph "$RELEASE"
    echo ""
  fi

  echo "CRD backfill complete."
  exit 0
fi

if [ "$SKIP_FETCH" = false ]; then
  echo "== Step 1/4: Fetch CRDs =="
  fetch_crds_for_release "$RELEASE" "$SKIP_CONFIRM"
  echo ""
else
  echo "== Step 1/4: Fetch CRDs (skipped) =="
  echo ""
fi

if [ "$SKIP_MANIFESTS" = false ]; then
  echo "== Step 2/4: Backfill + generate manifests =="
  if ! check_generate_prerequisites; then
    exit 1
  fi
  cd "$SCRIPT_DIR"
  if [ "$DRY_RUN" = true ]; then
    backfill_crds_within_trains "" "$DRY_RUN"
    print_backfill_summary
    echo ""
    echo "Dry-run: skipping manifest generation"
  else
    generate_all_manifests
    print_manifest_summary
  fi
  echo ""
else
  echo "== Step 2/4: Backfill + generate manifests (skipped) =="
  echo ""
fi

if [ "$SKIP_DEPENDENCY_GRAPH" = false ] && [ "$DRY_RUN" = false ]; then
  echo "== Step 3/4: Build dependency graph =="
  build_dependency_graph "$RELEASE"
  echo ""
elif [ "$SKIP_DEPENDENCY_GRAPH" = false ] && [ "$DRY_RUN" = true ]; then
  echo "== Step 3/4: Build dependency graph (dry-run: skipped) =="
  echo ""
else
  echo "== Step 3/4: Build dependency graph (skipped) =="
  echo ""
fi

if [ "$SKIP_RELEASE_NOTES" = false ]; then
  echo "== Step 4/4: Generate release notes =="
  cd "$REPO_ROOT"
  npm run generate:release-notes
  echo ""
else
  echo "== Step 4/4: Generate release notes (skipped) =="
  echo ""
fi

echo "Release sync complete for ${RELEASE}."
