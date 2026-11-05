use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Dentition { Permanent, Primary }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Arch { Maxillary, Mandibular }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToothKind { Incisor, Canine, Premolar, Molar }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tooth {
    /// FDI/ISO 3950 two-digit designation.
    pub fdi: u8,
    /// Universal Numbering System number; present for permanent dentition.
    pub universal: Option<u8>,
    /// Universal letter notation; present for primary dentition.
    pub primary_universal: Option<char>,
    pub quadrant: u8,
    /// Position counted from the midline (1 is the central incisor).
    pub position: u8,
    pub dentition: Dentition,
    pub arch: Arch,
    pub kind: ToothKind,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ToothNumberError {
    #[error("unsupported FDI tooth number: {0}")]
    InvalidFdi(u8),
    #[error("universal tooth number must be in 1..=32, got {0}")]
    InvalidUniversal(u8),
}

pub fn tooth_from_fdi(fdi: u8) -> Result<Tooth, ToothNumberError> {
    let quadrant = fdi / 10;
    let position = fdi % 10;
    let dentition = match quadrant {
        1..=4 if (1..=8).contains(&position) => Dentition::Permanent,
        5..=8 if (1..=5).contains(&position) => Dentition::Primary,
        _ => return Err(ToothNumberError::InvalidFdi(fdi)),
    };
    let arch = if matches!(quadrant, 1 | 2 | 5 | 6) { Arch::Maxillary } else { Arch::Mandibular };
    let kind = match (dentition, position) {
        (_, 1 | 2) => ToothKind::Incisor,
        (_, 3) => ToothKind::Canine,
        (Dentition::Permanent, 4 | 5) => ToothKind::Premolar,
        (Dentition::Primary, 4 | 5) | (Dentition::Permanent, 6..=8) => ToothKind::Molar,
        _ => return Err(ToothNumberError::InvalidFdi(fdi)),
    };

    let (universal, primary_universal) = match quadrant {
        1 => (Some(19 - fdi), None),
        2 => (Some(fdi - 12), None),
        3 => (Some(55 - fdi), None),
        4 => (Some(fdi - 16), None),
        5 => (None, "EDCBA".chars().nth((position - 1) as usize)),
        6 => (None, "FGHIJ".chars().nth((position - 1) as usize)),
        7 => (None, "ONMLK".chars().nth((position - 1) as usize)),
        8 => (None, "PQRST".chars().nth((position - 1) as usize)),
        _ => return Err(ToothNumberError::InvalidFdi(fdi)),
    };

    Ok(Tooth { fdi, universal, primary_universal, quadrant, position, dentition, arch, kind })
}

pub fn tooth_from_universal(number: u8) -> Result<Tooth, ToothNumberError> {
    let fdi = match number {
        1..=8 => 19 - number,
        9..=16 => number + 12,
        17..=24 => 55 - number,
        25..=32 => number + 16,
        _ => return Err(ToothNumberError::InvalidUniversal(number)),
    };
    tooth_from_fdi(fdi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_permanent_fdi_to_universal_in_all_quadrants() {
        assert_eq!(tooth_from_fdi(18).unwrap().universal, Some(1));
        assert_eq!(tooth_from_fdi(11).unwrap().universal, Some(8));
        assert_eq!(tooth_from_fdi(21).unwrap().universal, Some(9));
        assert_eq!(tooth_from_fdi(38).unwrap().universal, Some(17));
        assert_eq!(tooth_from_fdi(31).unwrap().universal, Some(24));
        assert_eq!(tooth_from_fdi(41).unwrap().universal, Some(25));
        assert_eq!(tooth_from_universal(32).unwrap().fdi, 48);
    }

    #[test]
    fn maps_primary_fdi_to_universal_letters() {
        assert_eq!(tooth_from_fdi(55).unwrap().primary_universal, Some('A'));
        assert_eq!(tooth_from_fdi(51).unwrap().primary_universal, Some('E'));
        assert_eq!(tooth_from_fdi(61).unwrap().primary_universal, Some('F'));
        assert_eq!(tooth_from_fdi(71).unwrap().primary_universal, Some('O'));
        assert_eq!(tooth_from_fdi(81).unwrap().primary_universal, Some('P'));
        assert_eq!(tooth_from_fdi(85).unwrap().primary_universal, Some('T'));
    }

    #[test]
    fn every_permanent_universal_number_round_trips_to_fdi() {
        for number in 1..=32 {
            let tooth = tooth_from_universal(number).unwrap();
            assert_eq!(tooth.universal, Some(number));
        }
    }

    #[test]
    fn rejects_invalid_fdi_numbers() {
        assert_eq!(tooth_from_fdi(19), Err(ToothNumberError::InvalidFdi(19)));
        assert_eq!(tooth_from_fdi(49), Err(ToothNumberError::InvalidFdi(49)));
        assert_eq!(tooth_from_fdi(54).unwrap().kind, ToothKind::Molar);
    }
}
