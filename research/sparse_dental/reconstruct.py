"""Train and run a tooth occupancy estimator from calibrated sparse projections."""

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_erosion, distance_transform_edt
import torch
from torch import nn
from torch.nn import functional as F
from safetensors.torch import load_file, save_file

from atlas import surface_regions, write_obj
from geometry import FDI, VIEW_NAMES, VIEW_SETS, backproject, surface_names, validate_views, volume_grid


class ReconstructionNet(nn.Module):
    def __init__(self, size=None, field_mm=None):
        super().__init__()
        self.spatial_prior = size is not None
        self.fdi_embedding = nn.Embedding(len(FDI), 4)
        inputs = 14 if self.spatial_prior else 10
        self.stem = nn.Sequential(nn.Conv3d(inputs, 12, 3, padding=1), nn.GroupNorm(3, 12), nn.SiLU())
        self.down = nn.Sequential(nn.Conv3d(12, 24, 3, stride=2, padding=1),
                                  nn.GroupNorm(6, 24), nn.SiLU(),
                                  nn.Conv3d(24, 24, 3, padding=1), nn.SiLU())
        self.output = nn.Sequential(nn.Conv3d(36, 12, 3, padding=1), nn.SiLU(),
                                    nn.Conv3d(12, 1, 1))
        if self.spatial_prior:
            xyz = torch.from_numpy(volume_grid(size, field_mm)).permute(3, 0, 1, 2)
            self.register_buffer("xyz_mm", xyz, persistent=False)
            self.register_buffer("xyz_unit", xyz / (field_mm / 2), persistent=False)
            # Broad ellipsoids initialize the search around the supplied
            # tooth center. Dimensions are heuristics, not training masks.
            width = torch.tensor([3.1 if fdi % 10 <= 3 else 4.1 if fdi % 10 <= 5 else 5.1
                                  for fdi in FDI])
            radii = torch.stack((width, width * 0.95, torch.full_like(width, 10.5)), dim=1)
            self.register_buffer("radii_mm", radii, persistent=False)
            nn.init.zeros_(self.output[-1].weight)
            nn.init.zeros_(self.output[-1].bias)

    def prior_logits(self, fdi):
        radius = self.radii_mm[fdi, :, None, None, None]
        distance = torch.linalg.vector_norm(self.xyz_mm[None] / radius, dim=1, keepdim=True)
        return 5 * (1 - distance).clamp(min=-3)

    def forward(self, projections, fdi):
        shape = projections.shape[2:]
        identity = self.fdi_embedding(fdi)[:, :, None, None, None].expand(-1, -1, *shape)
        if self.spatial_prior:
            prior = self.prior_logits(fdi)
            positions = self.xyz_unit[None].expand(projections.shape[0], -1, -1, -1, -1)
            features = (projections, identity, positions, prior / 5)
        else:
            prior = 0
            features = (projections, identity)
        full = self.stem(torch.cat(features, dim=1))
        up = F.interpolate(self.down(full), size=shape, mode="trilinear", align_corners=False)
        return self.output(torch.cat((full, up), dim=1)) + prior


def encode(volume, slots):
    size = volume.shape[-1]
    tensor = np.zeros((6, size, size, size), dtype=np.float32)
    for volume_idx, slot in enumerate(slots):
        tensor[slot] = volume[volume_idx]
        tensor[slot + 3] = 1
    return tensor


def normalize(images, field_mm):
    # Fixed scaling keeps intensity differences across views. The input is
    # calibrated or simulated line-integral data with this relative scale.
    return np.clip(images / field_mm, 0, 4)


def load_prepared(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    matrices = np.array([manifest["views"][name] for name in VIEW_NAMES])
    examples = {"train": [], "validation": [], "test": []}
    for entry in manifest.pop("entries"):
        with np.load(directory / entry["file"], allow_pickle=False) as data:
            images, mask = data["images"], data["mask"].astype(np.float32)
        volume = backproject(normalize(images, manifest["field_mm"]), matrices,
                             manifest["size"], manifest["field_mm"])
        examples[entry["split"]].append((volume, mask, FDI.index(entry["fdi"])))
    return manifest, examples


def batch_input(samples, slots, device):
    projections = np.stack([encode(volume[list(selected)], selected)
                            for (volume, _, _), selected in zip(samples, slots, strict=True)])
    labels = np.stack([mask for _, mask, _ in samples])[:, None]
    identities = [fdi for _, _, fdi in samples]
    return (torch.from_numpy(projections).to(device), torch.tensor(identities, device=device),
            torch.from_numpy(labels).to(device))


def metrics(prediction, target, spacing):
    pred, truth = prediction.astype(bool), target.astype(bool)
    overlap = np.count_nonzero(pred & truth)
    result = {"dice": 2 * overlap / (pred.sum() + truth.sum()),
              "iou": overlap / np.count_nonzero(pred | truth), "empty": bool(not pred.any())}
    if result["empty"]:
        return result | {"assd_mm": None, "hd95_mm": None}
    a = pred ^ binary_erosion(pred)
    b = truth ^ binary_erosion(truth)
    ab = distance_transform_edt(~a, sampling=spacing)[b]
    ba = distance_transform_edt(~b, sampling=spacing)[a]
    return result | {"assd_mm": float((ab.mean() + ba.mean()) / 2),
                     "hd95_mm": float(max(np.quantile(ab, 0.95), np.quantile(ba, 0.95)))}


def summary(rows):
    result = {"n_teeth": len(rows), "empty_predictions": sum(item["empty"] for item in rows)}
    for metric in ("dice", "iou", "assd_mm", "hd95_mm"):
        values = [item[metric] for item in rows if item[metric] is not None]
        result[metric] = float(np.mean(values)) if values else None
    return result


@torch.inference_mode()
def evaluate(model, examples, variants, spacing, device, batch):
    model.eval()
    outcomes = {}
    for configuration, slots in variants.items():
        rows = []
        for index in range(0, len(examples), batch):
            current = examples[index:index + batch]
            x, fdi, _ = batch_input(current, [slots] * len(current), device)
            predictions = (model(x, fdi)[:, 0] > 0).cpu().numpy()
            rows.extend((FDI[fdi_idx], metrics(pred, mask, spacing))
                        for pred, (_, mask, fdi_idx) in zip(predictions, current, strict=True))
        outcomes[configuration] = summary([row for _, row in rows]) | {
            "by_fdi": {str(code): summary([row for fdi, row in rows if fdi == code])
                       for code in sorted({fdi for fdi, _ in rows})}}
    return outcomes


def train(args):
    if args.epochs < 1 or args.batch < 1:
        raise ValueError("Expected positive epochs and batch size")
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable")
    if device.type == "cpu":
        torch.set_num_threads(min(torch.get_num_threads(), 4))
    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    manifest, examples = load_prepared(args.prepared)
    args.output.mkdir(parents=True, exist_ok=False)
    model = ReconstructionNet(manifest["size"], manifest["field_mm"]).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    spacing = manifest["field_mm"] / manifest["size"]
    views = list(VIEW_SETS.values())
    fraction = np.mean([mask.mean() for _, mask, _ in examples["train"]])
    positive_weight = torch.tensor(float(np.clip(np.sqrt((1 - fraction) / fraction), 1, 8)), device=device)
    best_score = -1
    for epoch in range(args.epochs):
        model.train()
        permutation = rng.permutation(len(examples["train"]))
        for index in range(0, len(permutation), args.batch):
            current = [examples["train"][i] for i in permutation[index:index + args.batch]]
            slots = [views[i] for i in rng.integers(0, len(views), size=len(current))]
            x, fdi, mask = batch_input(current, slots, device)
            logits = model(x, fdi)
            prob = logits.sigmoid()
            axes = (1, 2, 3, 4)
            dice = (2 * (prob * mask).sum(axes) + 1) / (prob.sum(axes) + mask.sum(axes) + 1)
            bce = F.binary_cross_entropy_with_logits(logits, mask, pos_weight=positive_weight)
            loss = bce + 1 - dice.mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
        val = evaluate(model, examples["validation"], VIEW_SETS, spacing, device, args.batch)
        score = float(np.mean([row["dice"] for row in val.values()]))
        print(f"epoch {epoch + 1}/{args.epochs}; validation mean Dice {score:.4f}", flush=True)
        if score > best_score:
            best_score = score
            best_epoch = epoch + 1
            save_file({name: tensor.detach().cpu().contiguous()
                       for name, tensor in model.state_dict().items()}, args.output / "model.safetensors")

    model.load_state_dict(load_file(args.output / "model.safetensors"))
    results = evaluate(model, examples["test"], VIEW_SETS, spacing, device, args.batch)
    global_average = np.mean([mask for _, mask, _ in examples["train"]], axis=0)
    mean_masks = {}
    for idx in {fdi for _, _, fdi in examples["train"]}:
        mean_masks[idx] = np.mean([mask for _, mask, fdi in examples["train"] if fdi == idx], axis=0)
    baseline = summary([metrics(mean_masks.get(idx, global_average) >= 0.5, mask, spacing)
                        for _, mask, idx in examples["test"]])
    prior = (model.prior_logits(torch.arange(len(FDI), device=device))[:, 0] > 0).cpu().numpy()
    prior_results = summary([metrics(prior[idx], mask, spacing)
                             for _, mask, idx in examples["test"]])
    manifest |= {"device": str(device), "gpu": torch.cuda.get_device_name(device)
                 if device.type == "cuda" else None, "seed": args.seed,
                 "pytorch_version": str(torch.__version__),
                 "model_version": 2,
                 "epochs": args.epochs, "best_epoch": best_epoch,
                 "split_counts": {key: len(value) for key, value in examples.items()},
                 "fdi_counts": {key: {str(FDI[idx]): sum(fdi == idx for _, _, fdi in value)
                                     for idx in sorted({entry[2] for entry in value})}
                                for key, value in examples.items()}}
    report = {"test": results, "mean_training_mask_baseline": baseline,
              "ellipsoid_initialization_baseline": prior_results,
              "best_validation_mean_dice": best_score}
    (args.output / "config.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (args.output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)


@torch.inference_mode()
def infer(args):
    from skimage.measure import marching_cubes

    config = json.loads((args.checkpoint / "config.json").read_text())
    job = json.loads(args.job.read_text())
    views = job["views"]
    validate_views(views, minimum=2)
    selected = [name for name in VIEW_NAMES if name in views]
    slots = [VIEW_NAMES.index(name) for name in selected]
    if tuple(slots) not in VIEW_SETS.values():
        raise ValueError("Use the paired shifts, or both shifts plus the straight view")
    images = np.stack([np.load(args.job.parent / views[name]["image"], allow_pickle=False)
                       for name in selected]).astype(np.float32)
    if images.shape != (len(selected), config["pixels"], config["pixels"]) or not (
        np.isfinite(images).all() and (images >= 0).all()
    ):
        raise ValueError("Expected finite nonnegative calibrated line-integral arrays at detector resolution")
    matrices = np.array([views[name]["matrix"] for name in selected])
    volume = backproject(normalize(images, config["field_mm"]), matrices,
                         config["size"], config["field_mm"])
    geometry = (config["size"], config["field_mm"]) if config.get("model_version") == 2 else ()
    model = ReconstructionNet(*geometry).eval()
    model.load_state_dict(load_file(args.checkpoint / "model.safetensors"))
    fdi = int(job["fdi"])
    if str(fdi) not in config["fdi_counts"]["train"]:
        raise ValueError("This tooth was absent from checkpoint training")
    data = torch.from_numpy(encode(volume, slots))[None]
    probability = model(data, torch.tensor([FDI.index(fdi)]))[0, 0].sigmoid().numpy()
    spacing = config["field_mm"] / config["size"]
    args.output.mkdir(parents=True, exist_ok=False)
    np.save(args.output / "occupancy_probability_zyx.npy", probability, allow_pickle=False)
    result = {"fdi": fdi, "axes": ["mesial", "facial", "coronal"], "voxel_mm": spacing,
              "training_dataset": config["dataset"], "view_names": selected,
              "mesh": None, "clinical_validation": "not evaluated"}
    if (probability > 0.5).any():
        padded = np.pad(probability, 1)
        vertices, triangles, _, _ = marching_cubes(padded, level=0.5, spacing=(spacing,) * 3,
                                                 gradient_direction="ascent",
                                                 allow_degenerate=False)
        vertices = vertices[:, ::-1] - config["field_mm"] / 2 - spacing / 2
        triangles = triangles[:, ::-1].copy()
        regions, _ = surface_regions(vertices, triangles)
        result["mesh"] = f"{fdi}.obj"
        write_obj(args.output / result["mesh"], vertices, triangles,
                  {"names": surface_names(fdi), "indices": regions})
    (args.output / "result.json").write_text(json.dumps(result, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    training = sub.add_parser("train")
    training.add_argument("prepared", type=Path)
    training.add_argument("output", type=Path)
    training.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    training.add_argument("--epochs", type=int, default=20)
    training.add_argument("--batch", type=int, default=4)
    training.add_argument("--seed", type=int, default=2026)
    inference = sub.add_parser("infer")
    inference.add_argument("checkpoint", type=Path)
    inference.add_argument("job", type=Path)
    inference.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "train":
        train(args)
    else:
        infer(args)


if __name__ == "__main__":
    main()
