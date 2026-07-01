#!/bin/bash
# Shared CRD fetch logic for a single release folder.
# Sourced by sync-release.sh and get-crds-for-release.sh.

fetch_crds_for_release() {
  local release="$1"
  local skip_confirm="${2:-false}"

  local output_dir="${SCRIPT_DIR}/resources/${release}"
  local crd_fetcher_dir
  crd_fetcher_dir="$(realpath "${SCRIPT_DIR}/../tools/crd-fetcher")"

  echo "Extracting CRDs for release: ${release}"
  echo "Output directory: ${output_dir}"
  echo ""
  echo "IMPORTANT: Make sure kubectl is connected to the ${release} cluster!"
  echo ""

  if [ "$skip_confirm" != "true" ]; then
    read -r -p "Press Enter to continue or Ctrl+C to cancel..."
  fi

  if [ -d "$output_dir" ]; then
    echo "Cleaning up existing '$output_dir/' directory..."
    rm -rf "$output_dir"
  fi

  mkdir -p "$output_dir"

  uv --project "${crd_fetcher_dir}" sync --all-groups

  local temp_dir manifests_file
  temp_dir="$(mktemp -d)"
  manifests_file="$(mktemp)"
  kubectl get -n eda-system manifests -o yaml > "$manifests_file" 2>/dev/null \
    || echo "Warning: Could not fetch manifests from eda-system namespace"

  # shellcheck disable=SC2317
  process_crd() {
    local crd_name="$1"
    local crd_output_dir="$2"
    local manifests
    manifests="$(cat "$3" 2>/dev/null || echo '')"

    echo "Processing $crd_name"

    local crd_dir="$crd_output_dir/$crd_name"
    mkdir -p "$crd_dir"

    local crd_yaml
    crd_yaml="$(kubectl get crd "$crd_name" -o yaml)"

    local versions
    versions="$(echo "$crd_yaml" | yq eval '.spec.versions[].name' | xargs)"

    for version in $versions; do
      echo "$crd_yaml" \
        | yq eval ".spec.versions[] | select(.name == \"$version\")" \
        | yq eval -P > "$crd_dir/$version.yaml"
    done
  }
  export -f process_crd

  local crd_names=()
  local crd_name
  while IFS= read -r crd_name; do
    if [[ "$crd_name" == *".eda.nokia.com"* ]]; then
      crd_names+=("$crd_name")
    else
      echo "Skipping non-EDA CRD: $crd_name"
    fi
  done < <(kubectl get crds -o custom-columns=NAME:.metadata.name --no-headers)

  echo ""
  echo "Found ${#crd_names[@]} EDA CRDs to extract"
  echo ""

  printf "%s\n" "${crd_names[@]}" \
    | xargs -P64 -I{} bash -c 'process_crd "$1" "$2" "$3"' _ {} "$output_dir" "$manifests_file"

  rm -rf "$temp_dir" "$manifests_file"

  echo ""
  echo "CRDs saved in $output_dir"
}
