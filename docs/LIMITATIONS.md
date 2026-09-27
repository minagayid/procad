# Scope, limitations, and release evidence

## Product status

This checkout is an engineering prototype for local scan intake and mesh review. It is not a validated dental CAD/CAM system, a medical device, clinical decision software, or a milling engine. The application has no dental scans bundled with it and starts with an empty local case.

## Capability status

| Capability | Current status | What the status means |
| --- | --- | --- |
| Scan import and provenance | Implemented utility | Supports the formats in the input contract, explicit source units, local source hashes, and case persistence. Import checks do not establish scan accuracy or clinical suitability. |
| Mesh integrity | Implemented software check | Checks finite coordinates and basic topology, including closure for Boolean input/output. Closure does not establish anatomy, fit, strength, or machinability. |
| Single-crown geometry | Research preview | A manually closed trace on one closed prep mesh drives a parametric 3D envelope and prep-offset Boolean. The model is not tooth-specific or clinically validated. Failed offsets now stop generation instead of silently using the unoffset prep. |
| 3D margin tracing | Operator annotation with surface path | Clicked points are saved in prep-local millimetres and bound to the source mesh hash. An edge-constrained shortest path connects them on a connected open or closed scan patch. Sparse clicks may choose an unintended route. The one-crown preview still requires a closed preparation and simple star-shaped contour in its XY frame. There is no clinical finish-line detector, per-segment confidence, scan-defect interpretation, insertion-axis solution, or independent clinical verification. |
| CAD intaglio clearance | Unvalidated virtual design measurement | Deterministic area-weighted preparation samples cast along prep normals. A distance is reported only when the final crown's first positive hit is opposed-facing and agrees with the first same-facing hit on the exact Boolean subtraction surface within 0.001 mm. The algorithm reports coverage and unmatched samples and measures final CAD boundary geometry only. It does not detect penetration where rays are unmatched, assess seating, estimate uncertainty, validate clinical fit, or set a pass threshold. Only the summary is saved; per-sample overlay points are transient. Restore requires matching algorithm, geometry engine and source/design hashes. |
| Bite registration and occlusion | Not validated or measured | Antagonist positioning remains operator-entered. The former sparse nearest-distance number and self-attested checkbox were removed. There is no bite-record registration solver, independent registration-error estimate, signed contact/intersection map, or dynamic articulation. |
| Wall thickness and insertion path | Not implemented | No spatial wall-thickness measurement, insertion-axis solver, or undercut analysis is available. |
| Material and machine profile | Candidate metadata only | One public-source candidate records the DGSHAPE DWX-43W and CAM route. The official updater history lists CAM 2025 V25.1.7 as of 2026-09-27; a historical V25.1.0 guide shows a VITA SUPRINITY PC `LS-14` CAM-library entry. VITA separately identifies its physical `PC-14` blank as 12 × 14 × 18 mm and currently lists DWX-4W, not DWX-43W, among the relevant system partners. Do not equate the two blank identifiers or assert their compatibility. Exact installed software/license, machine calibration, physical blank/lot, fixture transforms, CAM strategy, and trial results remain unknown. See [candidate route](profiles/DWX-43W-VITA-SUPRINITY-PC-candidate.md). |
| Bridge and implant geometry | Brief only | No multi-unit design, common insertion path, pontic/connectors, exact scan-body/component library, or implant-interface geometry is generated. This target profile supports no claims about those workflows. |
| Nesting, simulation, toolpaths | Not implemented | The selected wet mill candidate uses a multi-pin fixture, but procad has no fixture-position coordinates, verified collision model, CAM integration/postprocessor, simulation, or machine command. STL/OBJ plus a review manifest is still the only handoff. |
| Reviewer identity | Self-attested record | A name, role, and case ID are user-entered. The app does not authenticate credentials or confer professional approval. |

## Manufacturing and clinical release boundary

The current export is a local geometry handoff for external review. Fingerprints bind the record to saved inputs and files; topology checks verify mesh properties. The CAD intaglio clearance map checks the generated crown boundary against its Boolean subtraction surface; it remains a software-derived virtual geometry diagnostic only. None of these checks validates the fabricated restoration or manufacturing process. The external CAM operator must independently confirm source identity, coordinate frames, units, fit, margins, contacts, occlusion, material and blank, machine/tool configuration, complete simulation, post-milling processing, and physical result.

No universal cement-gap, wall-thickness, connector, contact, or milling tolerance is encoded here. Acceptance limits must be defined for a specific indication, material, manufacturing process, and validation protocol.

Before enabling clinical or manufacturing claims, the project needs at least:

1. Authorized, representative dental cases with expert-reviewed reference margins, registrations, and restorations, plus documented train/test separation and acceptance criteria.
2. Independent repeatability and accuracy studies for margin, signed intaglio clearance, registration, static contacts, wall thickness, and any supported restoration types.
3. Licensed and versioned material and implant/component data, with manufacturer instructions and process-specific compensation evidence.
4. A named machine, stock/fixture coordinate contract, validated cutter inventory, postprocessor, collision simulation, and physical machining trials with independent inspection.
5. A documented quality, risk, privacy, and regulatory review appropriate to intended use and jurisdiction.

Until those gates are met, generated geometry must remain a research preview and must not be represented as clinically validated or ready to mill. Software checks on analytic meshes can validate code behavior; they cannot replace dental-lab or physical manufacturing evidence. The app currently fails closed on a missing/invalid trace or failed prep offset, but the review-file workflow is not a manufacturing authorization gate backed by external evidence.

## Input boundary

See [skills/input-data-contract.md](skills/input-data-contract.md) for formats, unit handling, and conversion rules. Point clouds remain view-only. The application does not infer source units, patient side, scan role, registration, or anatomy from mesh coordinates.

See [VALIDATION_ROADMAP.md](VALIDATION_ROADMAP.md) for evidence-backed solutions and stage gates for the missing clinical and manufacturing workflows.
