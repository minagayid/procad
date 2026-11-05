# Dental reference and data library catalog

The catalog is machine-readable at `app/public/dental-library/catalog.json`.

## Imported anatomical reference

**BodyParts3D / Anatomography 4.3, adapted by OrganUI.** The pinned asset contains 33 structures: 28 permanent teeth, two gingiva structures and three jaw-bone structures. It is a useful starting point for an anatomy viewer, picking, segmentation experiments and visualization, not a restoration-ready tooth morphology library.

The GLB is 1,518,540 bytes and its SHA-256 is pinned in the catalog. Run `bash scripts/import_bodyparts3d.sh` to download it into `app/public/dental-library/bodyparts3d-teeth-4.3/teeth.glb`. The import script verifies the exact checksum before installing it. The model itself is not included in this commit; the script gives maintainers a reproducible, explicit import path.

Required credit:

> BodyParts3D / Anatomography, © The Database Center for Life Science (DBCLS). Adapted by OrganUI.

The model is licensed **CC BY-SA 2.1 Japan**, separate from the MIT license on the application code. Keep the attribution, license link and modification notice with any redistributed copy and review the ShareAlike obligations for derivatives. See [the upstream attribution](https://github.com/organui/teeth-3d/blob/f2cfe96f19dba7ec3982f2b06e6a34a1f6670450/public/models/ATTRIBUTION.md) and [model provenance](https://github.com/organui/teeth-3d/blob/f2cfe96f19dba7ec3982f2b06e6a34a1f6670450/docs/MODEL_PROVENANCE.md).

**Coverage gaps:** it contains no third molars or primary teeth, no enamel/dentine/pulp segmentation, and no individual material or manufacturing settings. It has not been independently anatomically reviewed for clinical use. It must not be represented as a manufacturer-validated implant, scan-body, abutment, crown, bridge, aligner or denture library.

## Research-only CBCT data

**ToothFairy2** is listed for research discovery only. Its training set is CC BY-NC-SA 4.0 and download requires registration. The non-commercial restriction means it must not be included in commercial product distributions or commercial training pipelines without separate permission. No data is bundled or downloaded by procad.

## Domain catalog included in Rust

The Rust core includes an original FDI/Universal tooth-number crosswalk for permanent and primary dentition. The code is not a substitute for an independently reviewed dental terminology standard or a clinician-reviewed odontogram.

## Vendor libraries

Commercial vendor libraries (implant systems, scan bodies, Ti-bases, abutments, blanks, milling tools and restorative morphology libraries) are not automatically open source. procad stores provenance and license metadata for imported assets but must not scrape, redistribute or ship a vendor library without documented rights and a compatible license.

## Adding another library

Every asset must include source URL, exact version/commit, license identifier and link, required attribution, modification notice, SHA-256, file size, coverage and permitted use. Assets with non-commercial terms must be isolated from commercial build artefacts. Do not put patient scans or private clinic exports in this public repository.
