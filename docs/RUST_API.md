# Rust API and case-review flow

Base URL: `http://127.0.0.1:4180`.

## First run and authentication

Start with `cargo run -p procad-api`. The first request to `POST /api/v1/auth/bootstrap` creates the one administrator; subsequent bootstrap attempts conflict once a user exists. Passwords are stored as Argon2id hashes. `POST /api/v1/auth/login` returns a random bearer token; only its SHA-256 hash is stored in SQLite. Tokens expire after 12 hours.

An administrator creates staff accounts via `POST /api/v1/users` with `email`, `password` and one of `admin | clinician | technician | viewer`. Send `Authorization: Bearer TOKEN` to protected routes.

## Patient and case records

- `POST /api/v1/patients`: create a pseudonymous `patient_ref` and `label`.
- `POST /api/v1/cases`: create a case attached to a patient.
- `GET /api/v1/cases`: list cases visible to the local instance.
- `GET /api/v1/cases/{id}/teeth`: read the odontogram.
- `POST /api/v1/cases/{id}/teeth`: set `fdi` and `restoration_type`; valid restoration type values are `none`, `crown`, `inlay`, `onlay`, `veneer`, `bridge_abutment`, `bridge_pontic`, `implant_crown`, `implant_abutment`, `denture_tooth`.

## Scan intake

`POST /api/v1/cases/{id}/scans` uses multipart form fields `file` and `units`. The accepted units are `mm`, `cm`, `m`, `in`. The route accepts at most 256 MiB per request and stores the uploaded source bytes in `PROCAD_SCAN_STORE` (default `procad-data/scans`). The response includes the source filename, format, units, size, SHA-256, and processing outcome.

STL and OBJ are parsed and checked by `procad-core`. PLY/OFF are recognized and preserved for the existing frontend importer; XYZ/PTS/CSV/PCD are classified as point-cloud inputs but are not yet parsed in Rust. The upload endpoint does not perform DICOM/CBCT segmentation or multi-scan registration.

## Design review and case state

The intended state flow is:

```text
intake -> scanning -> design -> review -> clinically_approved
                                  |             ^
                                  +-> design --+
                                  |
                                  +-> rejected
```

- `POST /api/v1/cases/{id}/transitions`: move intake/scanning/design/review with a reason and role authorization. The design-to-review transition requires at least one draft revision.
- `POST /api/v1/cases/{id}/design-revisions`: register a design artifact SHA-256, engine/version and design type while the case is in design.
- `POST /api/v1/design-revisions/{id}/approval`: a clinician other than both the case creator and revision author may approve or reject a revision. The approval is tied to the specific design revision and is recorded in `clinical_approvals`. A generic stage transition cannot bypass this approval route.
- `GET /api/v1/libraries`: return license-aware library metadata.

A revision record proves only that a user submitted a hash and metadata. It does not prove that the underlying geometry is clinically correct. The current Rust API does not render a dental CAD design or calculate its geometry; the design artifact must be produced by an actual CAD engine and the hash must fingerprint the artifact that was reviewed.

## Operational caveats

This API is a local-first engineering baseline, not a production clinical record system. It does not yet provide SSO/MFA, rate limiting, encrypted database or scan storage, tenant isolation, comprehensive audit exports, backups, session revocation, external identity integration or a completed security review. Do not store directly identifying patient information in this prototype. Non-loopback binding requires an explicit environment override but still requires a secured deployment.
