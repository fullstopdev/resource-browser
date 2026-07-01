#!/usr/bin/env python3
"""Backfill missing CRD folders across patch releases in the same minor line.

When CRDs are fetched from kubectl, only apps installed on the cluster at fetch
time are captured. Sibling patch releases (e.g. 25.12.1 vs 25.12.3) may therefore
have different CRD sets even though the train ships the same catalog.

Rule: within each major.minor train, union CRD folders across patches and copy any
folder present in a sibling but missing locally (cp -r). Never copy across trains.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

RELEASE_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
CRD_SUFFIX = ".eda.nokia.com"
MARKER_FILE = ".backfilled-from"
KNOWN_APPS = frozenset({"prom", "github", "gitlab", "kafka"})


def parse_version(version: str) -> tuple[int, ...]:
    parts: list[int] = []
    for part in version.split("."):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def release_train(version: str) -> str:
    parts = version.split(".")
    if len(parts) >= 2:
        return f"{parts[0]}.{parts[1]}"
    return version


def crd_app_name(crd_name: str) -> str:
    parts = crd_name.split(".")
    if len(parts) >= 2:
        return parts[1]
    return crd_name


def log_label(crd_name: str) -> str:
    """Human-readable label for log lines (e.g. prom, github/githubinstances)."""
    app = crd_app_name(crd_name)
    resource = crd_name.split(".", 1)[0]
    if app == "prom":
        return "prom"
    if app in KNOWN_APPS:
        return f"{app}/{resource}"
    return crd_name


def is_crd_dir(path: Path) -> bool:
    if not path.is_dir() or not path.name.endswith(CRD_SUFFIX):
        return False
    return any(path.glob("*.yaml"))


def list_crds(release_dir: Path) -> set[str]:
    return {entry.name for entry in release_dir.iterdir() if is_crd_dir(entry)}


def discover_releases(resources_dir: Path) -> list[str]:
    releases = [
        entry.name
        for entry in resources_dir.iterdir()
        if entry.is_dir() and RELEASE_PATTERN.match(entry.name)
    ]
    return sorted(releases, key=parse_version, reverse=True)


def pick_source_release(
    siblings: list[str],
    crds_by_release: dict[str, set[str]],
    crd_name: str,
) -> str | None:
    candidates = [release for release in siblings if crd_name in crds_by_release[release]]
    if not candidates:
        return None
    return max(candidates, key=parse_version)


def copy_crd_folder(
    resources_dir: Path,
    target_release: str,
    source_release: str,
    crd_name: str,
    *,
    dry_run: bool,
) -> None:
    source_dir = resources_dir / source_release / crd_name
    target_dir = resources_dir / target_release / crd_name
    label = log_label(crd_name)
    verb = "Would copy" if dry_run else "Copying"

    print(f"{verb} {label} from {source_release} → {target_release} (missing)")

    if dry_run:
        return

    if target_dir.exists():
        shutil.rmtree(target_dir)

    shutil.copytree(source_dir, target_dir)
    (target_dir / MARKER_FILE).write_text(f"{source_release}\n", encoding="utf-8")


def backfill_train(
    resources_dir: Path,
    train: str,
    siblings: list[str],
    *,
    dry_run: bool,
) -> int:
    siblings = sorted(siblings, key=parse_version)
    crds_by_release = {
        release: list_crds(resources_dir / release)
        for release in siblings
    }
    union_crds = set().union(*crds_by_release.values())
    copied = 0

    print(f"Train {train}.x ({', '.join(siblings)}): union has {len(union_crds)} CRDs")

    for release in siblings:
        missing = sorted(union_crds - crds_by_release[release])
        if not missing:
            print(f"  {release}: complete ({len(crds_by_release[release])} CRDs)")
            continue

        print(f"  {release}: backfilling {len(missing)} CRD(s)")

        for crd_name in missing:
            source_release = pick_source_release(siblings, crds_by_release, crd_name)
            if not source_release:
                print(
                    f"    ! skipped {crd_name}: no sibling source found",
                    file=sys.stderr,
                )
                continue

            copy_crd_folder(
                resources_dir,
                release,
                source_release,
                crd_name,
                dry_run=dry_run,
            )
            if not dry_run:
                crds_by_release[release].add(crd_name)
            copied += 1

    return copied


def run_backfill(
    resources_dir: Path,
    scope_release: str = "",
    *,
    dry_run: bool = False,
) -> int:
    if not resources_dir.is_dir():
        print(f"Error: Resources directory not found: {resources_dir}", file=sys.stderr)
        return 1

    releases = discover_releases(resources_dir)
    if not releases:
        print("No release folders found; nothing to backfill.")
        return 0

    trains: dict[str, list[str]] = defaultdict(list)
    for release in releases:
        trains[release_train(release)].append(release)

    if scope_release:
        if scope_release not in releases:
            print(f"Error: Release not found: {scope_release}", file=sys.stderr)
            return 1
        target_trains = [release_train(scope_release)]
    else:
        target_trains = sorted(trains.keys(), key=parse_version, reverse=True)

    mode = " (dry-run)" if dry_run else ""
    print(f"Backfilling CRDs within release trains{mode}...")

    total_copied = 0
    for train in target_trains:
        siblings = trains.get(train, [])
        if len(siblings) < 2:
            print(f"Train {train}.x: single release, skipping")
            continue
        total_copied += backfill_train(
            resources_dir,
            train,
            siblings,
            dry_run=dry_run,
        )

    if total_copied:
        if dry_run:
            print(f"\n✓ Would backfill {total_copied} CRD folder(s)")
        else:
            print(f"\n✓ Backfilled {total_copied} CRD folder(s)")
    else:
        print("\n✓ No CRD backfill needed")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Copy missing CRD folders from sibling patch releases within the "
            "same major.minor train."
        ),
    )
    parser.add_argument(
        "resources_dir",
        nargs="?",
        default="resources",
        help="Path to static/resources (default: resources)",
    )
    parser.add_argument(
        "scope_release",
        nargs="?",
        default="",
        help="Optional release to limit backfill to its train (e.g. 25.12.2)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be copied without modifying files",
    )
    args = parser.parse_args()

    resources_dir = Path(args.resources_dir).resolve()
    return run_backfill(resources_dir, args.scope_release, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
