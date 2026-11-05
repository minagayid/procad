//! Rust domain and geometry foundation for procad.
//!
//! This crate separates dental-domain rules from UI, persistence and
//! machine-specific integrations. Mesh operations are engineering primitives,
//! not a clinically validated restoration-design system.

pub mod dental;
pub mod libraries;
pub mod mesh;
pub mod scan;
pub mod workflow;

pub use dental::{Dentition, Tooth, ToothKind, tooth_from_fdi, tooth_from_universal};
pub use mesh::{BoundingBox, Mesh, MeshError, MeshStats, Point3, SourceUnit, Triangle};
