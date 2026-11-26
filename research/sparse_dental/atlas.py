"""Build and register the pinned ProCAD educational atlas outside the repo."""

import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

from geometry import DIRECTIONS, FDI, fit_landmarks, surface_names, tooth_frame

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "app/libraries/registry.json"
ASSET = ROOT / "app/public/dental-library/bodyparts3d-teeth-4.3/teeth.glb"


def read_atlas(path):
    registry = json.loads(REGISTRY.read_text())["assets"][0]
    pin = registry["download"]
    data = path.read_bytes()
    if len(data) != pin["bytes"] or hashlib.sha256(data).hexdigest() != pin["sha256"]:
        raise ValueError("Atlas bytes fail ProCAD's pinned length and SHA-256")
    magic, version, total, json_size, chunk_type = struct.unpack_from("<4s4I", data)
    if (magic, version, total, chunk_type) != (b"glTF", 2, len(data), 0x4E4F534A):
        raise ValueError("Unexpected GLB header")
    manifest = json.loads(data[20:20 + json_size])
    buffer = memoryview(data)[28 + json_size:]

    def accessor(index, width, dtype):
        access = manifest["accessors"][index]
        view = manifest["bufferViews"][access["bufferView"]]
        item = np.dtype(dtype).itemsize
        return np.ndarray((access["count"], width), dtype=dtype, buffer=buffer,
                          offset=view.get("byteOffset", 0) + access.get("byteOffset", 0),
                          strides=(view.get("byteStride", width * item), item)).copy()

    meshes = {}
    for node in manifest["nodes"]:
        key = node.get("extras", {}).get("structureId")
        if key not in registry["structureMap"]:
            continue
        primitive, = manifest["meshes"][node["mesh"]]["primitives"]
        vertices = accessor(primitive["attributes"]["POSITION"], 3, "<f4")
        triangles = accessor(primitive["indices"], 1, "<u4").reshape(-1, 3)
        meshes[int(registry["structureMap"][key])] = (vertices, triangles)
    if set(meshes) != set(map(int, registry["structureMap"].values())):
        raise ValueError("Imported meshes do not match the FDI registry")
    return registry, meshes


def surface_regions(vertices, triangles):
    a, b, c = vertices[triangles].transpose(1, 0, 2)
    normals = np.cross(b - a, c - a)
    centroids = (a + b + c) / 3
    centered = vertices - vertices.mean(axis=0)
    extent = np.maximum(np.ptp(vertices, axis=0) / 2, 1e-6)
    relative = (centroids - vertices.mean(axis=0)) / extent
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.maximum(lengths, 1e-9)
    # Combine face orientation and location. These are descriptive geometric
    # regions, with no claim of clinical semantic segmentation.
    scores = (0.65 * normals + 0.35 * relative) @ DIRECTIONS.T
    return scores.argmax(axis=1), centered


def atlas_to_local(meshes, fdi, scale):
    centers = {code: (v.min(axis=0) + v.max(axis=0)) / 2
               for code, (v, _) in meshes.items()}
    crown = np.array([0.0, -1.0 if fdi < 30 else 1.0, 0.0])
    axes = tooth_frame(centers, fdi, crown, np.array([0.0, 0.0, 1.0]))
    vertices, triangles = meshes[fdi]
    vertices = ((vertices - centers[fdi]) @ axes) * scale
    if np.linalg.det(axes) < 0:
        triangles = triangles[:, ::-1]
    regions, centered = surface_regions(vertices, triangles)
    landmarks = {}
    for name, axis in zip(surface_names(fdi), DIRECTIONS, strict=True):
        score = centered @ axis
        outer = vertices[score >= np.quantile(score, 0.98)]
        mean = outer.mean(axis=0)
        landmarks[name] = outer[np.linalg.norm(outer - mean, axis=1).argmin()]
    return vertices, triangles, regions, landmarks


def write_obj(path, vertices, triangles, groups):
    with path.open("x") as output:
        output.write("# ProCAD educational surface estimate; see accompanying provenance.\n")
        for x, y, z in vertices:
            output.write(f"v {x:.6f} {y:.6f} {z:.6f}\n")
        for group, name in enumerate(groups["names"]):
            output.write(f"g {name}\n")
            for a, b, c in triangles[groups["indices"] == group] + 1:
                output.write(f"f {a} {b} {c}\n")


def provenance(registry):
    return {key: registry[key] for key in
            ("sourceUrl", "revision", "license", "licenseUrl", "attribution", "units")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--atlas", type=Path, default=ASSET)
    sub = parser.add_subparsers(dest="action", required=True)
    build = sub.add_parser("build")
    build.add_argument("output", type=Path)
    fit = sub.add_parser("fit")
    fit.add_argument("job", type=Path)
    fit.add_argument("output", type=Path)
    args = parser.parse_args()
    registry, meshes = read_atlas(args.atlas)
    scale = registry["units"]["inverseScaleToSource"]
    source = provenance(registry)
    source["modifications"] = (
        registry["modifications"] + " This export selects individual tooth meshes, "
        "moves them to tooth-local axes, restores upstream scale, and groups faces "
        "by orientation. The fit command also applies a radiographic landmark transform."
    )
    if args.action == "build":
        args.output.mkdir(parents=True, exist_ok=False)
        entries = {}
        for fdi in sorted(meshes):
            vertices, triangles, regions, landmarks = atlas_to_local(meshes, fdi, scale)
            names = surface_names(fdi)
            name = f"{fdi}.obj"
            write_obj(args.output / name, vertices, triangles, {"names": names, "indices": regions})
            entries[fdi] = {"mesh": name, "landmarks": {k: v.tolist() for k, v in landmarks.items()},
                            "face_counts": dict(zip(names, np.bincount(regions, minlength=len(names)).tolist()))}
        result = {"source": source, "axes": ["mesial", "facial", "coronal"],
                  "coverage": entries, "absent_permanent_fdi": sorted(set(FDI) - set(meshes)),
                  "primary_dentition": "absent"}
    else:
        job = json.loads(args.job.read_text())
        fdi = int(job["fdi"])
        if fdi not in meshes:
            raise ValueError("This FDI has no mesh in the pinned atlas")
        vertices, triangles, regions, landmarks = atlas_to_local(meshes, fdi, scale)
        vertices, rms = fit_landmarks(vertices, landmarks, job["views"])
        args.output.mkdir(parents=True, exist_ok=False)
        write_obj(args.output / f"{fdi}.obj", vertices, triangles,
                  {"names": surface_names(fdi), "indices": regions})
        result = {"source": source, "fdi": fdi, "landmark_rms_px": rms,
                  "clinical_validation": "not evaluated"}
    (args.output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
