# Rust platform status and staged migration

Updated 2026-11-05. This commit creates the first Rust workspace alongside the existing application. It is **not** a complete Rust rewrite or a claim of exocad parity.

## Implemented in this phase

- `procad-core`: dental domain types, permanent/primary FDI and Universal tooth-number crosswalk, scan intake metadata and SHA-256 provenance, STL/OBJ import, unit normalization, mesh statistics and basic topology checks.
- `procad-api`: local-first Axum service, SQLite migrations, Argon2id password hashing, random bearer tokens stored as SHA-256 hashes, one-time first-admin bootstrap, admin-created accounts, role-aware case transitions, patient references, an FDI-keyed odontogram, scan upload, design revision and independent clinician-review APIs.
- Dental database schema: users, sessions, pseudonymous patient references, cases, tooth chart, scan metadata, design revisions, independent clinical approvals, dental library registry and external asset provenance.
- `procad-cam`: evidence gate for a prospective external CAM handoff. It requires independent clinical approval, checksums, a verified exact machine/material profile, a passing simulation report, fixture, postprocessor and separate QA sign-off.
- CAM dispatch is disabled in code. The crate does not emit G-code, proprietary machine programs or network/serial commands.
- BodyParts3D anatomical reference catalog entry pinned to an upstream OrganUI commit and checksum, with a reproducible download script and attribution file. The model file itself is not committed by this phase.
- CI adds a Rust test/lint job while preserving the existing JavaScript tests and build job.

## Existing app retained

The Electron/Three.js application remains the current interactive UI. This Rust workspace is an additive migration seam; the frontend is not yet switched to the Rust geometry or API service. Existing scan and one-crown preview limitations still apply.

## Not implemented yet

- Robust PLY/OFF parsing, point-cloud filtering/registration, DICOM/CBCT ingestion, segmentation or multi-scan registration in Rust.
- A production B-rep kernel, boolean robustness suite, NURBS/surface modeling, parametric restoration feature history, constraint solver, implant/abutment/bridge/aligner workflows, validated contacts/occlusion or automated margin identification.
- Clinical evidence verification, electronic signatures, encryption-at-rest key management, tenant isolation, backup/restore, role administration, rate limits, SSO/MFA, external identity providers and security penetration testing.
- Full user-facing login, case, library or odontogram screens in the current web/Electron UI.
- Machine-specific nesting, toolpath planning, postprocessors, kinematic simulation, machine telemetry or direct milling machine communication.
- Clinical/technical validation, regulatory conformity, independent anatomical review, material qualification or verification on physical restorations.

## Suggested migration sequence

1. Run Rust CI and correct compile/test findings; add a Cargo.lock after a verified toolchain build.
2. Move scan file upload, parser and geometry validation behind a versioned API; preserve scan provenance parity with the existing app.
3. Add licensed anatomy viewer and a manifest-aware library import flow; add opt-in, authenticated vendor-library ingestion.
4. Evaluate a supported B-rep kernel and write geometric acceptance tests using non-clinical fixtures.
5. Implement margin tools, insertion axis, undercut analysis, crown intaglio, wall/thickness, contacts and bite registration as separate, reviewable modules.
6. Build the prosthetic workflow taxonomy (single units, inlays/onlays, veneers, bridges, implant-supported restorations, dentures, splints/aligners) only with domain-specific validation cases.
7. Add material and machine profiles only from authoritative manufacturer documentation and versioned validation datasets.
8. Implement machine-specific CAM through isolated adapters, simulation and explicit operator sign-off; keep the dispatch gate closed until independent hardware validation and safety review.
9. Integrate the Rust core with the existing UI; only retire legacy JavaScript modules after feature-parity tests and migration checks pass.

## Data protection and release boundary

The initial API binds to loopback by default and requires `PROCAD_ALLOW_REMOTE_BIND=true` before non-loopback binding. It is a development baseline, not a production identity or clinical-record service. Do not store directly identifying patient information or real clinical records in this prototype. Use only pseudonymous test references until access control, encryption, audit, backups and applicable privacy/security obligations have been reviewed.
