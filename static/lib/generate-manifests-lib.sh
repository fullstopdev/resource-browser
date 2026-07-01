#!/bin/bash
# Shared manifest generation logic.
# Sourced by sync-release.sh and generate-manifests.sh.
#
# Before manifests are generated, CRD folders are backfilled within each release
# train (major.minor family) so every patch release gets the union of CRDs found
# across its siblings. See lib/backfill-crds-lib.sh for details.

# shellcheck source=lib/backfill-crds-lib.sh
source "${LIB_DIR}/backfill-crds-lib.sh"

check_generate_prerequisites() {
  if [ ! -d "$RESOURCES_DIR" ]; then
    echo "Error: Resources directory not found: $RESOURCES_DIR"
    return 1
  fi

  if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is required but not installed"
    return 1
  fi

  if ! python3 -c "import yaml" 2>/dev/null; then
    echo "Error: PyYAML is required. Install with: pip3 install pyyaml"
    return 1
  fi

  return 0
}

generate_manifests_only() {
  python3 << 'PYTHON_SCRIPT'
import json
import re
import yaml
from functools import cmp_to_key
from pathlib import Path

KIND_FROM_DESCRIPTION = re.compile(r'^([A-Za-z][A-Za-z0-9]+) is the Schema\b')
KIND_FROM_SPEC_SUFFIX = re.compile(r'^([A-Z][A-Za-z0-9]*)Spec defines\b')
KIND_FROM_SPEC_PLAIN = re.compile(r'^([A-Z][A-Za-z0-9]+) defines\b')
KIND_FROM_SPEC_STATE_OF = re.compile(
    r'^[Ss]pec defines the desired state of (?:the )?([A-Z][A-Za-z0-9]+)\b'
)

def infer_kind_from_crd_name(crd_name: str) -> str:
    short = crd_name.split('.')[0] if crd_name else crd_name
    if short.endswith('states') and len(short) > 6:
        short = f"{short[:-6]}state"
    elif short.endswith('s') and len(short) > 1 and not short.endswith('ss'):
        short = short[:-1]
    return short[:1].upper() + short[1:] if short else short

def infer_kind_from_spec_description(spec_description: str) -> str:
    text = spec_description.strip()
    match = KIND_FROM_SPEC_SUFFIX.match(text)
    if match:
        spec_kind = match.group(1)
        if spec_kind.endswith('Spec'):
            return spec_kind[:-4]
        return spec_kind
    match = KIND_FROM_SPEC_STATE_OF.match(text)
    if match:
        return match.group(1)
    match = KIND_FROM_SPEC_PLAIN.match(text)
    if match and match.group(1) != 'Spec':
        return match.group(1)
    return ''

def infer_kind_from_yaml(crd_dir: Path) -> str:
    for yaml_file in sorted(crd_dir.glob('*.yaml')):
        try:
            with open(yaml_file, 'r') as yf:
                parsed = yaml.safe_load(yf)
            if not isinstance(parsed, dict):
                continue
            schema = parsed.get('schema', {}).get('openAPIV3Schema', {})
            if not isinstance(schema, dict):
                continue

            top_level_kind = ''
            description = schema.get('description', '')
            if isinstance(description, str):
                match = KIND_FROM_DESCRIPTION.match(description.strip())
                if match:
                    top_level_kind = match.group(1)

            spec_description = (
                schema.get('properties', {})
                .get('spec', {})
                .get('description', '')
            )
            spec_kind = (
                infer_kind_from_spec_description(spec_description)
                if isinstance(spec_description, str)
                else ''
            )

            if spec_kind and top_level_kind and spec_kind != top_level_kind:
                return spec_kind
            if top_level_kind:
                return top_level_kind
            if spec_kind:
                return spec_kind
        except Exception:
            continue
    return infer_kind_from_crd_name(crd_dir.name)

# Load the master resources.yaml for metadata
resources_yaml_path = Path("../src/lib/resources.yaml")
with open(resources_yaml_path, 'r') as f:
    resources_metadata = yaml.safe_load(f)

# Build a lookup dict for CRD metadata
crd_lookup = {}
for group, crds in resources_metadata.items():
    for crd in crds:
        crd_lookup[crd['name']] = crd

def parse_release_version(version):
    parts = []
    for part in version.split('.'):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return parts

def compare_release_desc(a, b):
    pa = parse_release_version(a)
    pb = parse_release_version(b)
    length = max(len(pa), len(pb))
    for i in range(length):
        diff = (pb[i] if i < len(pb) else 0) - (pa[i] if i < len(pa) else 0)
        if diff != 0:
            return diff
    return 0

def write_releases_yaml(release_names, output_path):
    sorted_names = sorted(release_names, key=cmp_to_key(compare_release_desc))
    lines = [
        '# EDA Release Configuration',
        '# This file defines available EDA releases',
        'releases:',
    ]
    for index, name in enumerate(sorted_names):
        lines.append(f"  - name: '{name}'")
        lines.append(f"    label: 'EDA {name}'")
        lines.append(f"    folder: 'resources/{name}'")
        if index == 0:
            lines.append('    default: true  ')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print(f"\n✓ Updated {output_path} ({len(sorted_names)} releases, latest: {sorted_names[0]})")

resources_dir = Path("resources")
discovered_releases = []

for release_dir in sorted(resources_dir.iterdir()):
    if not release_dir.is_dir():
        continue

    release_name = release_dir.name
    discovered_releases.append(release_name)
    print(f"Processing release: {release_name}")

    manifest = []
    count = 0

    for crd_dir in sorted(release_dir.iterdir()):
        if not crd_dir.is_dir():
            continue

        crd_name = crd_dir.name

        # Get metadata from resources.yaml if available
        crd_meta = crd_lookup.get(crd_name, {})
        group = crd_meta.get('group', ".".join(crd_name.split(".")[1:]))
        kind = crd_meta.get('kind', '')
        if not kind:
            kind = infer_kind_from_yaml(crd_dir)

        # List all versions that actually exist in this release
        versions = []
        yaml_files = sorted(crd_dir.glob("*.yaml"))

        for yaml_file in yaml_files:
            version_name = yaml_file.stem
            version_obj = {"name": version_name}

            # Prefer per-release YAML flag for "deprecated" if present
            try:
                with open(yaml_file, 'r') as yf:
                    parsed = yaml.safe_load(yf)
                    if isinstance(parsed, dict) and parsed.get('deprecated', False):
                        version_obj['deprecated'] = True
            except Exception:
                # If YAML parsing fails, we'll fall back to the global metadata below
                pass

            # Fall back to appVersion from resources.yaml metadata if not present in YAML
            if 'appVersion' not in version_obj and crd_meta and 'versions' in crd_meta:
                for meta_version in crd_meta['versions']:
                    if meta_version.get('name') == version_name:
                        if 'appVersion' in meta_version:
                            version_obj['appVersion'] = meta_version['appVersion']
                        break

            versions.append(version_obj)
            count += 1

        crd_obj = {
            "name": crd_name,
            "group": group,
            "kind": kind,
            "versions": versions
        }
        manifest.append(crd_obj)

    # Write manifest
    manifest_path = release_dir / "manifest.json"
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"  ✓ Generated {manifest_path} ({count} version files, {len(manifest)} CRDs)")

if discovered_releases:
    write_releases_yaml(discovered_releases, Path("../src/lib/releases.yaml"))
else:
    print("\nWarning: No release folders found; releases.yaml was not updated")

print("\n✓ All manifests generated successfully!")
PYTHON_SCRIPT
}

generate_all_manifests() {
  local backfill_scope="${1:-}"
  local dry_run="${2:-false}"

  echo "Backfilling CRDs within release trains..."
  backfill_crds_within_trains "$backfill_scope" "$dry_run"
  print_backfill_summary
  echo ""

  if [ "$dry_run" = true ]; then
    echo "Dry-run: skipping manifest generation"
    return 0
  fi

  generate_manifests_only
}

print_manifest_summary() {
  echo ""
  echo "Manifest files created:"
  find "$RESOURCES_DIR" -name "manifest.json" -type f

  local releases_yaml="${REPO_ROOT}/src/lib/releases.yaml"
  if [ -f "$releases_yaml" ]; then
    echo ""
    echo "Releases configuration:"
    echo "  $releases_yaml"
  fi
}
