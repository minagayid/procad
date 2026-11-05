PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'clinician', 'technician', 'viewer')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX sessions_token_expiry ON sessions(token_hash, expires_at);

-- Patient references are pseudonymous by design. Keep direct identifiers and
-- clinical records in a separately governed deployment-specific system.
CREATE TABLE patients (
    id TEXT PRIMARY KEY NOT NULL,
    patient_ref TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE cases (
    id TEXT PRIMARY KEY NOT NULL,
    patient_id TEXT NOT NULL REFERENCES patients(id),
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'intake'
        CHECK (stage IN ('intake', 'scanning', 'design', 'review', 'clinically_approved', 'rejected')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX cases_patient ON cases(patient_id, created_at);

CREATE TABLE case_events (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id),
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE dental_libraries (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    license_url TEXT NOT NULL,
    source_url TEXT NOT NULL,
    commercial_use INTEGER NOT NULL CHECK (commercial_use IN (0, 1)),
    bundled_geometry INTEGER NOT NULL DEFAULT 0 CHECK (bundled_geometry IN (0, 1))
);

INSERT INTO dental_libraries
(id, name, version, license, license_url, source_url, commercial_use, bundled_geometry)
VALUES
('fdi-tooth-catalog-v1', 'FDI and Universal tooth numbering catalog', '1.0.0',
 'MIT (procad-authored mapping data)', 'https://opensource.org/license/mit',
 'https://www.iso.org/standard/68292.html', 1, 0),
('bodyparts3d-adult-dentition', 'BodyParts3D adult dentition reference', '4.3',
 'CC BY-SA 2.1 Japan', 'https://creativecommons.org/licenses/by-sa/2.1/jp/',
 'https://github.com/organui/teeth-3d', 1, 0),
('toothfairy2-cbct-research', 'ToothFairy2 CBCT research dataset', '2024',
 'CC BY-NC-SA 4.0', 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
 'https://toothfairy2.grand-challenge.org/dataset/', 0, 0);
