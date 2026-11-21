# Reference-library registry and local asset manager

Research and education only. No clinical fit, implant interface or manufacturing readiness is validated.

This is a separate, dependency-free Node.js 22 library center. It does not replace the main CAD editor or connect atlas anatomy to crown/prosthesis generation. It provides a versioned registry, pinned download/verification, local availability status, and an educational structure browser. No patient data, third-party device designs or trained weights are bundled.

## Start

From the directory containing `libraries/`:

```sh
node libraries/manager.mjs status
node libraries/manager.mjs install bodyparts3d-teeth-4-3
node libraries/manager.mjs serve
```

Open `http://127.0.0.1:4187`. Select the anatomy entry, click **Preview verified anatomy asset**, then choose a named structure. The atlas has 33 separate meshes: 28 permanent teeth (with FDI labels), two gums and three jaw bones. Rotation/tilt/reset controls and automatic view framing are available. There are no primary teeth or third molars. This is actual atlas geometry, not generated primitives or a restoration morphology library.

Files are downloaded only by the explicit local install command. The browser cannot install, delete or change assets. The cache is outside the repository, at `~/.cache/<application>-reference-library/`. Optional `CAD_LIBRARY_CACHE` selects another cache; `CAD_LIBRARY_PORT` selects another port. `install ASSET_ID CACHE_DIR` also accepts an explicit cache directory. Set the same cache path for install and serve. Use separate ports if running both projects at once.

The exact 1,518,540-byte GLB is pinned by source commit and SHA-256. Installation streams with a maximum pinned size, verifies exact size and hash, and writes via a temporary file. The server rechecks cached bytes before serving; the browser checks them again before parsing. A corrupt cache is unavailable, not silently accepted. The viewer is loopback-only, read-only, rejects non-loopback Host headers, and serves only its allowlisted files and verified assets. This is not a hardened multi-user or internet-facing service.

## Units and coordinate audit

Do not treat GLB display coordinates as millimetres. The pinned upstream preparation recenters source coordinates, multiplies them by **0.025**, and changes axes from `[x,y,z]` to `[x,z,-y]`. The inverse scale is **40**. The upstream manifest labels original bounds and center in millimetres. We additionally inspected the pinned original right upper central-incisor OBJ, verified its source hash, and found its explicit `Bounds(mm)` header. Thus source units are upstream-declared millimetres, while the packaged viewer coordinates are normalized display units.

This verifies the documented scale relationship and unit declaration, not an independently measured anatomy model, patient calibration or clinical dimensional accuracy. The browser deliberately offers no mm ruler, conversion/export, restoration placement or clinical geometry handoff. Restoring absolute source coordinates would also require reversing the axis mapping and restoring the source center, not merely multiplying by 40.

Pinned evidence:
- [Model provenance](https://github.com/organui/teeth-3d/blob/f2cfe96f19dba7ec3982f2b06e6a34a1f6670450/docs/MODEL_PROVENANCE.md)
- [Manifest with source bounds, center and transform](https://github.com/organui/teeth-3d/blob/f2cfe96f19dba7ec3982f2b06e6a34a1f6670450/public/models/manifest.json)
- [Original incisor OBJ](https://media.githubusercontent.com/media/olivercase/body_parts_3d_api/fd527e6f4daf732fd814314d9257df5877b844bc/meshes/FJ1279_BP22758_FMA55681_Right%20upper%20central%20incisor%20tooth.obj), SHA-256 `861731e2e8d74b9813e7ac119f26500ce1e2dc7fe5841267f02b312115118032`.

## Rights and availability

BodyParts3D / Anatomography, © The Database Center for Life Science (DBCLS). Adapted by OrganUI. The model is **CC BY-SA 2.1 Japan**, separately from application code. The registry preserves its attribution, modification notice, source revision, hash and [license link](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en). No endorsement is implied. Redistribution and derivatives must retain the applicable attribution and ShareAlike obligations. The downloaded GLB is unchanged. Source code and model licenses must not be conflated.

Only the reviewed pinned anatomy GLB is downloadable in this version. Other entries are explicitly metadata-only. The registry distinguishes `anatomy-reference`, `restoration-morphology`, `prosthetic-mechanism`, `implant-component` and `research-software`. No restoration-morphology or exact implant-interface asset has passed the intake gate. A search result, public repository or “free” download is not a reusable asset license.

## Concrete source audits, 21 November 2026

- **Dental morphology:** [ToothForge](https://github.com/tiborkubik/toothForge), revision `a973a1be1f1a080c228154648eb414e62395e6c2`, is relevant tooth-shape generation research, but its README describes a private crown dataset and no LICENSE/COPYING file was found in the inspected repository tree. No code, data or model is copied. This is a blocked source candidate, not an available clinical tooth library.
- **Crown interior:** [C.B.GEN](https://github.com/ImaneChafi/C.B.GEN), revision `205d27a8956eb2f94ec90da22b18800876e8d1fc`, has an inspected MIT license for code. It generates crown bottoms from a preparation and margin; it is not a reusable tooth-shape library. Its README says the original dental data cannot be shared for privacy. No integration or validation is claimed.
- **One e-NABLE CAD design:** [Paraglider / Flexible Flyer](https://github.com/mendenm/flexible_flyer), revision `2b713c0d81291172ae86f36519bbfbf10d124f9f`, is linked by the [e-NABLE CAD resource](https://hub.e-nable.org/p/devices?p=CAD+Files+for+e-NABLE+Designs). Its short LICENSE.txt attributes the Reborn Hand under CC BY 3.0. Its README mixes Phoenix v2, Unlimbited v3 and Reborn sources and requires other parts from separate repositories. The complete derivative-rights chain, assembly completeness and file-specific terms are unresolved. Therefore no design files are downloaded or redistributed, and no complete/fitted hand library is claimed. Resolve those points or select a source with clearer per-file rights before enabling installation.
- **Discovery only:** [NIH 3D e-NABLE collection](https://3d.nih.gov/collections/prosthetics) offers model discovery, not a blanket license or patient suitability determination. Procad's existing ToothFairy2 entry remains registration-required non-commercial research metadata, not downloaded or re-audited in this stage.

MedCAD's existing five procedural kits remain generic study shapes, not an anatomical or patient-fitted device library. The dental/head atlas is not presented as whole-body coverage. The registry is designed to keep those gaps visible rather than fill them with relabeled primitives.

## Tests

```sh
node --test libraries/manager.test.mjs
```

After installation, include the actual cached asset in the integration test:

```sh
CAD_TEST_ATLAS=/path/to/cache/bodyparts3d-teeth-4-3.glb node --test libraries/manager.test.mjs
```

The tests cover registry validation, role/download gates, hash/size mismatch, corrupt/missing cache, metadata-only install refusal, server allowlist and Host checks, read-only methods, scale metadata and malformed GLB rejection. With the real asset supplied, they also parse all 33 structures and 59,608 triangles and verify 28 FDI mappings. These are software/data-integrity checks, not clinical validation.

## Restorative use case: a scan must become more than a tooth shape

For actual crowns, the current library center is not enough. It supplies educational atlas geometry only. The separate existing Procad editor has operator-entered preparation-margin tracing and a bounded generic single-crown Boolean preview. Those paths are not connected to this atlas browser. Neither one establishes a clinically fitted restoration. Bridges are not implemented.

| Required stage | Current state | Research target and acceptance evidence |
|---|---|---|
| Scan intake and coordinates | Existing importer normalizes declared units; library atlas uses display coordinates | Verified calibration/frame, scan quality and prep/adjacent/antagonist roles; reject ambiguous units and missing coverage |
| Margin and insertion axis | Operator-entered trace, not validated automatic finish-line detection | Reviewed continuous margin, undercut assessment, explicit insertion axis and documented operator edits |
| Fitting surface / crown bottom | Generic Boolean preview is separate; no validated seating/fit result | Evaluate a C.B.GEN-style preparation-plus-margin method against a reproducible baseline; preserve margin and cement-space controls, assess seating, collision and uncertainty with independent references |
| Outer anatomy | Educational atlas, no approved restorative morphology library | Obtain rights-cleared, versioned, tooth-specific crown morphology with semantic landmarks; do not relabel complete atlas teeth as restoration-ready crowns |
| Final crown construction | No connected end-to-end workflow | Join outer anatomy, margin and intaglio in a suitable geometry kernel; inspect topology, self-intersection, local thickness and margins |
| Adjacent contacts and occlusion | No validated contact adaptation or bite solver | Verified opposing/adjacent registration, measured static contacts and clearance; later articulation, with independent reference cases and clinician review |
| Bridges | Not implemented | Separate pontic, connector, path-of-insertion, material and load requirements; do not extend a single-crown result by duplicating teeth |
| Manufacturing | No validated CAM/toolpaths | Qualified materials, blank/tool/machine profiles, fabrication and independent dimensional/fit checks before any clinical claim |

C.B.GEN is an MIT-licensed crown-bottom research implementation, not a full crown pipeline. Its original data is withheld for privacy, and its dependency licenses and implementation behavior still need a full integration audit. A small, separate research reproduction from authorized synthetic/consented prep-plus-margin cases is the next useful experiment. No third-party code or data has been integrated or run in this registry stage. A rights-cleared morphology asset is one blocker; the fitting, contact, geometry, evaluation and physical-validation stages are additional blockers, not solved by buying or downloading a tooth library.

Prioritize a reproducible single-crown research path before bridges or manufacturing: preparation plus reviewed margin, controlled crown-bottom baseline, rights-cleared outer anatomy, geometry assembly, independent fit/contact evaluation, then fabrication validation. Any result remains a research proposal until the intended clinical use is properly validated. The registry browser remains a reference tool and must not be marketed as scan-to-crown automation.

## Next intake gate

Before adding a real morphology or device library: record an exact source revision, all relevant file/code/data licenses, attribution and derivative obligations, hash/size, actual geometry format, units/frame, per-tooth or per-region coverage, required hardware/assembly, known defects and intended-use limits. Keep anatomy references, dental restoration anatomy, mechanical assistive designs and exact implant components separate. No paid services or commercial library scraping are needed for this stage.
