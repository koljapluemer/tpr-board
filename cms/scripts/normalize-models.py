#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELS_DIR = REPO_ROOT / "public" / "models"


@dataclass(slots=True)
class NormalizationResult:
    path: Path
    old_bounds: np.ndarray
    new_bounds: np.ndarray
    scale: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Normalize GLB models into a unit bounding box, preserving aspect ratio, "
            "centering on X/Z, and placing the model floor on Y=0."
        )
    )
    parser.add_argument(
        "targets",
        nargs="*",
        help=(
            "GLB files or directories to process. Defaults to public/models when omitted."
        ),
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Rewrite files in place. Without this flag the script only prints what it would do.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print bounds before and after normalization for every file.",
    )
    return parser.parse_args()


def resolve_targets(raw_targets: list[str]) -> list[Path]:
    if not raw_targets:
        return [DEFAULT_MODELS_DIR]

    resolved: list[Path] = []

    for raw_target in raw_targets:
        target = Path(raw_target)

        if target.is_absolute():
            resolved.append(target)
            continue

        cwd_target = (Path.cwd() / target).resolve()

        if cwd_target.exists():
            resolved.append(cwd_target)
            continue

        resolved.append((REPO_ROOT / target).resolve())

    return resolved


def iter_glb_paths(targets: list[Path]) -> list[Path]:
    glb_paths: set[Path] = set()

    for target in targets:
        if not target.exists():
            raise FileNotFoundError(f"Target does not exist: {target}")

        if target.is_dir():
            glb_paths.update(path.resolve() for path in target.rglob("*.glb"))
            continue

        if target.is_file() and target.suffix.lower() == ".glb":
            glb_paths.add(target.resolve())
            continue

        raise ValueError(f"Target is not a .glb file or directory: {target}")

    return sorted(glb_paths)


def load_scene(path: Path) -> trimesh.Scene:
    loaded = trimesh.load(path, force="scene")

    if isinstance(loaded, trimesh.Scene):
        return loaded

    if isinstance(loaded, trimesh.Trimesh):
        return trimesh.Scene(loaded)

    raise TypeError(f"Unsupported trimesh type for {path}: {type(loaded)!r}")


def normalize_scene(scene: trimesh.Scene) -> tuple[np.ndarray, np.ndarray, float]:
    bounds = np.asarray(scene.bounds, dtype=float)

    if bounds.shape != (2, 3):
        raise ValueError("Scene bounds are not valid")

    extents = bounds[1] - bounds[0]
    max_extent = float(np.max(extents))

    if not np.isfinite(max_extent) or max_extent <= 0:
        raise ValueError("Scene has no measurable extent")

    center_x = float((bounds[0][0] + bounds[1][0]) / 2.0)
    min_y = float(bounds[0][1])
    center_z = float((bounds[0][2] + bounds[1][2]) / 2.0)

    scene.apply_translation([-center_x, -min_y, -center_z])

    scale = 1.0 / max_extent
    scene.apply_scale(scale)

    normalized_bounds = np.asarray(scene.bounds, dtype=float)
    return bounds, normalized_bounds, scale


def export_scene(path: Path, scene: trimesh.Scene) -> None:
    exported = scene.export(file_type="glb")

    if not isinstance(exported, bytes):
        raise TypeError(f"Expected GLB bytes when exporting {path}")

    with tempfile.NamedTemporaryFile(
        mode="wb",
        delete=False,
        dir=path.parent,
        prefix=f"{path.stem}.",
        suffix=path.suffix,
    ) as temporary_file:
        temporary_file.write(exported)
        temp_path = Path(temporary_file.name)

    temp_path.replace(path)


def format_vector(vector: np.ndarray) -> str:
    return f"({vector[0]:.4f}, {vector[1]:.4f}, {vector[2]:.4f})"


def display_path(path: Path) -> Path:
    return path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path


def print_result(result: NormalizationResult, *, verbose: bool) -> None:
    old_size = result.old_bounds[1] - result.old_bounds[0]
    new_size = result.new_bounds[1] - result.new_bounds[0]

    summary = (
        f"{display_path(result.path)}: scale={result.scale:.6f} "
        f"size {format_vector(old_size)} -> {format_vector(new_size)}"
    )

    print(summary)

    if not verbose:
        return

    print(f"  old bounds: {format_vector(result.old_bounds[0])} -> {format_vector(result.old_bounds[1])}")
    print(f"  new bounds: {format_vector(result.new_bounds[0])} -> {format_vector(result.new_bounds[1])}")


def main() -> int:
    args = parse_args()

    try:
        glb_paths = iter_glb_paths(resolve_targets(args.targets))
    except (FileNotFoundError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    if not glb_paths:
        print("No .glb files found.")
        return 0

    mode = "Writing" if args.write else "Dry run for"
    print(f"{mode} {len(glb_paths)} file(s).")

    failures = 0

    for path in glb_paths:
        try:
            scene = load_scene(path)
            old_bounds, new_bounds, scale = normalize_scene(scene)

            if args.write:
                export_scene(path, scene)

            print_result(
                NormalizationResult(
                    path=path,
                    old_bounds=old_bounds,
                    new_bounds=new_bounds,
                    scale=scale,
                ),
                verbose=args.verbose,
            )
        except Exception as error:
            failures += 1
            print(f"{display_path(path)}: failed: {error}", file=sys.stderr)

    if failures:
        print(f"Completed with {failures} failure(s).", file=sys.stderr)
        return 1

    print("Completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
