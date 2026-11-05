# procad Dental CAD workbench

procad is a local-first engineering prototype for dental scan intake, provenance, mesh inspection, operator-entered 3D preparation tracing, and a bounded single-crown geometry preview. It is not a validated clinical CAD/CAM product or milling engine.

The repository also contains the dependency-free transaction-integrity MVP described in [the governance implementation note](docs/TRANSACTION_INTEGRITY_MVP.md): canonical event hashing, deterministic reconciliation signals, explainable risk prioritization, and guarded review workflow transitions. It is an observability aid, not an autonomous tax or fraud decision-maker.

The app starts with an empty, saved case. It does not ship synthetic dental examples or automatically load private practice data. Import only scan files you are authorized to use.


## Rust workspace migration (started 5 November 2026)

A new Rust workspace now sits alongside the existing Electron/Three.js application. This is an incremental migration: the existing UI and its current one-crown preview remain intact while the Rust domain, scan intake, SQLite API and CAM evidence boundary are developed and tested.

**Current Rust crates**
- `procad-core`: FDI/Universal numbering, permanent and primary tooth domain types, STL/OBJ parsing, unit normalization, mesh checks and scan provenance.
- `procad-api`: Axum API, SQLite schema, one-time administrator bootstrap, Argon2id password hashing, expiring bearer sessions, role-gated users/patients/cases, scan uploads and an FDI-keyed case odontogram.
- `procad-cam`: evidence-only external handoff preparation. Physical dispatch is disabled and machine toolpaths are not generated.

**Run the Rust API** (Rust stable with Edition 2024 support):

```sh
cargo test --workspace
cargo run -p procad-api
```

The service binds to `127.0.0.1:4180` by default and creates a local SQLite database at `procad.sqlite`. Set `PROCAD_DATABASE_URL` or `PROCAD_SCAN_STORE` to change the database or scan storage locations. Non-loopback binding is blocked unless `PROCAD_ALLOW_REMOTE_BIND=true`; this flag alone does not make a deployment production-secure.

Create the first administrator exactly once:

```sh
curl -X POST http://127.0.0.1:4180/api/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"use-a-unique-long-password"}'
```

The bootstrap route is closed automatically after the first account exists. Sign in at `POST /api/v1/auth/login` to receive a bearer token. An administrator can create clinicians, technicians and viewers through `POST /api/v1/users`. Protected API routes include `/api/v1/patients`, `/api/v1/cases`, `/api/v1/cases/{id}/teeth`, `/api/v1/cases/{id}/scans` and `/api/v1/libraries`.

Example scan upload (replace the case ID and file path):

```sh
curl -X POST http://127.0.0.1:4180/api/v1/cases/CASE_ID/scans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@scan.stl" -F "units=mm"
```

STL and OBJ are parsed and receive mesh checks in Rust. PLY/OFF are currently recognized but preserved for the existing importer; point-cloud files are classified but not parsed by this Rust phase. Scan uploads are limited to 256 MiB by the API. Use pseudonymous test references only.

**Dental anatomy reference:** `bash scripts/import_bodyparts3d.sh` downloads the pinned 28-tooth BodyParts3D/Anatomography 4.3 model (plus gum/jaw structures) and verifies its SHA-256. The model is CC BY-SA 2.1 Japan and has separate attribution obligations; see [the library catalog](docs/DENTAL_LIBRARY_CATALOG.md). It is educational anatomy, not a clinical tooth morphology or vendor prosthetic library. ToothFairy2 is recorded as non-commercial research data only and is not bundled.

**Important release boundary:** the Rust project does not yet replace the current renderer, implement a robust B-rep/NURBS dental CAD kernel, generate restoration surfaces beyond the legacy preview, or create CAM toolpaths. The CAM crate cannot communicate with milling machines. Clinical approval, security hardening and physical validation remain outstanding. See [Rust platform status](docs/RUST_PLATFORM_STATUS.md), [CAM interlocks](docs/CAM_DEVICE_INTERLOCKS.md) and [ArtCraft architecture review](docs/ARTCRAFT_REFERENCE_REVIEW.md).


## Run from source

Requires Node.js 20+ and npm.

```powershell
cd app
npm ci
npm run dev
```

Open the Vite address printed in the terminal, normally `http://127.0.0.1:5173`.

For the production server:

```powershell
cd app
npm run build
npm start
```

Then open `http://127.0.0.1:4179`.

On Windows, `npm run desktop:pack` builds a portable Electron package into `exports/desktop/`. Build output is ignored by GitHub; release artifacts can be produced from a tagged checkout.

## Current functions

- Imports STL, PLY, OBJ, and OFF surface meshes, plus XYZ, PTS, CSV, and ASCII PCD point clouds with an explicit source-unit declaration.
- Converts declared coordinates to millimetres, records source hashes and case provenance, and checks basic mesh topology and finite coordinates.
- Saves and reopens local cases and their review-proposal mesh.
- Records an operator-entered 3D loop on an open or closed preparation scan patch, bound to the source mesh hash and prep-local millimetre frame. On closure, an edge-constrained shortest path follows scanned facets between picked points. The separate one-crown Boolean preview still requires a closed preparation and a simple star-shaped XY contour.
- Generates a single-crown Boolean geometry preview from a closed preparation mesh. A failed prep offset stops generation instead of silently falling back to the unoffset preparation.
- Measures deterministic area-weighted normal-ray clearance on the final crown only when its first hit is opposed-facing and agrees with the first same-facing hit on the Boolean subtraction surface. It reports matched-ray coverage and CAD geometry percentiles; it does not measure a fabricated crown, penetration where rays are unmatched, seating, uncertainty, or clinical fit.
- Exports review-only STL or a local STL/OBJ handoff manifest after a self-attested review record. The app does not create toolpaths or contact a milling machine.

The outer morphology remains a generic parametric approximation, not tooth-specific anatomy. A mesh-edge path follows the source facets but does not prove the finish line was correctly identified; sparse clicks may take an unintended route, and the edge-constrained approximation is not a continuous geodesic or clinical margin detector. The intaglio ray map checks virtual CAD geometry along prep normals and reports unmatched samples; it has no fabricated-part reference, penetration/seating assessment, uncertainty budget, acceptance threshold, or clinical interpretation. Antagonist positioning is manual and unverified.

The repo includes one public-source **candidate metadata record** for DGSHAPE DWX-43W and its external CAM. As of 2026-09-27 the manufacturer Download Center lists CAM V25.1.7; a V25.1.0 guide shows a VITA SUPRINITY PC `LS-14` CAM-library entry, but current compatibility with DWX-43W and its correspondence to VITA's `PC-14` physical blank remain unverified. This is not a validated machine/material profile and procad does not generate machine data. See [the candidate route evidence](docs/profiles/DWX-43W-VITA-SUPRINITY-PC-candidate.md).

## Not implemented or validated

procad does not provide a validated margin detector, clinically measured intaglio fit, bite-record registration solver, validated contact map or articulation, bridge/pontic or implant geometry, licensed component libraries, validated material or machine profiles, fixture-aware nesting, CAM simulation, postprocessors, or machine toolpaths. The single-crown output has not been independently validated on licensed dental cases or fabricated restorations. A closed mesh, software test, review acknowledgment, candidate profile, or checksum does not establish clinical fit or milling readiness.

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the release boundary, and [docs/VALIDATION_ROADMAP.md](docs/VALIDATION_ROADMAP.md) for the research-backed implementation plan and evidence needed to enable clinical or manufacturing claims. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/OPEN_SOURCE_NOTICES.md](docs/OPEN_SOURCE_NOTICES.md) for system structure and dependency notes.

## Data and privacy

The app binds to loopback by default. Uploaded scans and saved cases are stored in local runtime data directories and are ignored by Git. No patient data or practice dataset is bundled. Use only data you are authorized to process and protect it according to your lab’s privacy requirements.

## License

The source code is available under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
