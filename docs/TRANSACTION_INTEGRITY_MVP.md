# Transaction Integrity MVP

This repository contains the first dependency-free ProCAD governance slice from the implementation plan.

## Implemented

- Canonical event schema with controlled event types, pseudonymous transaction IDs, and SHA-256 event hashes.
- Append-only verification helper for transaction audit chains.
- Deterministic reconciliation controls for service/invoice, payment/invoice, invoice/payment amount, inventory variance, and duplicate invoices.
- Explainable weighted risk score with configurable policy components and review bands.
- Governance transition guard for `OPEN → TRIAGED → UNDER_REVIEW → EVIDENCE_REQUESTED/RESOLVED/ESCALATED`.
- JSON-configurable rules in `rules/compliance-rules.json`.

## Boundary

This is an observability and review aid. Signals express confidence that a defined data inconsistency exists; they do **not** determine tax evasion, fraud, guilt, or legal liability. Production deployment still requires authenticated users, PostgreSQL persistence, RBAC, encryption, retention controls, approved tax adapters, and independent legal/security review.

The companion operational prototype is `minagayid/medcad`, which emits the same transaction/event vocabulary in local preview manifests without storing patient clinical data.
