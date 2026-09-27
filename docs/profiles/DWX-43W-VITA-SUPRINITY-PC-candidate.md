# Candidate milling route: DWX-43W / VITA SUPRINITY PC

This is a manufacturer-sourced **blocked candidate route**, not a validated procad machine or material profile. The application does not generate a machine file, toolpath, nesting placement, or simulation for this setup. It remains a review-file handoff to external CAM.

## Selected public route

- Machine: DGSHAPE DWX-43W, wet 4-axis dental mill.
- CAM: DGSHAPE CAM for DWX-43W. DGSHAPE's update history listed 2025 V25.1.7, dated 2026-05-29, as its newest updater on 2026-09-27. The actual installed build, machine definition, and license are unknown until read from the target CAM installation and Support screen.
- Historical CAM material-library evidence: a DGSHAPE-hosted V25.1.0 quick guide displays a VITA SUPRINITY PC `LS-14` CAM stock-library row at 18 × 14.3 × 12.2 mm. This is a CAM library identifier and nominal CAM dimensions only; it does not establish a physical blank SKU or prove the row still exists in V25.1.7.
- Physical material evidence: VITA's current product page identifies a `PC-14` blank geometry at 12 × 14 × 18 mm. That page's current system-partner list names DGSHAPE DWX-4W but not DWX-43W. The `PC-14` and `LS-14` labels and dimensions must remain distinct until the actual packaged blank and the machine/CAM compatibility are confirmed by the manufacturers and the lab.
- Fixture/workholding: pin-type block. DWX-43W supports multiple blocks subject to stock-size and machine setup constraints; that does not supply a verified six-position nesting map. The candidate record intentionally has no pin-position transform or collision model.
- Tool family: manufacturer-listed ZGB/ZGB2 wet grinding burs. The candidate JSON records the published tip radii/diameters and manufacturer glass-ceramic replacement-time guidance. It leaves stocker positions blank because those depend on the actual machine setup.

## What this profile does

It gives the project one route to investigate, records sourced configuration facts, and makes contradictory identifiers visible. It is not a qualified material/machine combination, controller profile, postprocessor, milling strategy, blank-lot recipe, collision model, or physical validation record. `CANDIDATE_UNVALIDATED` and `BLOCKED_NO_MACHINE_VALIDATION` are intentional. The manufacturing gate must remain blocked.

The selected machine uses a pin-block/multi-pin fixture workflow. This is not disk nesting. A multi-pin placement preview would still require the actual fixture coordinate map and collision model. No placement coordinates are inferred here.

## Required before a validated release

1. Confirm the exact machine serial, firmware, spindle, fixture/holder, installed tools and positions, and machine correction state.
2. Resolve whether the physical VITA blank available to the lab is supported by the exact DWX-43W setup; reconcile the `PC-14` package and CAM `LS-14` entry with VITA and DGSHAPE. Record SKU, shade, lot, measured dimensions, orientation, and current instructions.
3. Confirm the installed, licensed DGSHAPE CAM version, machine definition (including whether the HQ ZGB2 definition applies), exact stock entry, tool set/slots/wear, strategy, and CNC output identity. procad does not implement or replace that CAM product.
4. Run the complete CAM kinematic simulation. Save evidence that identifies the job and reports errors/collisions. DGSHAPE warns that shortening or interrupting simulation leaves collisions in the unrun portion unchecked.
5. Verify the exact fixture position and rotary motion, bur reach, machine/fixture collisions, and the full downstream material process. SUPRINITY PC requires product-specific crystallization and finishing; use its current instructions and a calibrated, qualified furnace rather than treating the CAM output as a finished restoration.
6. Cut representative, authorized cases and inspect them independently against prespecified margin, fit, surface, and occlusion references. Record uncertainty and failed jobs; follow ISO 23298 machining-accuracy methods as appropriate.
7. Obtain qualified clinical, laboratory, machine-owner, and regulatory/QMS review before any product or manufacturing claim.

## Primary sources

- [DGSHAPE DWX-43W product page](https://dgshape.com/dwx-43w/) — wet milling process, compatible application/material families, six pin-type workpieces, machine overview and bundled CAM.
- [DWX-43W User's Manual](https://downloadcenter.rolanddg.com/contents/manuals/DWX-43W_USE_EN.pdf) — workpiece limitations, tool-management and replacement guidance.
- [DGSHAPE 3Shape CAM Produce Quick Guide](https://dgshape.com/wp-content/uploads/2025/07/3Shape-CAM-Produce-Quick-Guide-ENG.pdf) — the named V25.1.0 software screen, VITA SUPRINITY PC LS-14 stock dimensions and machine job workflow.
- [Official DGSHAPE updater history](https://downloadcenter.rolanddg.com/softwareparts.php?id=dadd2c5ebadf868baa36f3287b3e2363ce64a6ab&item_id=108c72d8fd63d19dc030f6f6bc0e0bde72c3c4c2&software=1f14761f400e6f7c8696a594d63e6dfa60dfd553&type=note_history_html) — lists CAM V25.1.7 dated 2026-05-29 and the V25.1.6 glass-ceramic high-quality option for the DWX-43W HQ ZGB2 definition.
- [DGSHAPE CAM kinematic simulation help](https://downloadcenter.rolanddg.com/contents/manuals/DGSHAPE_CAM_for_DWX-43W_USE_EN/cei1731550195730.html) — documents the post-toolpath kinematic simulation, stock/fixture/tool display, collision/error pane, and warning that interrupted runs do not check the unrun part for collisions.
- [VITA SUPRINITY PC product details](https://www.vita-zahnfabrik.com/pdb_ccdc92_en.html_us) — lists physical PC-14 dimensions and system partners; current partner table names DWX-4W and not DWX-43W.
- [VITA SUPRINITY PC firing parameters](https://mam.vita-zahnfabrik.com/portal/ecms_mdb_download.php?id=82430&neuste_version=1&sprache=en) — material-specific post-milling firing guidance. Confirm the latest instructions and exact furnace.
- [ISO 23298:2023](https://www.iso.org/standard/75167.html) — test methods for dental CAM milling-machine machining accuracy.
- [Official DGSHAPE CAM Download Center](https://downloadcenter.rolanddg.com/DGSHAPE_CAM_for_DWX-43W) — live installer/updater and software manuals; exact revision must be confirmed from the actual installation.
- [DWX-43W installation guide](https://downloadcenter.rolanddg.com/contents/manuals/DWX-43W_INS_EN/aoy1711959356873.html) — directs users to the manufacturer download center for CAM, driver and VPanel installer/updaters.
- [DGSHAPE DWX-43W brochure](https://dgshape.com/wp-content/uploads/2025/02/DWX-43W-Brochure-EN.pdf) — supported machine and tool catalogue, including tool tip dimensions.

The numeric dimensions above are transcriptions of manufacturer-published specifications, not measurements of an individual machine, tool, blank, or cut part. The two blank identifiers are deliberately not mapped. Recheck live manufacturer pages and the installed CAM before any real-world evaluation.
