# Candidate milling route: DWX-43W / VITA SUPRINITY PC

This is a manufacturer-sourced **candidate configuration**, not a validated procad machine or material profile. The application does not generate the machine file or a toolpath for this setup. It remains a review-file handoff to the named external CAM product.

## Selected public route

- Machine: DGSHAPE DWX-43W, wet 4-axis dental mill.
- CAM: DGSHAPE CAM for DWX-43W, version 2025 V25.1.0 as shown in the DGSHAPE-hosted CAM Produce quick guide. Treat this as the identified candidate version, not a claim that it is the latest or installed version for a particular mill. DGSHAPE's live Download Center supplies the installer/updater; confirm the installed revision and license in CAM Support before qualifying a machine.
- Material: VITA SUPRINITY PC glass-ceramic block, LS-14, 18 × 14.3 × 12.2 mm.
- Fixture/workholding: pin-type block; the machine supports up to six blocks subject to size and fixture constraints. The candidate record intentionally has no pin-position transform or collision model.
- Tool family: manufacturer-listed ZGB/ZGB2 wet grinding burs. The candidate JSON records the published tip radii/diameters and manufacturer glass-ceramic replacement-time guidance. It leaves stocker positions blank because those depend on the actual machine setup.

## What this profile does

It gives the project one precise route to discuss, records sourced configuration values, and makes missing evidence visible. It is not a controller profile, postprocessor, milling strategy, blank-lot recipe, collision model, or physical validation record. `CANDIDATE_UNVALIDATED` and `BLOCKED_NO_MACHINE_VALIDATION` are intentional. The manufacturing gate must remain blocked.

The selected machine uses a pin-block/multi-pin fixture workflow. This is not disk nesting. A multi-pin placement preview would still require the actual fixture coordinate map and collision model. No placement coordinates are inferred here.

## Required before a validated release

1. Confirm the exact machine serial, firmware, spindle, fixture/holder, installed tools and positions, and machine correction state.
2. Confirm the exact VITA product, size, lot, shade/gradient orientation, current material instructions and CAM material database entry.
3. Confirm the installed, licensed DGSHAPE CAM revision against this documented V25.1.0 candidate, then capture the exact strategy, output identity and complete simulation evidence. The official Download Center and CAM Support view are authoritative for the installed revision and license. procad does not implement or replace that CAM product.
4. Verify all six fixture positions, rotary motion, bur reach and collision clearances for the intended restoration geometry.
5. Cut representative, authorized cases and inspect them independently against prespecified margin, fit and occlusion reference measurements. Record uncertainties and failed jobs.
6. Obtain qualified clinical, laboratory, machine-owner and regulatory/QMS review before any product or manufacturing claim.

## Primary sources

- [DGSHAPE DWX-43W product page](https://dgshape.com/dwx-43w/) — wet milling process, compatible application/material families, six pin-type workpieces, machine overview and bundled CAM.
- [DWX-43W User's Manual](https://downloadcenter.rolanddg.com/contents/manuals/DWX-43W_USE_EN.pdf) — workpiece limitations, tool-management and replacement guidance.
- [DGSHAPE 3Shape CAM Produce Quick Guide](https://dgshape.com/wp-content/uploads/2025/07/3Shape-CAM-Produce-Quick-Guide-ENG.pdf) — the named V25.1.0 software screen, VITA SUPRINITY PC LS-14 stock dimensions and machine job workflow.
- [Official DGSHAPE CAM Download Center](https://downloadcenter.rolanddg.com/DGSHAPE_CAM_for_DWX-43W) — live installer/updater and software manuals; exact revision must be confirmed from the actual installation.
- [DWX-43W installation guide](https://downloadcenter.rolanddg.com/contents/manuals/DWX-43W_INS_EN/aoy1711959356873.html) — directs users to the manufacturer download center for CAM, driver and VPanel installer/updaters.
- [DGSHAPE DWX-43W brochure](https://dgshape.com/wp-content/uploads/2025/02/DWX-43W-Brochure-EN.pdf) — supported machine and tool catalogue, including tool tip dimensions.

The numeric dimensions above are transcription of manufacturer-published specifications, not measurements of an individual machine, tool, blank or cut part. Review the live manufacturer instructions for the actual installation before use.
