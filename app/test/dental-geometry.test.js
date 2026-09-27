import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import ManifoldModule from 'manifold-3d/manifold';
import { measureDesignedIntaglioNormalClearance, measureDirectedUnsignedSurfaceDistance, sampleClosedMargin, traceMarginOnSurface } from '../src/dental-geometry.js';
import { inspectClosedMesh } from '../src/mesh-validation.js';

function circlePoints(count = 16, radius = 5) {
  return Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2;
    return [radius * Math.cos(angle), radius * Math.sin(angle), 0.2 * Math.sin(2 * angle)];
  });
}

test('closed operator trace is radially sampled as a 3D boundary loop', () => {
  const samples = sampleClosedMargin(circlePoints(), 96);
  assert.equal(samples.length, 96);
  assert(samples.every((point) => point.length === 3 && point.every(Number.isFinite)));
  assert(Math.max(...samples.map((point) => point[2])) > 0.15);
  assert(Math.min(...samples.map((point) => point[2])) < -0.15);
});

test('margin connector follows the triangle surface across a curved preparation mesh', () => {
  const prep = new THREE.SphereGeometry(5, 48, 24);
  prep.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const row = 10, stride = 49;
  const points = Array.from({ length: 12 }, (_, i) => {
    const vertex = row * stride + i * 4;
    return [prep.attributes.position.getX(vertex), prep.attributes.position.getY(vertex), prep.attributes.position.getZ(vertex)];
  });
  const path = traceMarginOnSurface(points, prep);
  assert(path.length > points.length);
  const bvh = new MeshBVH(prep);
  const scratch = new THREE.Vector3();
  for (let i = 0; i < path.length; i++) {
    const a = new THREE.Vector3(...path[i]);
    const b = new THREE.Vector3(...path[(i + 1) % path.length]);
    const midpoint = a.add(b).multiplyScalar(0.5);
    const nearest = bvh.closestPointToPoint(midpoint, { point: scratch });
    assert(nearest.distance < 1e-5, `surface path segment ${i} left the source triangle mesh`);
  }
  const sampled = sampleClosedMargin(points, 96, { surfacePolyline: path });
  for (const point of sampled) {
    const nearest = bvh.closestPointToPoint(new THREE.Vector3(...point), { point: scratch });
    assert(nearest.distance < 1e-5, 'sampled preview boundary left the preparation surface');
  }
  prep.dispose();
});

test('margin path accepts open scan patches and welds seams using the mesh-validation tolerance', () => {
  const indexed = new THREE.PlaneGeometry(4, 4, 8, 8);
  const prep = indexed.toNonIndexed();
  indexed.dispose();
  const position = prep.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const delta = i % 2 === 0 ? -0.000003 : 0.000003;
    position.setXYZ(i, position.getX(i) + delta, position.getY(i) - delta, position.getZ(i) + delta);
  }
  position.needsUpdate = true;
  const xy = [
    [-1, -1], [-0.5, -1], [0, -1], [0.5, -1], [1, -1],
    [1, -0.5], [1, 0], [1, 0.5], [1, 1],
    [0.5, 1], [0, 1], [-0.5, 1], [-1, 1],
    [-1, 0.5], [-1, 0], [-1, -0.5]
  ];
  const points = xy.map(([x, y]) => [x, y, 0]);
  const path = traceMarginOnSurface(points, prep);
  assert(path.length >= points.length);
  const bvh = new MeshBVH(prep);
  const scratch = new THREE.Vector3();
  for (let i = 0; i < path.length; i++) {
    const a = new THREE.Vector3(...path[i]);
    const b = new THREE.Vector3(...path[(i + 1) % path.length]);
    const nearest = bvh.closestPointToPoint(a.add(b).multiplyScalar(0.5), { point: scratch });
    assert(nearest.distance < 1e-5, `path segment ${i} left the open scanned surface patch`);
  }
  const offSurface = points.map((point) => [...point]);
  offSurface[0][2] = 0.01;
  assert.throws(() => traceMarginOnSurface(offSurface, prep), /no longer lies on its source preparation surface/i);
  prep.dispose();
});

test('margin trace construction rejects short, oversized, and crossing loops', () => {
  assert.throws(() => sampleClosedMargin([[0, 0, 0]], 96), /at least 12 points/i);
  assert.throws(() => sampleClosedMargin(circlePoints(513), 96), /512-point/i);
  const star = Array.from({ length: 12 }, (_, step) => {
    const i = (step * 5) % 12;
    const angle = i / 12 * Math.PI * 2;
    return [5 * Math.cos(angle), 5 * Math.sin(angle), 0];
  });
  assert.throws(() => sampleClosedMargin(star, 96), /crosses itself/i);
});

test('margin trace construction rejects non-adjacent touches, overlapping edges, and zero XY edges', () => {
  const touching = circlePoints();
  touching[8] = [...touching[2]];
  assert.throws(() => sampleClosedMargin(touching, 96), /crosses itself/i);

  const overlapping = circlePoints();
  overlapping[0] = [-3, 0, 0];
  overlapping[1] = [-1, 0, 0];
  overlapping[2] = [-2, 0, 0];
  assert.throws(() => sampleClosedMargin(overlapping, 96), /collinear edges that overlap/i);

  const vertical = circlePoints();
  vertical[1] = [vertical[0][0], vertical[0][1], vertical[0][2] + 0.1];
  assert.throws(() => sampleClosedMargin(vertical, 96), /no projected length/i);
});

test('directed unsigned surface sampling reports deterministic nonnegative distances in mm', () => {
  const source = new THREE.BoxGeometry(10, 10, 10);
  const target = new THREE.BoxGeometry(10, 10, 10);
  const targetMatrix = new THREE.Matrix4().makeTranslation(12, 0, 0);
  const result = measureDirectedUnsignedSurfaceDistance(source, target, { sampleCount: 1000, targetMatrix });
  const repeated = measureDirectedUnsignedSurfaceDistance(source, target, { sampleCount: 1000, targetMatrix });
  assert.equal(result.sampleCount, 1000);
  assert.equal(result.algorithm, 'area-weighted-kronecker-sequence-bvh-nearest-triangle-v1');
  assert.equal(result.direction, 'source preparation surface to nearest target restoration surface');
  assert.equal(result.distanceSemantics, 'unsigned Euclidean nearest-surface distance in millimetres');
  assert(result.allNearestDistances.minMm >= 0);
  assert(Math.abs(result.allNearestDistances.minMm - 2) < 1e-5);
  assert(result.opposedNormalSubset.count > 0);
  assert.equal(result.allNearestDistances.medianMm, repeated.allNearestDistances.medianMm);
  assert(result.samples.every((sample) => sample.distanceMm >= 0 && Number.isFinite(sample.normalDot)));
  source.dispose();
  target.dispose();
});

test('surface-distance calculation rejects open meshes', () => {
  const open = new THREE.PlaneGeometry(2, 2);
  const closed = new THREE.BoxGeometry(2, 2, 2);
  assert.throws(() => measureDirectedUnsignedSurfaceDistance(open, closed, { sampleCount: 100 }), /closed/i);
  open.dispose();
  closed.dispose();
});

test('surface-distance diagnostic rejects reflected transforms that invert normals', () => {
  const source = new THREE.BoxGeometry(2, 2, 2);
  const target = new THREE.BoxGeometry(2, 2, 2);
  const reflected = new THREE.Matrix4().makeScale(-1, 1, 1);
  assert.throws(() => measureDirectedUnsignedSurfaceDistance(source, target, { sampleCount: 100, sourceMatrix: reflected }), /non-reflecting millimetre transforms/i);
  source.dispose();
  target.dispose();
});

test('unsigned nearest distances do not reveal penetration when surfaces intersect', () => {
  const source = new THREE.BoxGeometry(10, 10, 10);
  const target = new THREE.BoxGeometry(10, 10, 10);
  const overlappingTarget = new THREE.Matrix4().makeTranslation(5, 0, 0);
  const result = measureDirectedUnsignedSurfaceDistance(source, target, { sampleCount: 1000, targetMatrix: overlappingTarget });
  assert.equal(result.distanceSemantics, 'unsigned Euclidean nearest-surface distance in millimetres');
  assert(result.allNearestDistances.minMm < 1e-5);
  source.dispose();
  target.dispose();
});

test('CAD intaglio clearance matches only the final Boolean boundary that coincides with its cutter', async () => {
  const lib = await ManifoldModule();
  lib.setup();
  const makeSolid = (geometry) => {
    const positionOnly = geometry.clone();
    for (const key of Object.keys(positionOnly.attributes)) if (key !== 'position') positionOnly.deleteAttribute(key);
    const welded = mergeVertices(positionOnly, 0.00002);
    positionOnly.dispose();
    const input = new lib.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(welded.attributes.position.array),
      triVerts: new Uint32Array(welded.index.array)
    });
    welded.dispose();
    return lib.Manifold.ofMesh(input);
  };

  const prep = new THREE.BoxGeometry(8, 8, 4).translate(0, 0, 2);
  const cutter = new THREE.BoxGeometry(10, 10, 6).translate(0, 0, 2);
  const outer = makeSolid(new THREE.BoxGeometry(12, 12, 6).translate(0, 0, 3));
  const cavity = makeSolid(cutter);
  const shell = outer.subtract(cavity);
  outer.delete();
  cavity.delete();
  assert.equal(shell.status(), 'NoError');
  const shellData = shell.getMesh();
  const restoration = new THREE.BufferGeometry();
  restoration.setAttribute('position', new THREE.BufferAttribute(new Float32Array(shellData.vertProperties), 3));
  restoration.setIndex(new THREE.BufferAttribute(new Uint32Array(shellData.triVerts), 1));
  assert.equal(inspectClosedMesh(restoration).closed, true);
  shell.delete();

  const result = measureDesignedIntaglioNormalClearance(prep, cutter, restoration, { sampleCount: 1000 });
  assert.equal(result.algorithm, 'area-weighted-kronecker-boolean-intaglio-ray-clearance-v2');
  assert.equal(result.distanceSemantics, 'positive normal-ray separation to the final CAD crown boundary; not fabricated-part fit');
  assert(result.intaglioRayCoverage > 0.74 && result.intaglioRayCoverage < 0.76);
  assert.equal(result.intaglioClearanceMm.count, result.matchedSampleCount);
  assert(Math.abs(result.intaglioClearanceMm.medianMm - 1) < 1e-5);
  assert(result.samples.filter((sample) => sample.matched).every((sample) => Math.abs(sample.distanceMm - 1) < 1e-5 && sample.boundaryDeltaMm <= result.boundaryMatchToleranceMm));
  assert(result.samples.some((sample) => !sample.matched && Math.abs(sample.point[2]) < 1e-8), 'the open basal region must remain unmatched');

  const pose = new THREE.Matrix4().compose(
    new THREE.Vector3(14, -8, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.15, 0.3)),
    new THREE.Vector3(1, 1, 1)
  );
  const transformed = measureDesignedIntaglioNormalClearance(prep, cutter, restoration, {
    sampleCount: 1000, sourceMatrix: pose, cutterMatrix: pose, designMatrix: pose
  });
  assert(Math.abs(transformed.intaglioClearanceMm.medianMm - 1) < 1e-5);
  assert(Math.abs(transformed.intaglioRayCoverage - result.intaglioRayCoverage) < 1e-12);

  const blockingGeometry = new THREE.BoxGeometry(10, 10, 0.2).translate(0, 0, 4.6);
  const blocked = measureDesignedIntaglioNormalClearance(prep, cutter, blockingGeometry, { sampleCount: 1000 });
  const prepTop = blocked.samples.filter((sample) => Math.abs(sample.point[2] - 4) < 1e-8);
  assert(prepTop.length > 0);
  assert(prepTop.every((sample) => !sample.matched), 'a nearer crown surface must not be skipped to match a farther cutter boundary');

  prep.dispose();
  cutter.dispose();
  restoration.dispose();
  blockingGeometry.dispose();
});
