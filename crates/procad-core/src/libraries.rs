use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseScope {
    BuiltInDomainCatalog,
    AttributionShareAlike,
    ResearchNonCommercial,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LibrarySource {
    pub id: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub license: &'static str,
    pub license_url: &'static str,
    pub source_url: &'static str,
    pub scope: LicenseScope,
    pub bundled_geometry: bool,
    pub notes: &'static str,
}

impl LibrarySource {
    pub const fn allows_commercial_use(&self) -> bool {
        !matches!(self.scope, LicenseScope::ResearchNonCommercial)
    }
}

/// License-aware source registry. Geometry files are deliberately not silently
/// downloaded or redistributed; the user must import the source asset and preserve
/// its exact license, version, attribution and checksum.
pub fn library_sources() -> Vec<LibrarySource> {
    vec![
        LibrarySource {
            id: "fdi-tooth-catalog-v1",
            name: "FDI permanent and primary tooth numbering catalog",
            version: "1.0.0",
            license: "MIT (procad-authored mapping data)",
            license_url: "https://opensource.org/license/mit",
            source_url: "https://www.iso.org/standard/68292.html",
            scope: LicenseScope::BuiltInDomainCatalog,
            bundled_geometry: false,
            notes: "Built-in tooth identifiers and FDI/Universal crosswalk; contains no patient data or restorative geometry.",
        },
        LibrarySource {
            id: "bodyparts3d-adult-dentition",
            name: "BodyParts3D adult teeth, gums and jaws reference",
            version: "4.3 (source model family)",
            license: "CC BY-SA 2.1 Japan",
            license_url: "https://creativecommons.org/licenses/by-sa/2.1/jp/",
            source_url: "https://github.com/organui/teeth-3d",
            scope: LicenseScope::AttributionShareAlike,
            bundled_geometry: false,
            notes: "External anatomical reference. Import the model from its authoritative source and retain its attribution/share-alike obligations. Educational anatomy is not a tooth-restoration library or a validated clinical design.",
        },
        LibrarySource {
            id: "toothfairy2-cbct-research",
            name: "ToothFairy2 annotated CBCT training dataset",
            version: "2024 challenge release",
            license: "CC BY-NC-SA 4.0",
            license_url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
            source_url: "https://toothfairy2.grand-challenge.org/dataset/",
            scope: LicenseScope::ResearchNonCommercial,
            bundled_geometry: false,
            notes: "Registration required; non-commercial research use only. Do not use in commercial workflows or distribute this dataset inside a commercial build.",
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noncommercial_training_data_is_not_marked_for_commercial_use() {
        let sources = library_sources();
        let toothfairy = sources.iter().find(|source| source.id == "toothfairy2-cbct-research").unwrap();
        let anatomy = sources.iter().find(|source| source.id == "bodyparts3d-adult-dentition").unwrap();
        assert!(!toothfairy.allows_commercial_use());
        assert!(anatomy.allows_commercial_use());
        assert!(!anatomy.bundled_geometry);
    }
}
