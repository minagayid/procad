import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { inspectClosedMesh } from './mesh-validation.js';

const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const fract = (value) => value - Math.floor(value);

function xyCross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a, b, c, d, tolerance = 1e-9) {
  const abC = xyCross(a, b, c), abD = xyCross(a, b, d);
  const cdA = xyCross(c, d, a), cdB = xyCross(c, d, b);
  const opposite = (first, second) => (first > tolerance && second < -tolerance) || (first < -tolerance && second > tolerance);
  const onSegment = (point, start, end) => {
    if (Math.abs(xyCross(start, end, point)) > tolerance) return false;
    return point[0] >= Math.min(start[0], end[0]) - tolerance && point[0] <= Math.max(start[0], end[0]) + tolerance &&
      point[1] >= Math.min(start[1], end[1]) - tolerance && point[1] <= Math.max(start[1], end[1]) + tolerance;
  };
  if (opposite(abC, abD) && opposite(cdA, cdB)) return true;
  return (Math.abs(abC) <= tolerance && onSegment(c, a, b)) ||
    (Math.abs(abD) <= tolerance && onSegment(d, a, b)) ||
    (Math.abs(cdA) <= tolerance && onSegment(a, c, d)) ||
    (Math.abs(cdB) <= tolerance && onSegment(b, c, d));
}

function polygonCentroid2(points) {
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) throw new Error('The trace has no stable projected area in the preparation XY plane.');
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

/**
 * Validate an operator-entered, closed, piecewise-linear annotation and sample
 * it radially in XY. Chords between picked surface points are not constrained to
 * the preparation surface. This construction precondition does not identify or
 * validate a clinical finish line. Prep geometry must be aligned so the trace is
 * a simple star-shaped loop in XY.
 */
export function sampleClosedMargin(points, sampleCount = 96) {
  if (!Array.isArray(points) || points.length < 12) throw new Error('Trace at least 12 points before closing the operator margin trace.');
  if (points.length > 512) throw new Error('Margin trace exceeds the 512-point local case limit.');
  if (!Number.isInteger(sampleCount) || sampleCount < 12 || sampleCount > 4096) throw new Error('Margin sampling count is outside the supported range.');
  if (!points.every(finitePoint)) throw new Error('Margin trace contains a missing or non-finite point.');
  const xy = points.map(([x, y]) => [x, y]);
  for (let i = 0; i < xy.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.02) {
      throw new Error('Margin trace has duplicate or nearly duplicate neighboring points.');
    }
    if (Math.hypot(xy[i][0] - xy[(i + 1) % xy.length][0], xy[i][1] - xy[(i + 1) % xy.length][1]) < 1e-8) {
      throw new Error('Margin trace contains an edge with no projected length in the preparation XY plane.');
    }
  }
  for (let i = 0; i < xy.length; i++) {
    const previous = xy[(i + xy.length - 1) % xy.length];
    const current = xy[i];
    const next = xy[(i + 1) % xy.length];
    const toPrevious = [previous[0] - current[0], previous[1] - current[1]];
    const toNext = [next[0] - current[0], next[1] - current[1]];
    const cross = toPrevious[0] * toNext[1] - toPrevious[1] * toNext[0];
    const dot = toPrevious[0] * toNext[0] + toPrevious[1] * toNext[1];
    if (Math.abs(cross) <= 1e-9 && dot > 1e-9) {
      throw new Error('Margin trace contains adjacent collinear edges that overlap.');
    }
  }
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    for (let j = i + 1; j < xy.length; j++) {
      if (j === i || j === (i + 1) % xy.length || (j + 1) % xy.length === i) continue;
      if (segmentsIntersect(a, b, xy[j], xy[(j + 1) % xy.length])) {
        throw new Error('Margin trace crosses itself in the XY projection; edit the trace or correct the preparation alignment.');
      }
    }
  }
  const center = polygonCentroid2(xy);
  const result = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    const angle = sample / sampleCount * Math.PI * 2;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const hits = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const edge = [b[0] - a[0], b[1] - a[1]];
      const fromCenter = [a[0] - center[0], a[1] - center[1]];
      const denominator = direction[0] * edge[1] - direction[1] * edge[0];
      if (Math.abs(denominator) < 1e-10) continue;
      const radius = (fromCenter[0] * edge[1] - fromCenter[1] * edge[0]) / denominator;
      const edgeT = (fromCenter[0] * direction[1] - fromCenter[1] * direction[0]) / denominator;
      if (radius > 1e-8 && edgeT >= -1e-9 && edgeT < 1 - 1e-9) {
        hits.push([radius, edgeT, a, b]);
      }
    }
    if (hits.length !== 1) {
      throw new Error('Margin trace is not a single-valued radial loop in the current preparation frame. Align the scan or retrace it.');
    }
    const [, t, a, b] = hits[0];
    result.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ]);
  }
  return result;
}

function readTriangle(geometry, triangleIndex, target = new THREE.Triangle()) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const readIndex = (i) => index ? index.getX(i) : i;
  const offset = triangleIndex * 3;
  const a = readIndex(offset), b = readIndex(offset + 1), c = readIndex(offset + 2);
  target.a.fromBufferAttribute(position, a);
  target.b.fromBufferAttribute(position, b);
  target.c.fromBufferAttribute(position, c);
  return target;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * fraction;
  const lower = Math.floor(at), upper = Math.ceil(at);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
}

function summarize(values) {
  return values.length ? {
    count: values.length,
    minMm: Math.min(...values),
    p05Mm: percentile(values, 0.05),
    medianMm: percentile(values, 0.5),
    p95Mm: percentile(values, 0.95),
    maxMm: Math.max(...values)
  } : { count: 0, minMm: null, p05Mm: null, medianMm: null, p95Mm: null, maxMm: null };
}

/**
 * Directed, area-weighted, unsigned Euclidean surface distance. Input geometry
 * and matrices must all use millimetres; reflected transforms are rejected
 * because they invert face-normal orientation. This diagnostic has no fit
 * threshold, does not test seating, and cannot establish clinical or
 * manufacturing acceptability.
 */
export function measureDirectedUnsignedSurfaceDistance(sourceGeometry, targetGeometry, {
  sourceMatrix = new THREE.Matrix4(),
  targetMatrix = new THREE.Matrix4(),
  sampleCount = 5000
} = {}) {
  if (!Number.isInteger(sampleCount) || sampleCount < 100 || sampleCount > 50000) {
    throw new Error('Surface sampling count must be between 100 and 50,000.');
  }
  if (!sourceGeometry?.attributes?.position || !targetGeometry?.attributes?.position) {
    throw new Error('Both source and target must be triangle surface meshes.');
  }
  for (const matrix of [sourceMatrix, targetMatrix]) {
    if (!matrix?.elements?.every(Number.isFinite) || new THREE.Matrix3().setFromMatrix4(matrix).determinant() <= 1e-12) {
      throw new Error('Distance diagnostic transforms must be finite, non-reflecting millimetre transforms.');
    }
  }
  const sourceTopology = inspectClosedMesh(sourceGeometry);
  const targetTopology = inspectClosedMesh(targetGeometry);
  if (!sourceTopology.closed || !targetTopology.closed) {
    throw new Error('Unsigned intaglio diagnostics require two closed, consistently wound single-component meshes.');
  }

  const source = sourceGeometry.clone();
  const target = targetGeometry.clone();
  source.applyMatrix4(sourceMatrix);
  target.applyMatrix4(targetMatrix);
  const sourceTriangles = (source.index?.count ?? source.attributes.position.count) / 3;
  const targetTriangles = (target.index?.count ?? target.attributes.position.count) / 3;
  const sourceAreas = new Float64Array(sourceTriangles);
  const areaCdf = new Float64Array(sourceTriangles);
  const sourceTriangle = new THREE.Triangle();
  let totalArea = 0;
  for (let i = 0; i < sourceTriangles; i++) {
    readTriangle(source, i, sourceTriangle);
    const area = sourceTriangle.getArea();
    if (!(area > 1e-12) || !Number.isFinite(area)) continue;
    sourceAreas[i] = area;
    totalArea += area;
    areaCdf[i] = totalArea;
  }
  if (!(totalArea > 0)) {
    source.dispose();
    target.dispose();
    throw new Error('The source surface has no measurable triangle area.');
  }

  let bvh;
  try {
    bvh = new MeshBVH(target);
    const samples = [];
    const distances = [];
    const opposedDistances = [];
    const sourcePoint = new THREE.Vector3();
    const targetPoint = new THREE.Vector3();
    const sourceNormal = new THREE.Vector3();
    const targetNormal = new THREE.Vector3();
    const scratchTriangle = new THREE.Triangle();
    for (let i = 0; i < sampleCount; i++) {
      const selector = fract((i + 0.5) * 0.6180339887498949) * totalArea;
      let lo = 0, hi = areaCdf.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (areaCdf[mid] >= selector) hi = mid;
        else lo = mid + 1;
      }
      while (lo < areaCdf.length && sourceAreas[lo] === 0) lo++;
      if (lo >= sourceTriangles) throw new Error('Area-weighted sampling could not find a valid source triangle.');
      readTriangle(source, lo, scratchTriangle);
      const u = Math.sqrt(fract((i + 1) * 0.7548776662466927));
      const v = fract((i + 1) * 0.5698402909980532);
      const wa = 1 - u, wb = u * (1 - v), wc = u * v;
      sourcePoint.set(
        scratchTriangle.a.x * wa + scratchTriangle.b.x * wb + scratchTriangle.c.x * wc,
        scratchTriangle.a.y * wa + scratchTriangle.b.y * wb + scratchTriangle.c.y * wc,
        scratchTriangle.a.z * wa + scratchTriangle.b.z * wb + scratchTriangle.c.z * wc
      );
      scratchTriangle.getNormal(sourceNormal);
      const nearest = bvh.closestPointToPoint(sourcePoint, { point: targetPoint });
      if (!nearest || !Number.isFinite(nearest.distance)) continue;
      readTriangle(target, nearest.faceIndex, scratchTriangle);
      scratchTriangle.getNormal(targetNormal);
      const distance = nearest.distance;
      const normalDot = sourceNormal.dot(targetNormal);
      distances.push(distance);
      if (normalDot <= -0.35) opposedDistances.push(distance);
      samples.push({ point: sourcePoint.toArray(), distanceMm: distance, normalDot });
    }
    if (samples.length !== sampleCount) throw new Error('The target distance query did not cover every requested source sample.');
    return {
      algorithm: 'area-weighted-kronecker-sequence-bvh-nearest-triangle-v1',
      direction: 'source preparation surface to nearest target restoration surface',
      distanceSemantics: 'unsigned Euclidean nearest-surface distance in millimetres',
      regionHeuristic: 'source-normal/nearest-target-normal dot product <= -0.35; heuristic only, not an intaglio classifier',
      sourceAreaMm2: totalArea,
      sampleCount: samples.length,
      opposedNormalCoverage: opposedDistances.length / samples.length,
      allNearestDistances: summarize(distances),
      opposedNormalSubset: summarize(opposedDistances),
      samples
    };
  } finally {
    source.dispose();
    target.dispose();
  }
}
