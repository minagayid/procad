use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    Clinician,
    Technician,
    Viewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaseStage {
    Intake,
    Scanning,
    Design,
    Review,
    ClinicallyApproved,
    Rejected,
}

impl CaseStage {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Intake => "intake",
            Self::Scanning => "scanning",
            Self::Design => "design",
            Self::Review => "review",
            Self::ClinicallyApproved => "clinically_approved",
            Self::Rejected => "rejected",
        }
    }
}

impl std::str::FromStr for CaseStage {
    type Err = WorkflowError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "intake" => Ok(Self::Intake),
            "scanning" => Ok(Self::Scanning),
            "design" => Ok(Self::Design),
            "review" => Ok(Self::Review),
            "clinically_approved" => Ok(Self::ClinicallyApproved),
            "rejected" => Ok(Self::Rejected),
            _ => Err(WorkflowError::UnknownStage),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TransitionContext<'a> {
    pub actor_id: &'a str,
    pub case_creator_id: &'a str,
    pub role: UserRole,
    pub reason: &'a str,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WorkflowError {
    #[error("unknown case stage")]
    UnknownStage,
    #[error("transition is not permitted")]
    TransitionNotAllowed,
    #[error("role is not permitted to perform this transition")]
    InsufficientRole,
    #[error("clinical approval requires a reviewer different from the case creator")]
    SeparationOfDuties,
    #[error("a non-empty reason is required")]
    ReasonRequired,
}

/// Enforces a conservative, auditable design/review state machine.
/// There is intentionally no transition to CAM or machine dispatch in this version.
pub fn authorize_transition(
    from: CaseStage,
    to: CaseStage,
    context: &TransitionContext<'_>,
) -> Result<(), WorkflowError> {
    if context.reason.trim().is_empty() {
        return Err(WorkflowError::ReasonRequired);
    }
    match (from, to) {
        (CaseStage::Intake, CaseStage::Scanning)
        | (CaseStage::Scanning, CaseStage::Design) => {
            if matches!(context.role, UserRole::Clinician | UserRole::Technician | UserRole::Admin) {
                Ok(())
            } else {
                Err(WorkflowError::InsufficientRole)
            }
        }
        (CaseStage::Design, CaseStage::Review) => {
            if matches!(context.role, UserRole::Clinician | UserRole::Admin) {
                Ok(())
            } else {
                Err(WorkflowError::InsufficientRole)
            }
        }
        (CaseStage::Review, CaseStage::Design) => {
            if matches!(context.role, UserRole::Clinician | UserRole::Technician | UserRole::Admin) {
                Ok(())
            } else {
                Err(WorkflowError::InsufficientRole)
            }
        }
        (CaseStage::Review, CaseStage::ClinicallyApproved) => {
            if context.role != UserRole::Clinician {
                return Err(WorkflowError::InsufficientRole);
            }
            if context.actor_id == context.case_creator_id {
                return Err(WorkflowError::SeparationOfDuties);
            }
            Ok(())
        }
        (CaseStage::Intake | CaseStage::Scanning | CaseStage::Design | CaseStage::Review, CaseStage::Rejected) => {
            if matches!(context.role, UserRole::Clinician | UserRole::Admin) {
                Ok(())
            } else {
                Err(WorkflowError::InsufficientRole)
            }
        }
        _ => Err(WorkflowError::TransitionNotAllowed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_requires_a_second_clinician() {
        let same_person = TransitionContext {
            actor_id: "clinician-a",
            case_creator_id: "clinician-a",
            role: UserRole::Clinician,
            reason: "reviewed",
        };
        assert_eq!(
            authorize_transition(CaseStage::Review, CaseStage::ClinicallyApproved, &same_person),
            Err(WorkflowError::SeparationOfDuties)
        );
        let second_person = TransitionContext { actor_id: "clinician-b", ..same_person };
        assert_eq!(
            authorize_transition(CaseStage::Review, CaseStage::ClinicallyApproved, &second_person),
            Ok(())
        );
    }

    #[test]
    fn independent_clinician_can_return_review_to_design_for_rework() {
        let context = TransitionContext {
            actor_id: "clinician-b",
            case_creator_id: "clinician-a",
            role: UserRole::Clinician,
            reason: "revision required",
        };
        assert_eq!(
            authorize_transition(CaseStage::Review, CaseStage::Design, &context),
            Ok(())
        );
    }

    #[test]
    fn administrator_cannot_sign_clinical_approval_without_clinician_role() {
        let context = TransitionContext {
            actor_id: "admin",
            case_creator_id: "clinician",
            role: UserRole::Admin,
            reason: "reviewed",
        };
        assert_eq!(
            authorize_transition(CaseStage::Review, CaseStage::ClinicallyApproved, &context),
            Err(WorkflowError::InsufficientRole)
        );
    }

    #[test]
    fn technician_cannot_sign_clinical_approval() {
        let context = TransitionContext {
            actor_id: "tech",
            case_creator_id: "clinician",
            role: UserRole::Technician,
            reason: "looks fine",
        };
        assert_eq!(
            authorize_transition(CaseStage::Review, CaseStage::ClinicallyApproved, &context),
            Err(WorkflowError::InsufficientRole)
        );
    }

    #[test]
    fn viewer_cannot_move_a_case() {
        let context = TransitionContext {
            actor_id: "viewer",
            case_creator_id: "clinician",
            role: UserRole::Viewer,
            reason: "please",
        };
        assert_eq!(
            authorize_transition(CaseStage::Intake, CaseStage::Scanning, &context),
            Err(WorkflowError::InsufficientRole)
        );
    }
}
