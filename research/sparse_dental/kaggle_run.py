"""Run the private ToothFairy2 experiment and stage checkpoint files for review."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent


def extract_archive(archive, destination):
    with ZipFile(archive) as source:
        members = source.infolist()
        if sum(member.file_size for member in members) > shutil.disk_usage(destination).free:
            raise ValueError("The expanded archive exceeds free space in the private workspace")
        seen = set()
        for member in members:
            relative = PurePosixPath(member.filename)
            if (relative.is_absolute() or ".." in relative.parts or "\\" in member.filename
                    or relative in seen or stat.S_ISLNK(member.external_attr >> 16)):
                raise ValueError("Archive contains an unsafe or duplicate entry")
            seen.add(relative)
            target = destination.joinpath(*relative.parts)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(member) as incoming, target.open("xb") as output:
                    shutil.copyfileobj(incoming, output)


def dataset_root(directory):
    candidates = sorted({p.parent for p in directory.rglob("dataset.json")
                         if (p.parent / "imagesTr").is_dir() and (p.parent / "labelsTr").is_dir()})
    if len(candidates) != 1:
        raise ValueError("Expected one nnU-Net dataset directory with imagesTr, labelsTr, and metadata")
    return candidates[0]


def model_card(config, metrics, archive_digest):
    values = metrics["test"] | {"Mean training mask": metrics["mean_training_mask_baseline"]}
    if "ellipsoid_initialization_baseline" in metrics:
        values["Ellipsoid initialization"] = metrics["ellipsoid_initialization_baseline"]
    labels = {"1": "Straight only", "2": "Mesial and distal shifts",
              "3": "Both shifts plus straight"}
    rows = []
    for key, result in values.items():
        distances = [f"{result[name]:.3f}" if result[name] is not None else "—"
                     for name in ("assd_mm", "hd95_mm")]
        rows.append(f"| {labels.get(key, key)} | {result['n_teeth']} | {result['dice']:.3f} "
                    f"| {result['iou']:.3f} | {' | '.join(distances)} | {result['empty_predictions']} |")
    table = "\n".join(rows)
    device = f"Kaggle GPU ({config['gpu']})" if config["gpu"] else "local CPU"
    cases = config.get("case_counts", {})
    case_note = ("Usable crops came from "
                 f"{cases['train']} training, {cases['validation']} validation, "
                 f"and {cases['test']} test scans.") if cases else ""
    return f"""---
license: cc-by-nc-sa-4.0
tags:
- dental-imaging
- 3d-reconstruction
- research
---

# ProCAD sparse-view dental shape estimate

This noncommercial research checkpoint estimates a single tooth's external
occupancy from simulated, calibrated cone-beam projections. Commercial use
is prohibited under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
The outputs represent an estimated external tooth surface. The checkpoint has
no clinical or real-radiograph validation and supplies no CT attenuation map.

The model was trained on {config['split_counts']['train']} tooth crops;
validation used {config['split_counts']['validation']}. Splits used
{config['grouping']}. {case_note} The held-out results below use simulated projections
from the small ToothFairy2 research sample. Distances exclude empty predictions.

| Input | Test teeth | Dice | IoU | ASSD (mm) | HD95 (mm) | Empty |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
{table}

The experiment uses CBCT segmentation labels to localize and orient each
simulation crop. Real projections require independently established geometry
and tooth localization, plus intensity calibration. The model was trained at
a {config['size']}³ voxel grid over {config['field_mm']} mm. Tests on the small
subset may miss tooth classes and do not establish performance on real images.
Coverage by FDI, view geometry, and aggregate metrics accompany the weights.

**Data and changes** ToothFairy2, AImageLab at the University of Modena and
Reggio Emilia and Radboud University. CBCT images were resampled into local
crops and projected through a simulated cone-beam geometry. Tooth labels were
resampled into binary targets. This repository contains only the checkpoint,
configuration and aggregate results. The source dataset and derived
projections are not bundled. Compute: {device}.
Input archive SHA-256: `{archive_digest}`.

[ToothFairy2 dataset](https://ditto.ing.unimore.it/toothfairy2/) ·
[Challenge](https://toothfairy2.grand-challenge.org/dataset/) ·
[ProCAD research code and inference instructions](https://github.com/minagayid/procad/pull/4)

1. Bolelli F, Lumetti L, van Nistelrooij N, et al. Multi-structure segmentation in CBCT volumes: The ToothFairy2 challenge. Medical Image Analysis, 104095. https://doi.org/10.1016/j.media.2026.104095
2. Bolelli F, Marchesini K, van Nistelrooij N, Lumetti L, Pipoli V, Ficarra E, Vinayahalingam S, and Grana C. Segmenting Maxillofacial Structures in CBCT Volumes. IEEE/CVF CVPR, 2025, pp. 5238–5248. https://doi.org/10.1109/CVPR52734.2025.00494
3. Lumetti L, Pipoli V, Bolelli F, Ficarra E, and Grana C. Enhancing Patch-Based Learning for the Segmentation of the Mandibular Canal. IEEE Access, 2024. https://doi.org/10.1109/ACCESS.2024.3408629
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    data = parser.add_mutually_exclusive_group(required=True)
    data.add_argument("--archive", type=Path)
    data.add_argument("--dataset", type=Path)
    parser.add_argument("--source-sha256", help="Original archive digest when the input is already extracted")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--patient-groups", type=Path)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch", type=int, default=4)
    args = parser.parse_args()
    if args.output.exists() or args.epochs < 1 or args.batch < 1:
        parser.error("Use a new output directory and positive training settings")
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("Run in the private Kaggle notebook with a GPU selected")
    if args.archive:
        with args.archive.open("rb") as package:
            digest = hashlib.file_digest(package, "sha256").hexdigest()
        if args.source_sha256 and digest != args.source_sha256:
            raise ValueError("Archive checksum does not match the expected source")
    else:
        digest = args.source_sha256 or ""
        if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
            parser.error("--dataset requires a lowercase source archive SHA-256 digest")
    with tempfile.TemporaryDirectory(prefix="procad-private-") as work_dir:
        work = Path(work_dir)
        if args.archive:
            extract_archive(args.archive, work)
        prepared, checkpoint = work / "prepared", work / "checkpoint"
        source = dataset_root(work if args.archive else args.dataset)
        command = [sys.executable, str(HERE / "prepare.py"), "--toothfairy2", str(source),
                   "--output", str(prepared)]
        if args.patient_groups:
            command += ["--patient-groups", str(args.patient_groups)]
        subprocess.run(command, check=True)
        subprocess.run([sys.executable, str(HERE / "reconstruct.py"), "train",
                        str(prepared), str(checkpoint), "--device", "cuda",
                        "--epochs", str(args.epochs), "--batch", str(args.batch)], check=True)
        config = json.loads((checkpoint / "config.json").read_text())
        metrics = json.loads((checkpoint / "metrics.json").read_text())
        (checkpoint / "README.md").write_text(model_card(config, metrics, digest))
        shutil.copytree(checkpoint, args.output)


if __name__ == "__main__":
    main()
