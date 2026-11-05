# ArtCraft repository reference review

Reviewed on 2026-11-05. This is a clean-room architecture review; procad does not copy their product branding, UI assets or unrelated application code.

## CADCraft — Rust CAD architecture

Source: [storytold/cadcraft](https://github.com/storytold/cadcraft), public repository, MIT OR Apache-2.0.

Useful architectural patterns:
- A Cargo workspace with separated geometry, document, constraints, rendering, I/O, engine and application crates.
- Strong crate boundaries and serializable domain/document models.
- Test-oriented changes, format validation and explicit evidence about feature completeness.
- Rust 2024 workspace conventions and CI checks for formatting/tests/lints.

Not adopted:
- CADCraft's 2D AutoCAD-oriented command model, drawing formats, brand or application shell.
- Unreviewed or copied CADCraft implementation files.

Important maturity caveat: its public roadmap describes the project as pre-alpha for its stated 2D CAD target and reports 3D modeling as an early area. It is an architecture reference, not a complete dental solid-modeling or CAM kernel.

## Craft Anything — evidence-led reconstruction process

Source: [storytold/craft-anything](https://github.com/storytold/craft-anything), public repository, MIT OR Apache-2.0.

Useful process patterns:
- Study → Build → Check → Refine.
- Evidence records with confidence, scope, coverage and known unknowns.
- Explicit distinction between clean-room observation and deeper inspection.
- Human approval gates around operations that modify or execute outside the project.
- A common engine that can be driven through app, CLI or MCP interfaces.

Not adopted:
- Craft Anything's product branding, UI, engine code, reverse-engineering tooling or asset pipeline.

## procad application

procad uses those architectural patterns to create its own Rust domain/core/API/CAM boundaries while retaining the current Electron/Three.js application during migration. Each migrated function should be tested against the legacy behavior and documented with a statement of coverage and non-coverage. No exocad source, assets, protected libraries or private file formats are copied; the public workflow research in this repository is used only to understand subsystem boundaries.
