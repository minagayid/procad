# Morphology-library placement research

Research-only geometry proposals. No clinical fit, load-bearing prosthesis, implant interface, or CAM toolpath is validated.

## What this adds

This separate Node.js 22 research path implements asset provenance checks, permanent-FDI coverage, exact JSON asset hashing, and deterministic landmark-frame placement. It preserves the existing workbench and its single-crown Boolean preview. It does **not** replace the generic outer morphology in that preview, and is not connected to the graphical editor yet.

`morphology-library.mjs` accepts a triangle mesh encoded as UTF-8 JSON (`vertices: [[x,y,z], ...]`, `triangles: [[a,b,c], ...]`). Coordinates must already be in millimetres. It constructs proper right-handed frames from three corresponding landmarks, rotates/translates the source, and optionally applies one bounded uniform scale. It reports residuals for every supplied landmark, rejecting a proposal if any exceed the operator's threshold. Additional landmarks are checks, not inputs to a least-squares fit. No ICP, automatic landmark detection, segmentation, occlusal adaptation, margin/intaglio generation or clinical fit calculation is performed.

Asset bytes are verified before parsing; the parsed verified bytes are the only source of geometry. Atlas meshes and implant interfaces are rejected as restoration morphology. `rightsReviewed` is an operator attestation, not a legal determination. No commercial tooth library, clinical anatomy asset, patient scan or proprietary exocad file is bundled.

## Run

From `app/`, with Node.js 22:

```sh
node --test research/morphology-library.test.mjs
node research/place-library.mjs /private/case/job.json /private/case/proposal.json
```

The output must not exist. The CLI never overwrites a prior proposal. Paths inside the job are resolved relative to the job file. Keep all patient-derived files outside the repository. The CLI reads the actual scan bytes and computes `scanSha256`; the module API accepts a caller-supplied scan hash and cannot independently verify that caller's scan or landmarks. A checksum establishes identity, not scan quality, privacy, or clinical correctness.

A job has this structure (values below illustrate the contract, not an actual licensed library):

```json
{
  "assetFile": "licensed-morphology.json",
  "scanFile": "authorized-scan.stl",
  "fdi": "11",
  "asset": {
    "schema": "procad.morphology.v1",
    "id": "operator-assigned-asset-id",
    "kind": "restoration-morphology",
    "fdi": ["11"],
    "units": "mm",
    "sha256": "REPLACE_WITH_EXACT_64_CHARACTER_LOWERCASE_SHA256",
    "sourceUrl": "https://example.org/replace-with-real-source",
    "version": "replace-with-exact-revision",
    "license": "replace-with-actual-license",
    "attribution": "replace-with-required-credit",
    "rightsReviewed": false
  },
  "sourceLandmarks": [[0,0,0],[1,0,0],[0,1,0]],
  "targetLandmarks": [[5,2,3],[5,3,3],[4,2,3]],
  "options": {"allowUniformScale": false, "maxResidualMm": 0.5}
}
```

Do not set `rightsReviewed` until rights have actually been checked. The example intentionally fails the asset gate. Source and target landmarks must correspond in order, have the same named anatomical meaning, and use their respective mesh coordinates. The first three must be well separated and non-collinear. The threshold and scaling limits are software guardrails, not clinically validated tolerances. Up to 60,000 vertices, 20,000 triangles and 25 MiB of asset bytes are accepted. The module checks finite coordinates, indices and nonzero triangle area, not self-intersection, solid validity or clinical anatomy.

## Why a tooth library alone is insufficient

The official exocad workflow separates margin detection, insertion axis, crown interior, library placement, freeforming and antagonist/adjacent adaptation. Its automatic placement uses neighboring teeth and contact points, not just a tooth number. This module implements only an explicit, operator-landmarked placement step. The existing procad scan/margin and Boolean paths remain separate.

## Verified resources and licensing boundaries

Reviewed 21 November 2026:

| Resource | Appropriate role | Boundary |
|---|---|---|
| [exocad workflow](https://wiki.exocad.com/wiki/index.php/Documentation_of_the_%E2%80%9Ewizard%E2%80%9C_steps_for_a_typical_design) and [model-tooth placement](https://wiki.exocad.com/wiki/index.php/Place_Model_Tooth) | Product behavior reference | Documentation does not grant rights to proprietary code or tooth libraries. |
| [Open Dental CAD](https://github.com/patmo141/odc_public) | Blender dental workflow reference, including undercut and splint tools | README targets Blender 2.8. Audit current compatibility and exact code/asset licenses before reuse. No files copied. |
| Existing BodyParts3D catalog at `../public/dental-library/catalog.json` | Anatomy visualization | Not restoration-ready morphology. Existing separate attribution and ShareAlike obligations remain. |
| [Open3D ICP](https://www.open3d.org/docs/release/tutorial/pipelines/icp_registration.html) | Future registration experiment | Initial alignment, objective and error evaluation matter. ICP is not implemented here and does not prove fit. |
| [MeshLib](https://github.com/meshinspector/meshlib) | Candidate mesh-processing backend | Current upstream describes source-available, free non-commercial/educational use and commercial licensing. Do not assume unrestricted commercial open source. Not added as a dependency. |
| [3D Slicer](https://www.slicer.org/) | External segmentation/registration workstation | Its BSD-style software license does not license patient data, models or third-party extensions. Not integrated. |

## Next gates

1. Obtain rights-cleared, clinician-reviewed tooth meshes with semantic landmarks and per-FDI coverage. Do not label anatomy atlases or procedural shapes as validated restorations.
2. Add an editor import/selection UI, retain mesh and landmark hashes, and verify case/frame consistency across saves. No UI integration is claimed now.
3. Benchmark registration on consented or synthetic cases with independent landmark checks; assess sensitivity to scan noise and starting pose.
4. Connect the placed outer surface to reviewed margins and intaglio construction; measure thickness, adjacent/antagonist contacts, seating and uncertainty using an appropriate kernel and independent reference.
5. Keep implants and CAM separate until licensed exact interfaces, material/process constraints, qualified review and physical validation exist.
