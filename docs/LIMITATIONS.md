# Scope, limitations, and release evidence

## Product status

This checkout is an engineering prototype for local scan intake and mesh review. It is not a validated dental CAD/CAM system, a medical device, clinical decision software, or a milling engine. The application has no dental scans bundled with it and starts with an empty local case.

## Capability status

| Capability | Current status | What the status means |
| --- | --- | --- |
| Scan import and provenance | Implemented utility | Supports the formats in the input contract, explicit source units, local source hashes, and case persistence. Import checks do not establish scan accuracy or clinical suitability. |
| Mesh integrity | Implemented software check | Checks finite coordinates and basic topology, including closure for Boolean input/output. Closure does not establish anatomy, fit, strength, or machinability. |
| Single-crown geometry | Research preview | A manually closed trace on one closed prep mesh drives a parametric 3D envelope and prep-offset Boolean. The model is not tooth-specific or clinically validated. Failed offsets now stop generation instead of silently using the unoffset prep. |
| 3D margin tracing | Operator annotation implemented | Clicked points are saved in prep-local millimetres and bound to the source mesh hash. Straight 3D chords join the points; they are not constrained to follow the preparation surface between clicks. Radial interpolation requires a simple loop in the current XY frame, so the annotation is only a construction proxy, not a true surface-following or clinically verified finish line. There is no per-segment confidence map. |
| Prep–restoration distance diagnostic | Unvalidated geometric measurement | Deterministic area-weighted samples on the preparation query the final preview mesh. The report gives unsigned nearest-surface percentiles and an opposed-normal subset heuristic. Only the summary is saved; the per-sample points used for the transient color overlay are not persisted. Restore checks the distance algorithm and geometry-engine identifiers alongside source/design hashes and suppresses summaries made with a different algorithm version. It does not isolate the intaglio with a validated classifier, determine signed gap/intersection, estimate uncertainty, assess seating, or set a clinical pass threshold. |
| Bite registration and occlusion | Not validated or measured | Antagonist positioning remains operator-entered. The former sparse nearest-distance number and self-attested checkbox were removed. There is no bite-record registration solver, independent registration-error estimate, signed contact/intersection map, or dynamic articulation. |
| Wall thickness and insertion path | Not implemented | No spatial wall-thickness measurement, insertion-axis solver, or undercut analysis is available. |
| Material and machine profile | Candidate metadata only | One public-source candidate is recorded: DGSHAPE DWX-43W, DGSHAPE CAM for DWX-43W 2025 V25.1.0, VITA SUPRINITY PC LS-14 and manufacturer-listed ZGB/ZGB2 wet grinding burs. It is visibly unvalidated and lacks machine identity/calibration, lot instructions, fixture transforms, CAM strategy, and physical results. See [candidate route](profiles/DWX-43W-VITA-SUPRINITY-PC-candidate.md). |
| Bridge and implant geometry | Brief only | No multi-unit design, common insertion path, pontic/connectors, exact scan-body/component library, or implant-interface geometry is generated. This target profile supports no claims about those workflows. |
| Nesting, simulation, toolpaths | Not implemented | The selected wet mill candidate uses a multi-pin fixture, but procad has no fixture-position coordinates, verified collision model, CAM integration/postprocessor, simulation, or machine command. STL/OBJ plus a review manifest is still the only handoff. |
| Reviewer identity | Self-attested record | A name, role, and case ID are user-entered. The app does not authenticate credentials or confer professional approval. |

## Manufacturing and clinical release boundary

The current export is a local geometry handoff for external review. Fingerprints bind the record to saved inputs and files; topology checks verify mesh properties. The distance map is a software-derived unsigned geometric diagnostic only. None of these checks validates the restoration or manufacturing process. The external CAM operator must independently confirm source identity, coordinate frames, units, fit, margins, contacts, occlusion, material and blank, machine/tool configuration, simulation, and the physical result.

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
