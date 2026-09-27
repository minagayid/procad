# procad Dental CAD workbench

procad is a local-first engineering prototype for dental scan intake, provenance, mesh inspection, operator-entered 3D preparation tracing, and a bounded single-crown geometry preview. It is not a validated clinical CAD/CAM product or milling engine.

The app starts with an empty, saved case. It does not ship synthetic dental examples or automatically load private practice data. Import only scan files you are authorized to use.

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
- Calculates a deterministic area-weighted, unsigned nearest-surface distance diagnostic between sampled preparation triangles and the final preview mesh. It reports percentiles and opposed-normal heuristic coverage; it does not validate fit or identify a clinical intaglio with proven accuracy.
- Exports review-only STL or a local STL/OBJ handoff manifest after a self-attested review record. The app does not create toolpaths or contact a milling machine.

The outer morphology remains a generic parametric approximation, not tooth-specific anatomy. A mesh-edge path follows the source facets but does not prove the finish line was correctly identified; sparse clicks may take an unintended route, and the edge-constrained approximation is not a continuous geodesic or clinical margin detector. The offset is a construction input; the unsigned map has no signed gap, uncertainty estimate, acceptance threshold, seating assessment, or clinical interpretation. Antagonist positioning is manual and unverified.

The repo includes one public-source **candidate metadata record** for DGSHAPE DWX-43W, DGSHAPE CAM for DWX-43W 2025 V25.1.0, and VITA SUPRINITY PC LS-14. It is not a validated machine/material profile and procad does not generate the external CAM product's machine data. See [the candidate route evidence](docs/profiles/DWX-43W-VITA-SUPRINITY-PC-candidate.md).

## Not implemented or validated

procad does not provide a validated margin detector, clinically measured intaglio fit, bite-record registration solver, validated contact map or articulation, bridge/pontic or implant geometry, licensed component libraries, validated material or machine profiles, fixture-aware nesting, CAM simulation, postprocessors, or machine toolpaths. The single-crown output has not been independently validated on licensed dental cases or fabricated restorations. A closed mesh, software test, review acknowledgment, candidate profile, or checksum does not establish clinical fit or milling readiness.

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the release boundary, and [docs/VALIDATION_ROADMAP.md](docs/VALIDATION_ROADMAP.md) for the research-backed implementation plan and evidence needed to enable clinical or manufacturing claims. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/OPEN_SOURCE_NOTICES.md](docs/OPEN_SOURCE_NOTICES.md) for system structure and dependency notes.

## Data and privacy

The app binds to loopback by default. Uploaded scans and saved cases are stored in local runtime data directories and are ignored by Git. No patient data or practice dataset is bundled. Use only data you are authorized to process and protect it according to your lab’s privacy requirements.

## License

The source code is available under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
