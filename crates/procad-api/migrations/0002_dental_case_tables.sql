PRAGMA foreign_keys = ON;

-- Structured odontogram. FDI is the canonical key; Universal notation is
-- derived by procad-core and stored only as a searchable snapshot.
CREATE TABLE case_teeth (
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    fdi INTEGER NOT NULL CHECK (
        (fdi BETWEEN 11 AND 18) OR (fdi BETWEEN 21 AND 28) OR
        (fdi BETWEEN 31 AND 38) OR (fdi BETWEEN 41 AND 48) OR
        (fdi BETWEEN 51 AND 55) OR (fdi BETWEEN 61 AND 65) OR
        (fdi BETWEEN 71 AND 75) OR (fdi BETWEEN 81 AND 85)
    ),
    universal INTEGER,
    primary_universal TEXT,
    arch TEXT NOT NULL CHECK (arch IN ('maxillary', 'mandibular')),
    dentition TEXT NOT NULL CHECK (dentition IN ('permanent', 'primary')),
    tooth_kind TEXT NOT NULL CHECK (tooth_kind IN ('incisor', 'canine', 'premolar', 'molar')),
    restoration_type TEXT NOT NULL DEFAULT 'none'
        CHECK (restoration_type IN ('none', 'crown', 'inlay', 'onlay', 'veneer',
            'bridge_abutment', 'bridge_pontic', 'implant_crown', 'implant_abutment', 'denture_tooth')),
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (case_id, fdi)
);

CREATE TABLE scan_assets (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('stl', 'obj', 'ply', 'off', 'xyz', 'pts', 'csv', 'pcd')),
    source_units TEXT NOT NULL CHECK (source_units IN ('millimeter', 'centimeter', 'meter', 'inch')),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    intake_status TEXT NOT NULL CHECK (intake_status IN ('validated_mesh', 'recognized_awaiting_parser', 'point_cloud_awaiting_parser')),
    storage_key TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX scan_assets_case ON scan_assets(case_id, created_at);

CREATE TABLE design_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    artifact_sha256 TEXT NOT NULL CHECK (length(artifact_sha256) = 64),
    geometry_engine TEXT NOT NULL,
    geometry_engine_version TEXT NOT NULL,
    design_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'ready_for_review', 'rejected', 'approved')),
    authored_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (case_id, revision_number)
);

CREATE TABLE clinical_approvals (
    id TEXT PRIMARY KEY NOT NULL,
    design_revision_id TEXT NOT NULL REFERENCES design_revisions(id),
    reviewer_id TEXT NOT NULL REFERENCES users(id),
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (design_revision_id, reviewer_id)
);

CREATE TABLE external_library_assets (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL REFERENCES dental_libraries(id),
    asset_name TEXT NOT NULL,
    source_asset_url TEXT NOT NULL,
    license_snapshot TEXT NOT NULL,
    attribution_text TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    local_storage_key TEXT NOT NULL,
    imported_by TEXT NOT NULL REFERENCES users(id),
    imported_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (source_id, sha256)
);

-- An asset row is metadata only. The source license, attribution and checksum
-- remain attached to each imported object; vendor libraries are not preloaded.
