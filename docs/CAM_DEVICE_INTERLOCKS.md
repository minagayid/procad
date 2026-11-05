# CAM device and manufacturing interlocks

procad does not currently generate machine toolpaths or send commands to dental milling machines.

The Rust CAM crate can only prepare an external-review evidence record after checking that:
- the case design is fingerprinted by SHA-256;
- a clinician other than the case creator approved the revision;
- the exact manufacturer, machine model, profile, material, blank, fixture and postprocessor are named;
- a simulation report has a SHA-256 fingerprint and is marked passed; and
- a separate QA sign-off is present.

That record is not a toolpath and cannot establish that the above evidence is true. The current crate has no vendor profile database and no verified machine adapter, so callers must not populate `machine_profile_verified` from an assumption or a marketing document alone.

`dispatch_to_machine` is hard-disabled and always returns `HardwareDispatchDisabled`, including for a complete evidence record. The intended first-stage handoff is a human-reviewed export to the manufacturer's validated CAM application.

Before a physical adapter is considered, the project needs exact manufacturer SDK/protocol terms, machine-family/firmware compatibility, calibration/fixture/blank/tool data, deterministic postprocessor tests, collision/kinematic simulation against reference cases, operator interlocks, emergency-stop independence, controlled recovery after interrupted jobs, authenticated machine access, audit logging and independent hardware validation. Never bypass the receiving manufacturer's CAM or safety system.


Clinical approval for a design revision is restricted to a clinician account that is different from both the case creator and the revision author. The CAM evidence record requires all three identities to be distinct, plus a separate QA sign-off. The present build does not yet fetch or cryptographically verify those records against a remote credentialing or machine-profile authority.
