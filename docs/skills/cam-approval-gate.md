# Review handoff gate

procad produces a local STL/OBJ review package; it does not define a validated CAM profile, connect to or transmit to a milling machine, or generate a toolpath. The reviewer record is self-attested. The repo contains one blocked DWX-43W CAM route investigation: current updater V25.1.7 was listed by DGSHAPE on 2026-05-29, while the V25.1.0 guide's `LS-14` CAM entry is not proven to map to VITA's physical `PC-14` blank or compatible DWX-43W hardware. It remains metadata only and unvalidated.

## Required sequence

1. Generate a fresh closed trace-driven preview from the current case inputs. The trace itself is operator-entered and not clinically verified.
2. Review the source roles, units, FDI brief, preparation, antagonist, reference anatomy, and design limitations.
3. Check the self-attested reviewer acknowledgment.
4. Record the user-entered reviewer name, role, external review/case ID, and note.
5. Confirm the current design fingerprint matches the reviewer record.
6. Review the selected candidate machine/CAM/material/blank/tool metadata and confirm the installed setup independently. The app does not load or validate those settings.
7. Export the selected STL or OBJ plus the JSON review manifest.
8. Independently review the geometry and, if it is appropriate to continue, import it into the actual CAM system, verify units/orientation, simulate, inspect, and authorize a machine-specific job there.

## Handoff invariants

- The manifest contains separate design-context and exact exported-artifact fingerprints, case ID, source format list, geometry format, millimetre units, a self-attested reviewer record, and operator-supplied machine/material labels marked unvalidated.
- The local service receives and hashes the exact STL/OBJ artifact before creating the manifest; a browser-supplied checksum alone is not accepted.
- A changed design invalidates the reviewer record and blocks the handoff until it is recorded again.
- The candidate route records public manufacturer data; it is not a calibrated machine profile or postprocessor.
- The handoff status is `CAM_SIMULATION_AND_OPERATOR_CHECK_REQUIRED`.
- No toolpath, feed/speed set, fixture plan, nesting plan, or machine command is generated.

## Stop conditions

Stop and return to review when the file is stale, the checksum differs, the reviewer record is missing, the restoration is an abutment brief, units are uncertain, the mesh is open or invalid, or the external CAM profile/material/blank/tool configuration has not been validated for the named manufacturing prescription.
