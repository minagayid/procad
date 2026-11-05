use crate::mesh::{Mesh, MeshError, MeshStats, SourceUnit};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const MAX_SCAN_BYTES: usize = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanFormat {
    Stl,
    Obj,
    Ply,
    Off,
    Xyz,
    Pts,
    Csv,
    Pcd,
}

impl ScanFormat {
    pub fn from_filename(name: &str) -> Result<Self, ScanError> {
        let extension = name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
        match extension.as_str() {
            "stl" => Ok(Self::Stl),
            "obj" => Ok(Self::Obj),
            "ply" => Ok(Self::Ply),
            "off" => Ok(Self::Off),
            "xyz" => Ok(Self::Xyz),
            "pts" => Ok(Self::Pts),
            "csv" => Ok(Self::Csv),
            "pcd" => Ok(Self::Pcd),
            _ => Err(ScanError::UnsupportedFormat),
        }
    }

    pub const fn is_point_cloud(self) -> bool {
        matches!(self, Self::Xyz | Self::Pts | Self::Csv | Self::Pcd)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanProcessing {
    ValidatedMesh { stats: MeshStats },
    RecognizedAwaitingParser,
    PointCloudAwaitingParser,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScanRecord {
    pub original_filename: String,
    pub format: ScanFormat,
    pub source_units: SourceUnit,
    pub normalized_units: SourceUnit,
    pub byte_length: usize,
    pub sha256: String,
    pub processing: ScanProcessing,
}

#[derive(Debug, Error, PartialEq)]
pub enum ScanError {
    #[error("unsupported scan file extension")]
    UnsupportedFormat,
    #[error("scan file is empty")]
    EmptyFile,
    #[error("scan file exceeds the configured intake limit")]
    FileTooLarge,
    #[error("scan filename must not contain a path")]
    InvalidFilename,
    #[error(transparent)]
    Mesh(#[from] MeshError),
}

/// Intake validates the filename, size, source units and integrity hash.
/// STL and OBJ are parsed and geometrically validated in this Rust crate.
/// PLY/OFF and point-cloud formats are only classified here; the existing
/// application importer remains responsible for those until their Rust parsers land.
pub fn ingest_scan(
    filename: &str,
    bytes: &[u8],
    source_units: SourceUnit,
) -> Result<(ScanRecord, Option<Mesh>), ScanError> {
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename == "."
        || filename == ".."
    {
        return Err(ScanError::InvalidFilename);
    }
    if bytes.is_empty() {
        return Err(ScanError::EmptyFile);
    }
    if bytes.len() > MAX_SCAN_BYTES {
        return Err(ScanError::FileTooLarge);
    }
    let format = ScanFormat::from_filename(filename)?;
    let hash = hex::encode(Sha256::digest(bytes));
    let (processing, mesh) = match format {
        ScanFormat::Stl => {
            let mesh = Mesh::from_stl(bytes, source_units)?;
            let stats = mesh.validate()?;
            (ScanProcessing::ValidatedMesh { stats }, Some(mesh))
        }
        ScanFormat::Obj => {
            let text = std::str::from_utf8(bytes)
                .map_err(|error| ScanError::Mesh(MeshError::InvalidFormat(error.to_string())))?;
            let mesh = Mesh::from_obj(text, source_units)?;
            let stats = mesh.validate()?;
            (ScanProcessing::ValidatedMesh { stats }, Some(mesh))
        }
        value if value.is_point_cloud() => (ScanProcessing::PointCloudAwaitingParser, None),
        _ => (ScanProcessing::RecognizedAwaitingParser, None),
    };
    Ok((
        ScanRecord {
            original_filename: filename.to_owned(),
            format,
            source_units,
            normalized_units: if mesh.is_some() {
                SourceUnit::Millimeter
            } else {
                source_units
            },
            byte_length: bytes.len(),
            sha256: hash,
            processing,
        },
        mesh,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASCII_STL: &str = "solid tri
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid tri
";

    #[test]
    fn intake_hashes_and_validates_stl_meshes() {
        let (record, mesh) = ingest_scan("scan.stl", ASCII_STL.as_bytes(), SourceUnit::Inch).unwrap();
        assert_eq!(record.format, ScanFormat::Stl);
        assert_eq!(record.normalized_units, SourceUnit::Millimeter);
        assert_eq!(record.sha256.len(), 64);
        assert_eq!(mesh.unwrap().stats().unwrap().triangle_count, 1);
    }

    #[test]
    fn point_clouds_are_not_misrepresented_as_meshes() {
        let (record, mesh) = ingest_scan("arch.xyz", b"0 0 0\n1 0 0\n", SourceUnit::Millimeter).unwrap();
        assert_eq!(record.processing, ScanProcessing::PointCloudAwaitingParser);
        assert!(mesh.is_none());
    }

    #[test]
    fn rejects_paths_and_unknown_formats() {
        assert_eq!(
            ingest_scan("../patient.stl", ASCII_STL.as_bytes(), SourceUnit::Millimeter),
            Err(ScanError::InvalidFilename)
        );
        assert_eq!(
            ScanFormat::from_filename("model.dcm"),
            Err(ScanError::UnsupportedFormat)
        );
    }
}
