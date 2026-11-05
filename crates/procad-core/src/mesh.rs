use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

const MAX_STL_TRIANGLES: usize = 10_000_000;
const DEGENERATE_AREA_EPSILON: f64 = 1.0e-12;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    fn is_finite(self) -> bool { self.x.is_finite() && self.y.is_finite() && self.z.is_finite() }
    fn sub(self, other: Self) -> Self { Self::new(self.x - other.x, self.y - other.y, self.z - other.z) }
    fn cross(self, other: Self) -> Self {
        Self::new(self.y * other.z - self.z * other.y, self.z * other.x - self.x * other.z, self.x * other.y - self.y * other.x)
    }
    fn dot(self, other: Self) -> f64 { self.x * other.x + self.y * other.y + self.z * other.z }
    fn length(self) -> f64 { self.dot(self).sqrt() }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceUnit { Millimeter, Centimeter, Meter, Inch }

impl SourceUnit {
    pub const fn millimeter_scale(self) -> f64 {
        match self { Self::Millimeter => 1.0, Self::Centimeter => 10.0, Self::Meter => 1000.0, Self::Inch => 25.4 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Triangle(pub [u32; 3]);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mesh {
    pub vertices: Vec<Point3>,
    pub triangles: Vec<Triangle>,
    pub units: SourceUnit,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoundingBox { pub min: Point3, pub max: Point3 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeshStats {
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub surface_area_mm2: f64,
    pub signed_volume_mm3: f64,
    pub bounds: BoundingBox,
    pub boundary_edges: usize,
    pub non_manifold_edges: usize,
    pub inconsistent_winding_edges: usize,
    pub degenerate_triangles: usize,
    pub watertight: bool,
}

#[derive(Debug, Error, PartialEq)]
pub enum MeshError {
    #[error("mesh contains no triangles")]
    EmptyMesh,
    #[error("mesh contains a non-finite vertex at index {0}")]
    NonFiniteVertex(usize),
    #[error("triangle {triangle} references missing vertex {vertex}")]
    InvalidIndex { triangle: usize, vertex: u32 },
    #[error("triangle {0} contains repeated vertex indices")]
    RepeatedVertex(usize),
    #[error("triangle {0} has zero or near-zero area")]
    DegenerateTriangle(usize),
    #[error("STL input is not valid UTF-8 ASCII or a valid binary STL")]
    InvalidStl,
    #[error("STL declares too many triangles")]
    TooManyTriangles,
    #[error("mesh format is unsupported or malformed: {0}")]
    InvalidFormat(String),
    #[error("scale must be finite and non-zero")]
    InvalidScale,
    #[error("closed solid required; found {boundary_edges} boundary, {non_manifold_edges} non-manifold and {inconsistent_winding_edges} inconsistently oriented edges")]
    NotClosedSolid { boundary_edges: usize, non_manifold_edges: usize, inconsistent_winding_edges: usize },
}

impl Mesh {
    pub fn new(mut vertices: Vec<Point3>, triangles: Vec<Triangle>, units: SourceUnit) -> Result<Self, MeshError> {
        let scale = units.millimeter_scale();
        for vertex in &mut vertices {
            vertex.x *= scale;
            vertex.y *= scale;
            vertex.z *= scale;
        }
        let mesh = Self { vertices, triangles, units: SourceUnit::Millimeter };
        mesh.validate()?;
        Ok(mesh)
    }

    /// STL has no reliable unit field: callers must supply the source unit explicitly.
    pub fn from_stl(bytes: &[u8], source_unit: SourceUnit) -> Result<Self, MeshError> {
        let ascii_candidate = std::str::from_utf8(bytes).ok().is_some_and(|text| text.lines().any(|line| line.trim_start().starts_with("vertex ")));
        let mesh = if ascii_candidate {
            parse_ascii_stl(bytes)?
        } else if let Some(binary) = parse_binary_stl(bytes)? {
            binary
        } else {
            parse_ascii_stl(bytes)?
        };
        Self::new(mesh.vertices, mesh.triangles, source_unit)
    }

    /// Imports OBJ vertex records and polygon faces. Polygon faces are fan-triangulated.
    pub fn from_obj(text: &str, source_unit: SourceUnit) -> Result<Self, MeshError> {
        let mut vertices = Vec::new();
        let mut triangles = Vec::new();
        for (line_index, raw) in text.lines().enumerate() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') { continue; }
            let mut fields = line.split_whitespace();
            match fields.next() {
                Some("v") => {
                    let values = fields.take(3).map(str::parse::<f64>).collect::<Result<Vec<_>, _>>()
                        .map_err(|_| MeshError::InvalidFormat(format!("invalid OBJ vertex on line {}", line_index + 1)))?;
                    if values.len() != 3 {
                        return Err(MeshError::InvalidFormat(format!("OBJ vertex needs 3 coordinates on line {}", line_index + 1)));
                    }
                    vertices.push(Point3::new(values[0], values[1], values[2]));
                }
                Some("f") => {
                    let mut face = Vec::new();
                    for field in fields {
                        let raw_index = field.split('/').next().unwrap_or_default();
                        let parsed = raw_index.parse::<i64>().map_err(|_| MeshError::InvalidFormat(format!("invalid OBJ face index on line {}", line_index + 1)))?;
                        let resolved = if parsed > 0 { parsed - 1 } else if parsed < 0 { vertices.len() as i64 + parsed } else { -1 };
                        if resolved < 0 || resolved >= vertices.len() as i64 {
                            return Err(MeshError::InvalidFormat(format!("OBJ face index out of range on line {}", line_index + 1)));
                        }
                        face.push(resolved as u32);
                    }
                    if face.len() < 3 {
                        return Err(MeshError::InvalidFormat(format!("OBJ face has fewer than 3 vertices on line {}", line_index + 1)));
                    }
                    for index in 1..face.len() - 1 { triangles.push(Triangle([face[0], face[index], face[index + 1]])); }
                }
                _ => {}
            }
        }
        if triangles.is_empty() { return Err(MeshError::EmptyMesh); }
        Self::new(vertices, triangles, source_unit)
    }

    pub fn validate(&self) -> Result<MeshStats, MeshError> {
        if self.triangles.is_empty() { return Err(MeshError::EmptyMesh); }
        for (index, vertex) in self.vertices.iter().copied().enumerate() {
            if !vertex.is_finite() { return Err(MeshError::NonFiniteVertex(index)); }
        }
        self.stats()
    }

    pub fn require_closed_solid(&self) -> Result<MeshStats, MeshError> {
        let stats = self.validate()?;
        if !stats.watertight {
            return Err(MeshError::NotClosedSolid {
                boundary_edges: stats.boundary_edges,
                non_manifold_edges: stats.non_manifold_edges,
                inconsistent_winding_edges: stats.inconsistent_winding_edges,
            });
        }
        Ok(stats)
    }

    pub fn stats(&self) -> Result<MeshStats, MeshError> {
        if self.vertices.is_empty() || self.triangles.is_empty() { return Err(MeshError::EmptyMesh); }
        let mut min = Point3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
        let mut max = Point3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for (index, vertex) in self.vertices.iter().copied().enumerate() {
            if !vertex.is_finite() { return Err(MeshError::NonFiniteVertex(index)); }
            min.x = min.x.min(vertex.x); min.y = min.y.min(vertex.y); min.z = min.z.min(vertex.z);
            max.x = max.x.max(vertex.x); max.y = max.y.max(vertex.y); max.z = max.z.max(vertex.z);
        }

        let mut edges: HashMap<(u32, u32), (usize, usize)> = HashMap::new();
        let mut area = 0.0;
        let mut volume = 0.0;
        for (triangle_index, Triangle(indices)) in self.triangles.iter().enumerate() {
            let [a, b, c] = *indices;
            for vertex in [a, b, c] {
                if vertex as usize >= self.vertices.len() { return Err(MeshError::InvalidIndex { triangle: triangle_index, vertex }); }
            }
            if a == b || b == c || c == a { return Err(MeshError::RepeatedVertex(triangle_index)); }
            let p0 = self.vertices[a as usize]; let p1 = self.vertices[b as usize]; let p2 = self.vertices[c as usize];
            let triangle_area = p1.sub(p0).cross(p2.sub(p0)).length() * 0.5;
            if triangle_area <= DEGENERATE_AREA_EPSILON { return Err(MeshError::DegenerateTriangle(triangle_index)); }
            area += triangle_area;
            volume += p0.dot(p1.cross(p2)) / 6.0;
            for (left, right) in [(a, b), (b, c), (c, a)] {
                let edge = if left < right { (left, right) } else { (right, left) };
                let counts = edges.entry(edge).or_insert((0, 0));
                if left < right { counts.0 += 1; } else { counts.1 += 1; }
            }
        }
        let boundary_edges = edges.values().filter(|&&(forward, reverse)| forward + reverse == 1).count();
        let non_manifold_edges = edges.values().filter(|&&(forward, reverse)| forward + reverse > 2).count();
        let inconsistent_winding_edges = edges.values()
            .filter(|&&(forward, reverse)| forward + reverse == 2 && forward != reverse)
            .count();
        Ok(MeshStats {
            vertex_count: self.vertices.len(), triangle_count: self.triangles.len(),
            surface_area_mm2: area, signed_volume_mm3: volume,
            bounds: BoundingBox { min, max }, boundary_edges, non_manifold_edges,
            inconsistent_winding_edges, degenerate_triangles: 0,
            watertight: boundary_edges == 0 && non_manifold_edges == 0 && inconsistent_winding_edges == 0,
        })
    }

    pub fn translate(&mut self, delta: Point3) -> Result<(), MeshError> {
        if !delta.is_finite() { return Err(MeshError::InvalidFormat("translation must be finite".into())); }
        let mut updated = self.clone();
        for vertex in &mut updated.vertices {
            vertex.x += delta.x;
            vertex.y += delta.y;
            vertex.z += delta.z;
        }
        updated.validate()?;
        self.vertices = updated.vertices;
        Ok(())
    }

    pub fn scale_uniform(&mut self, factor: f64) -> Result<(), MeshError> {
        if !factor.is_finite() || factor == 0.0 { return Err(MeshError::InvalidScale); }
        let mut updated = self.clone();
        for vertex in &mut updated.vertices {
            vertex.x *= factor;
            vertex.y *= factor;
            vertex.z *= factor;
        }
        if factor < 0.0 { updated.reverse_winding(); }
        updated.validate()?;
        self.vertices = updated.vertices;
        self.triangles = updated.triangles;
        Ok(())
    }

    pub fn reverse_winding(&mut self) {
        for Triangle(indices) in &mut self.triangles { indices.swap(1, 2); }
    }
}

fn parse_binary_stl(bytes: &[u8]) -> Result<Option<Mesh>, MeshError> {
    if bytes.len() < 84 { return Ok(None); }
    let count = u32::from_le_bytes(bytes[80..84].try_into().map_err(|_| MeshError::InvalidStl)?) as usize;
    if count > MAX_STL_TRIANGLES { return Ok(None); }
    let required = 84usize.checked_add(count.checked_mul(50).ok_or(MeshError::TooManyTriangles)?).ok_or(MeshError::TooManyTriangles)?;
    if bytes.len() != required { return Ok(None); }
    let mut vertices = Vec::with_capacity(count.saturating_mul(3));
    let mut triangles = Vec::with_capacity(count);
    let mut indices_by_vertex: HashMap<[u64; 3], u32> = HashMap::new();
    for face_index in 0..count {
        let base = 84 + face_index * 50 + 12;
        let mut indices = [0u32; 3];
        for corner in 0..3 {
            let offset = base + corner * 12;
            let read = |start: usize| -> f64 { f32::from_le_bytes(bytes[start..start + 4].try_into().unwrap_or([0; 4])) as f64 };
            let point = Point3::new(read(offset), read(offset + 4), read(offset + 8));
            let key = point_key(point);
            let index = if let Some(index) = indices_by_vertex.get(&key) { *index } else {
                let index = u32::try_from(vertices.len()).map_err(|_| MeshError::TooManyTriangles)?;
                vertices.push(point); indices_by_vertex.insert(key, index); index
            };
            indices[corner] = index;
        }
        triangles.push(Triangle(indices));
    }
    Ok(Some(Mesh { vertices, triangles, units: SourceUnit::Millimeter }))
}

fn parse_ascii_stl(bytes: &[u8]) -> Result<Mesh, MeshError> {
    let text = std::str::from_utf8(bytes).map_err(|_| MeshError::InvalidStl)?;
    let mut vertices = Vec::new();
    for line in text.lines() {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.first().is_some_and(|value| value.eq_ignore_ascii_case("vertex")) {
            if fields.len() != 4 { return Err(MeshError::InvalidStl); }
            let x = fields[1].parse::<f64>().map_err(|_| MeshError::InvalidStl)?;
            let y = fields[2].parse::<f64>().map_err(|_| MeshError::InvalidStl)?;
            let z = fields[3].parse::<f64>().map_err(|_| MeshError::InvalidStl)?;
            vertices.push(Point3::new(x, y, z));
            if vertices.len() / 3 > MAX_STL_TRIANGLES { return Err(MeshError::TooManyTriangles); }
        }
    }
    if vertices.is_empty() || vertices.len() % 3 != 0 { return Err(MeshError::InvalidStl); }
    let mut unique = Vec::new();
    let mut triangles = Vec::with_capacity(vertices.len() / 3);
    let mut indices_by_vertex: HashMap<[u64; 3], u32> = HashMap::new();
    for group in vertices.chunks_exact(3) {
        let mut indices = [0u32; 3];
        for corner in 0..3 {
            let key = point_key(group[corner]);
            let index = if let Some(index) = indices_by_vertex.get(&key) { *index } else {
                let index = u32::try_from(unique.len()).map_err(|_| MeshError::TooManyTriangles)?;
                unique.push(group[corner]); indices_by_vertex.insert(key, index); index
            };
            indices[corner] = index;
        }
        triangles.push(Triangle(indices));
    }
    Ok(Mesh { vertices: unique, triangles, units: SourceUnit::Millimeter })
}

fn point_key(point: Point3) -> [u64; 3] {
    let bits = |value: f64| if value == 0.0 { 0 } else { value.to_bits() };
    [bits(point.x), bits(point.y), bits(point.z)]
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
    fn imports_ascii_stl_and_converts_inches_to_mm() {
        let mesh = Mesh::from_stl(ASCII_STL.as_bytes(), SourceUnit::Inch).unwrap();
        assert_eq!(mesh.validate().unwrap().triangle_count, 1);
        assert!((mesh.stats().unwrap().surface_area_mm2 - 322.58).abs() < 1.0e-8);
        assert_eq!(mesh.units, SourceUnit::Millimeter);
    }

    #[test]
    fn imports_obj_polygon_faces() {
        let obj = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
        let mesh = Mesh::from_obj(obj, SourceUnit::Millimeter).unwrap();
        assert_eq!(mesh.triangles.len(), 2);
        assert!((mesh.stats().unwrap().surface_area_mm2 - 1.0).abs() < 1.0e-12);
    }

    #[test]
    fn rejects_degenerate_triangles_and_invalid_indices() {
        let collapsed = Mesh { vertices: vec![Point3::new(0.0, 0.0, 0.0); 3], triangles: vec![Triangle([0, 1, 2])], units: SourceUnit::Millimeter };
        assert!(matches!(collapsed.validate(), Err(MeshError::DegenerateTriangle(0))));
        let broken = Mesh { vertices: vec![Point3::new(0.0, 0.0, 0.0); 2], triangles: vec![Triangle([0, 1, 2])], units: SourceUnit::Millimeter };
        assert!(matches!(broken.validate(), Err(MeshError::InvalidIndex { .. })));
    }


    #[test]
    fn new_normalizes_declared_units_and_closed_solid_checks_winding() {
        let vertices = vec![
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
            Point3::new(0.0, 0.0, 1.0),
        ];
        let triangles = vec![
            Triangle([0, 2, 1]),
            Triangle([0, 1, 3]),
            Triangle([0, 3, 2]),
            Triangle([1, 2, 3]),
        ];
        let mesh = Mesh::new(vertices, triangles, SourceUnit::Inch).unwrap();
        let stats = mesh.require_closed_solid().unwrap();
        assert_eq!(mesh.units, SourceUnit::Millimeter);
        assert_eq!(stats.boundary_edges, 0);
        assert_eq!(stats.non_manifold_edges, 0);
        assert_eq!(stats.inconsistent_winding_edges, 0);
        assert!(stats.watertight);
    }

    #[test]
    fn failed_transform_leaves_original_mesh_unchanged() {
        let mut mesh = Mesh::from_stl(ASCII_STL.as_bytes(), SourceUnit::Millimeter).unwrap();
        let original = mesh.clone();
        assert!(mesh.translate(Point3::new(f64::INFINITY, 0.0, 0.0)).is_err());
        assert_eq!(mesh, original);
    }

    #[test]
    fn detects_open_mesh_and_transforms() {
        let mut mesh = Mesh::from_stl(ASCII_STL.as_bytes(), SourceUnit::Millimeter).unwrap();
        assert_eq!(mesh.stats().unwrap().boundary_edges, 3);
        mesh.translate(Point3::new(2.0, 0.0, 0.0)).unwrap();
        assert!((mesh.stats().unwrap().bounds.min.x - 2.0).abs() < 1.0e-12);
        assert!(matches!(mesh.require_closed_solid(), Err(MeshError::NotClosedSolid { .. })));
    }

    #[test]
    fn parses_long_ascii_stl_before_interpreting_header_bytes_as_binary_count() {
        let long_text = format!("{}\n{}", ASCII_STL, "comment padding comment padding comment padding");
        assert!(Mesh::from_stl(long_text.as_bytes(), SourceUnit::Millimeter).is_ok());
    }
}
