# procad architecture and current boundary

procad is a local desktop wrapper around a loopback web application. The renderer owns the interactive 3D scene and review controls. The local service owns user-provided file intake, SHA-256 provenance, case JSON, self-attested review records, and review-proposal persistence. There are no bundled scans, built-in cases, or automatic private dataset paths.

```mermaid
flowchart LR
  User[User-provided scan files] --> UI[Electron window / browser UI]
  UI -->|loopback HTTP| API[Express local service]
  UI --> GEO[Three.js + Manifold WASM + dental geometry diagnostics]
  PROFILE[Public-source candidate profile] --> UI
  API --> CASES[Local user case manifests]
  API --> SCANS[Local imported scans]
  GEO --> REVIEW[Review STL or OBJ handoff]
```

The importer accepts STL/PLY/OBJ/OFF surface meshes and XYZ/PTS/CSV/ASCII PCD point clouds. Units are user-declared and normalized to millimetres. Point clouds are view-only. Version 2 case records preserve source paths, hashes, units, transforms, operator margin points, a CAD design-clearance summary, design parameters, and any generated review mesh; they do not preserve the per-sample points used to render the transient color overlay. Version 1 cases remain readable and load without a margin trace.

The operator margin path can be traced over a connected open or closed triangle scan patch and is bound to that preparation's SHA-256. On closure, A* searches a welded triangle-edge graph between operator points and records a mesh-edge shortest path using the same coordinate-weld tolerance as mesh validation. The path lies on scanned facets but is an edge-constrained approximation, not a continuous geodesic or clinically verified finish line. Sparse clicks may choose an unintended shortest route. The one-crown Boolean preview still requires a closed, consistently wound preparation and a simple star-shaped contour in the current preparation-local XY frame; it uses the contour as the lower boundary of a generic parametric envelope. The prep offset is subtracted with Manifold; invalid offset geometry stops generation. It is still a one-crown engineering preview, not tooth-specific anatomy. The CAD intaglio diagnostic samples prep surface area and checks normal rays against both the first hit on the final crown and the first hit on the exact Boolean subtraction surface. It reports a distance only when both boundaries coincide within a numerical geometry tolerance and have the expected face-normal orientation; cut-away and unmatched regions remain unreported. This checks generated CAD geometry only and cannot establish fabricated fit, seating, uncertainty, or clinical acceptability. Only the summary is saved; the sample points used for the transient color overlay are not persisted. Restore checks the metric and geometry-engine identifiers alongside source/design hashes and suppresses old or mismatched summaries.

The local review/handoff gate fingerprints saved inputs and the exact STL/OBJ artifact, then writes a manifest. It does not authenticate reviewer credentials, validate bite registration, define a validated material or machine profile, simulate machining, generate fixture placement/nesting or toolpaths, or transmit to a machine. The public DWX-43W candidate record distinguishes the current listed CAM updater (V25.1.7) from a historical V25.1.0 guide and leaves CAM-library-to-physical-blank mapping unresolved. Bridge and implant choices remain brief-only and are rejected by the geometry/approval route.

See [LIMITATIONS.md](LIMITATIONS.md) for the capability matrix and evidence gates required before clinical or manufacturing claims.

See [VALIDATION_ROADMAP.md](VALIDATION_ROADMAP.md) for research findings, proposed algorithms, implementation stages, and measurable evidence gates for the remaining workflows.
