"""Prepare local tooth crops and simulated radiographs with known camera geometry."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates

from geometry import DEFAULT_ANGLES, FDI, VIEW_NAMES, render_views, tooth_frame, view_matrix, volume_grid

EXTENSIONS = (".nii.gz", ".mha", ".nii")


def scan_files(directory, image=False):
    found = {}
    for path in sorted(directory.iterdir()):
        for extension in EXTENSIONS:
            if path.name.endswith(extension):
                key = path.name[:-len(extension)]
                if image:
                    if not key.endswith("_0000"):
                        continue
                    key = key[:-5]
                if key in found:
                    raise ValueError(f"Duplicate volume for {key}")
                found[key] = path
                break
    return found


def split_groups(groups):
    ranked = sorted(set(groups), key=lambda group: hashlib.sha256(
        f"procad-v1:{group}".encode()).hexdigest())
    if len(ranked) < 3:
        raise ValueError("Need at least three independent groups for train, validation and test")
    held_out = max(1, len(ranked) // 5)
    return {group: "test" if i < held_out else "validation" if i < 2 * held_out else "train"
            for i, group in enumerate(ranked)}


def samples_from_case(image_path, label_path, allowed, grid):
    import SimpleITK as sitk

    image = sitk.DICOMOrient(sitk.ReadImage(str(image_path)), "LPS")
    labels = sitk.DICOMOrient(sitk.ReadImage(str(label_path)), "LPS")
    if image.GetDimension() != 3 or not image.IsSameImageGeometryAs(labels, 1e-4, 1e-5):
        raise ValueError("Image and segmentation do not share a 3D physical grid")
    label_array = sitk.GetArrayViewFromImage(labels)
    if not np.issubdtype(label_array.dtype, np.integer):
        raise ValueError("Expected integer class IDs")
    image_array = sitk.GetArrayViewFromImage(image)
    counts = np.bincount(label_array.ravel(), minlength=max(FDI) + 1)
    present = [fdi for fdi in allowed if counts[fdi] >= 30]
    if not present:
        return
    from scipy.ndimage import center_of_mass, find_objects

    centers_zyx = center_of_mass(label_array, label_array, present)
    boxes = find_objects(label_array, max_label=max(FDI))
    direction = np.array(image.GetDirection()).reshape(3, 3)
    spacing = np.array(image.GetSpacing())
    origin = np.array(image.GetOrigin())
    centers = {fdi: origin + direction @ (np.array(zyx[::-1]) * spacing)
               for fdi, zyx in zip(present, centers_zyx, strict=True)}
    shape = np.array(label_array.shape)
    for fdi in present:
        bounds = boxes[fdi - 1]
        if any(part.start <= 1 or part.stop >= dim - 1
               for part, dim in zip(bounds, shape, strict=True)):
            continue
        if not np.isfinite(centers[fdi]).all():
            continue
        crown = np.array([0.0, 0.0, -1.0 if fdi < 30 else 1.0])
        try:
            axes = tooth_frame(centers, fdi, crown, np.array([0.0, -1.0, 0.0]))
        except ValueError:
            continue
        world = grid @ axes.T + centers[fdi]
        positions = (((world - origin) @ direction) / spacing)[..., ::-1]
        coords = np.moveaxis(positions, -1, 0)
        mask = map_coordinates(label_array, coords, order=0, mode="constant", cval=0) == fdi
        if mask.sum() < 10 or any(
            np.take(mask, [0, -1], axis=axis).any() for axis in range(3)
        ):
            continue
        hu = map_coordinates(image_array, coords, order=1, mode="constant",
                             cval=-1000, output=np.float32)
        if not np.isfinite(hu).all():
            continue
        # Approximate relative attenuation. CBCT gray levels and simulator
        # intensities have no device-specific calibration here.
        attenuation = np.clip(1 + hu / 1000, 0, 4)
        yield fdi, attenuation, mask


def synthetic_samples(grid, count, seed):
    rng = np.random.default_rng(seed)
    cases = [f"synthetic-{index:03d}" for index in range(count)]
    split = split_groups(cases)
    for index, key in enumerate(cases):
        fdi = FDI[index % len(FDI)]
        tooth_type = fdi % 10
        x, y, z = np.moveaxis(grid, -1, 0)
        x = x - rng.uniform(-1.5, 1.5)
        y = y - rng.uniform(-1.5, 1.5)
        z = z - rng.uniform(-2, 2)
        width = (3.3 if tooth_type < 4 else 4.8 if tooth_type < 6 else 5.6)
        width *= rng.uniform(0.85, 1.15)
        crown = (x / width) ** 2 + (y / (0.85 * width)) ** 2 + ((z - 3) / 5.3) ** 2 < 1
        roots = np.zeros_like(crown)
        n_roots = 1 if tooth_type < 4 else 2 if tooth_type < 6 else 3
        for root_index in range(n_roots):
            angle = root_index * 2 * np.pi / n_roots
            shift = (z - 1).clip(-10, 0) / -10 * (n_roots > 1) * 3.1
            root_x = x - shift * np.cos(angle) - 0.09 * z
            root_y = y - shift * np.sin(angle)
            root = (root_x / 2.15) ** 2 + (root_y / 1.8) ** 2 + ((z + 4.5) / 7.4) ** 2 < 1
            roots |= root
        mask = crown | roots
        background = gaussian_filter(rng.gamma(0.75, 0.4, mask.shape).astype(np.float32), 1)
        attenuation = background + mask * rng.uniform(1.8, 2.6)
        yield key, split[key], fdi, attenuation.astype(np.float32), mask


def dataset_samples(dataset, grid, groups_path):
    metadata = json.loads((dataset / "dataset.json").read_text())
    mapping = metadata["labels"]
    declared = set(mapping.values()) if all(isinstance(value, int) for value in mapping.values()) else set()
    allowed = [fdi for fdi in FDI if fdi in declared]
    if len(allowed) != len(FDI):
        raise ValueError("Expected the published ToothFairy2 permanent FDI label mapping")
    images = scan_files(dataset / "imagesTr", image=True)
    labels = scan_files(dataset / "labelsTr")
    if not images or images.keys() != labels.keys():
        raise ValueError("Expected one matching image and label per case")
    groups = json.loads(groups_path.read_text()) if groups_path else {key: key for key in images}
    if groups.keys() != images.keys() or not all(isinstance(value, str) and value for value in groups.values()):
        raise ValueError("Group mapping must assign each case to a nonempty pseudonymous group")
    split = split_groups(groups.values())
    for key in images:
        split_name = split[groups[key]]
        print(f"Preparing next {split_name} case", flush=True)
        for fdi, attenuation, mask in samples_from_case(images[key], labels[key], allowed, grid):
            yield key, split_name, fdi, attenuation, mask


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--toothfairy2", type=Path)
    source.add_argument("--synthetic", type=int, metavar="CASES")
    parser.add_argument("--patient-groups", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--size", type=int, default=32)
    parser.add_argument("--pixels", type=int, default=64)
    parser.add_argument("--field-mm", type=float, default=36)
    parser.add_argument("--shift-deg", type=float, default=DEFAULT_ANGLES[0])
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()
    if not (16 <= args.size <= 96 and args.size % 4 == 0 and 16 <= args.pixels <= 256
            and 10 <= args.shift_deg <= 45 and 26 <= args.field_mm <= 70):
        parser.error("Expected bounded grid, detector, field size and angle")
    if args.synthetic is not None and (args.synthetic < 3 or args.patient_groups):
        parser.error("Expected at least 3 synthetic cases and no patient group map")

    angles = (args.shift_deg, 0.0, -args.shift_deg)
    matrices = np.stack([view_matrix(angle, args.pixels, args.field_mm) for angle in angles])
    grid = volume_grid(args.size, args.field_mm)
    samples = (dataset_samples(args.toothfairy2, grid, args.patient_groups) if args.toothfairy2
               else synthetic_samples(grid, args.synthetic, args.seed))
    args.output.mkdir(parents=True, exist_ok=False)
    index = []
    for idx, (_, split, fdi, attenuation, mask) in enumerate(samples):
        path = f"{idx:05d}.npz"
        images = render_views(attenuation, matrices, args.pixels, args.field_mm)
        np.savez_compressed(args.output / path, images=images, mask=mask)
        index.append({"file": path, "split": split, "fdi": fdi})
    if {entry["split"] for entry in index} != {"train", "validation", "test"}:
        raise ValueError("At least one usable tooth is required in each split")
    manifest = {
        "dataset": "ToothFairy2" if args.toothfairy2 else "procedural smoke test",
        "grouping": "supplied patient groups" if args.patient_groups else "case identifiers",
        "size": args.size, "pixels": args.pixels, "field_mm": args.field_mm,
        "views": dict(zip(VIEW_NAMES, matrices.tolist(), strict=True)),
        "angles_deg": angles, "entries": index,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Prepared {len(index)} tooth crops", flush=True)


if __name__ == "__main__":
    main()
