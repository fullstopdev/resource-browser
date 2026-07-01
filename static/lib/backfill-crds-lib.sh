#!/bin/bash
# Backfill missing CRD folders within a release train (major.minor family).
#
# Sourced by sync-release.sh and generate-manifests-lib.sh. Delegates to
# backfill-subrelease-crds.py. See backfill-subrelease-crds.sh for CLI usage.

backfill_crds_within_trains() {
  local scope_release="${1:-}"
  local dry_run="${2:-false}"

  local python_script="${LIB_DIR}/backfill-subrelease-crds.py"
  if [ ! -f "$python_script" ]; then
    echo "Error: Backfill script not found: $python_script" >&2
    return 1
  fi

  local -a args=("$RESOURCES_DIR")
  if [ -n "$scope_release" ]; then
    args+=("$scope_release")
  fi
  if [ "$dry_run" = true ]; then
    args+=("--dry-run")
  fi

  python3 "$python_script" "${args[@]}"
}

print_backfill_summary() {
  local marker_count
  marker_count="$(find "$RESOURCES_DIR" -name '.backfilled-from' -type f 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$marker_count" -gt 0 ]; then
    echo ""
    echo "Backfilled CRD markers: ${marker_count} (see .backfilled-from in CRD folders)"
  fi
}
