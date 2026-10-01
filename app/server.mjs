import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { STLLoader } from './server-loaders/STLLoader.js';
import { PLYLoader } from './server-loaders/PLYLoader.js';
import { MAX_TEXT_MESH_CHARACTERS, parseMeshText, validateParsedGeometry } from './src/mesh-formats.js';
import { inspectClosedMesh } from './src/mesh-validation.js';
import { unitToMillimeters } from './src/units.js';
import { createEvent, reconcile, scoreRisk, transitionCase, verifyEventChain } from './src/compliance-engine.js';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(appDir, '..');
const dataRoot = process.env.PROCAD_DATA_ROOT || path.join(projectDir, 'data');
const userDir = process.env.PROCAD_USER_DIR || path.join(dataRoot, 'user_meshes');
const stateDir = process.env.PROCAD_STATE_DIR || path.join(dataRoot, 'cases');
const complianceDir = process.env.PROCAD_COMPLIANCE_DIR || path.join(dataRoot, 'compliance');
const distDir = process.env.PROCAD_DIST_DIR || path.join(appDir, 'dist');
const port = Number(process.env.PORT || 4179);
const app = express();
const maxTriangles = 1_000_000;
const defaultOrigins = [
  'http://127.0.0.1:' + port,
  'http://localhost:' + port,
  'http://127.0.0.1:5173',
  'http://localhost:5173'
];
const allowedOrigins = new Set((process.env.PROCAD_ALLOWED_ORIGINS || defaultOrigins.join(',')).split(',').map((value) => value.trim()).filter(Boolean));

await fs.mkdir(userDir, { recursive: true });
await fs.mkdir(stateDir, { recursive: true });
await fs.mkdir(complianceDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, userDir),
  filename: (req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const role = String(req.body.role || 'scan').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'scan';
    callback(null, role + '-' + randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.stl', '.ply', '.obj', '.off', '.xyz', '.pts', '.csv', '.pcd'].includes(ext)) return callback(new Error('Supported inputs are STL, PLY, OBJ, OFF, XYZ, PTS, CSV, and ASCII PCD.'));
    callback(null, true);
  }
});

function localOrigin(origin) {
  return typeof origin === 'string' && allowedOrigins.has(origin);
}
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !localOrigin(req.get('origin'))) {
    return res.status(403).json({ error: 'Mutation requests must come from the local application.' });
  }
  next();
});

async function validateUploadedMesh(file, unitToMm = 1) {
  const bytes = await fs.readFile(file.path);
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.stl') {
    if (bytes.length >= 84) {
      const triangles = bytes.readUInt32LE(80);
      if (triangles > 0 && bytes.length === 84 + triangles * 50) {
        if (triangles > maxTriangles) throw new Error('Mesh exceeds the local preview limit of ' + maxTriangles.toLocaleString() + ' triangles.');
        return { ...validateGeometry(new STLLoader().parse(toArrayBuffer(bytes)), { unitToMm }), geometryType: 'surface-mesh' };
      }
    }
    const text = bytes.subarray(0, Math.min(bytes.length, 2048)).toString('ascii').trimStart();
    if (/^solid\b/i.test(text) && /endsolid\b/i.test(bytes.subarray(Math.max(0, bytes.length - 2048)).toString('ascii'))) {
      return { ...validateGeometry(new STLLoader().parse(toArrayBuffer(bytes)), { unitToMm }), geometryType: 'surface-mesh' };
    }
    throw new Error('The STL file does not have a valid binary length or ASCII solid header.');
  }
  if (ext === '.ply') {
    const headerEnd = bytes.indexOf(Buffer.from('end_header'));
    if (headerEnd < 0 || headerEnd > 65536) throw new Error('The PLY file is missing a readable end_header marker.');
    const header = bytes.subarray(0, headerEnd + 10).toString('ascii');
    const vertexCount = Number(header.match(/^element vertex ([1-9]\d*)$/m)?.[1]);
    const faceCount = Number(header.match(/^element face ([0-9]+)$/m)?.[1] || 0);
    if (!/^ply\s/.test(header) || !/^format (ascii|binary_little_endian|binary_big_endian) 1\.0$/m.test(header) || !vertexCount) {
      throw new Error('The PLY header is missing a supported format or vertex declaration.');
    }
    if (faceCount < 1) throw new Error('PLY point clouds without faces are not accepted as surface meshes; use XYZ, PTS, CSV, or ASCII PCD for point-cloud input.');
    if (vertexCount > maxTriangles * 3 || faceCount > maxTriangles) throw new Error('Mesh exceeds the local preview limit of ' + maxTriangles.toLocaleString() + ' triangles.');
    return { ...validateGeometry(new PLYLoader().parse(toArrayBuffer(bytes)), { unitToMm }), geometryType: 'surface-mesh' };
  }
  if (['.obj', '.off', '.xyz', '.pts', '.csv', '.pcd'].includes(ext)) {
    if (bytes.length > MAX_TEXT_MESH_CHARACTERS) throw new Error('Text scan exceeds the 16 MiB local parsing limit.');
    const parsed = parseMeshText(bytes.toString('utf8'), ext);
    return validateParsedGeometry(parsed, 5_000_000, maxTriangles, unitToMm);
  }
  throw new Error('Unsupported mesh type.');
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function validateGeometry(geometry, { requireClosed = false, unitToMm = 1 } = {}) {
  try {
    const position = geometry.attributes.position;
    const triangleCount = geometry.index ? geometry.index.count / 3 : position?.count / 3;
    if (!position || !Number.isInteger(triangleCount) || triangleCount < 1) throw new Error('Mesh contains no complete triangles.');
    if (triangleCount > maxTriangles) throw new Error('Mesh exceeds the local preview limit of ' + maxTriangles.toLocaleString() + ' triangles.');
    const coords = position.array;
    for (let i = 0; i < coords.length; i++) {
      if (!Number.isFinite(coords[i]) || Math.abs(coords[i] * unitToMm) > 3.4028234663852886e38) throw new Error('Mesh contains a non-finite or Float32-overflow coordinate after unit scaling.');
    }
    if (requireClosed) {
      const topology = inspectClosedMesh(geometry);
      if (!topology.closed) throw new Error('Saved proposal mesh is not a single closed finite solid.');
    }
    return { triangles: triangleCount, vertices: position.count };
  } finally {
    geometry.dispose();
  }
}

app.use('/user-meshes', express.static(userDir, { fallthrough: false, maxAge: 0 }));
app.use(express.json({ limit: '2mb' }));

function safeComplianceId(raw) {
  const id = String(raw || '');
  return /^[A-Za-z0-9_-]{1,96}$/.test(id) ? id : null;
}
async function readJsonOr(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeCompliance(name, value) { await writeStateFile(path.join(complianceDir, name), value); }

app.post('/api/events', async (req, res) => {
  try {
    const body = req.body || {};
    const transactionId = safeComplianceId(body.transaction_id);
    if (!transactionId) return res.status(400).json({ error: 'transaction_id is required and must be a safe identifier.' });
    const file = path.join(complianceDir, 'transaction-' + transactionId + '.json');
    const events = await readJsonOr(file, []);
    const event = createEvent({ ...body, transaction_id: transactionId, previous_event_hash: body.previous_event_hash || events.at(-1)?.event_hash || null });
    events.push(event);
    await writeCompliance('transaction-' + transactionId + '.json', events);
    res.status(201).json(event);
  } catch (error) { res.status(400).json({ error: error.message || 'Event rejected.' }); }
});

app.get('/api/audit/transactions/:transactionId', async (req, res) => {
  const id = safeComplianceId(req.params.transactionId);
  if (!id) return res.status(400).json({ error: 'Invalid transaction id.' });
  const events = await readJsonOr(path.join(complianceDir, 'transaction-' + id + '.json'), []);
  res.json({ transaction_id: id, events, verification: verifyEventChain(events) });
});
app.get('/api/audit/transactions/:transactionId/verify', async (req, res) => {
  const id = safeComplianceId(req.params.transactionId);
  if (!id) return res.status(400).json({ error: 'Invalid transaction id.' });
  const events = await readJsonOr(path.join(complianceDir, 'transaction-' + id + '.json'), []);
  res.json({ transaction_id: id, ...verifyEventChain(events) });
});

app.post('/api/reconciliation/run', async (req, res) => {
  const body = req.body || {};
  const result = reconcile(body);
  const risk = scoreRisk(result.signals);
  const id = 'REC-' + randomUUID();
  const record = { reconciliation_id: id, created_at: new Date().toISOString(), organization_id: body.organization_id || null, result, risk, cases: result.signals.map((signal) => ({ case_id: 'CASE-' + randomUUID(), status: 'OPEN', signal_id: signal.signal_id, transaction_id: signal.transaction_id, resolution: null })) };
  await writeCompliance('reconciliation-' + id + '.json', record);
  const signals = await readJsonOr(path.join(complianceDir, 'signals.json'), []);
  await writeCompliance('signals.json', signals.concat(result.signals));
  res.status(201).json(record);
});
app.get('/api/reconciliation/:id', async (req, res) => {
  const id = safeComplianceId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid reconciliation id.' });
  const record = await readJsonOr(path.join(complianceDir, 'reconciliation-' + id + '.json'), null);
  if (!record) return res.status(404).json({ error: 'Reconciliation run not found.' });
  res.json(record);
});
app.get('/api/signals', async (_req, res) => res.json({ signals: await readJsonOr(path.join(complianceDir, 'signals.json'), []) }));
app.post('/api/cases/:caseId/actions', async (req, res) => {
  const caseId = safeComplianceId(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'Invalid case id.' });
  const body = req.body || {};
  const current = String(body.current_status || 'OPEN');
  const next = String(body.next_status || '');
  try {
    const transition = transitionCase(current, next);
    const file = path.join(complianceDir, 'case-' + caseId + '.json');
    const record = await readJsonOr(file, { case_id: caseId, status: current, actions: [] });
    record.status = next; record.actions.push({ ...transition, actor_id: body.actor_id || null, note: String(body.note || '').slice(0, 1000) });
    await writeCompliance('case-' + caseId + '.json', record);
    res.json(record);
  } catch (error) { res.status(409).json({ error: error.message || 'Governance transition rejected.' }); }
});
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  app: 'procad CAD',
  localOnly: true,
  acceptedInputFormats: ['stl', 'ply', 'obj', 'off', 'xyz', 'pts', 'csv', 'pcd-ascii'],
  reviewHandoffFormats: ['stl', 'obj'],
  directMachineTransmission: false
}));
app.get('/api/cases', async (_req, res) => {
  const names = await fs.readdir(stateDir);
  const cases = [];
  for (const name of names) {
    if (!/^[a-z0-9_-]{1,64}\.json$/i.test(name)) continue;
    try {
      const value = JSON.parse(await fs.readFile(path.join(stateDir, name), 'utf8'));
      const id = name.slice(0, -5);
      if ([1, 2].includes(value.schemaVersion) && value.caseId === id && Array.isArray(value.sources)) {
        cases.push({ id, title: value.caseTitle || 'Saved scan case', savedAt: value.savedAt || null, sourceCount: value.sources.length });
      }
    } catch { /* Ignore incomplete or unsupported local manifests. */ }
  }
  cases.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  res.json({ cases });
});
function safeCaseId(raw) {
  const id = String(raw || '');
  const safe = id.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  return safe && safe === id ? safe : null;
}
function jsonSha256(value) {
  return createHash('sha256').update(JSON.stringify(value ?? {}), 'utf8').digest('hex');
}
async function readSavedCase(safeId) {
  return JSON.parse(await fs.readFile(path.join(stateDir, safeId + '.json'), 'utf8'));
}
async function verifySavedProposal(safeId, expectedHash) {
  const file = path.join(stateDir, safeId + '-proposal-' + expectedHash.toLowerCase() + '.stl');
  const bytes = await fs.readFile(file);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash.toLowerCase()) throw new Error('Saved proposal checksum does not match the reviewer record.');
  validateGeometry(new STLLoader().parse(toArrayBuffer(bytes)), { requireClosed: true });
  return { bytes: bytes.length, sha256: actualHash };
}
async function writeStateFile(file, value) {
  const temp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, file);
}
app.post('/api/upload', upload.single('mesh'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No mesh file received.' });
  try {
    const unitToMm = unitToMillimeters(req.body.sourceUnit);
    const meshInfo = await validateUploadedMesh(req.file, unitToMm);
    const bytes = await fs.readFile(req.file.path);
    res.json({
      name: req.file.originalname,
      role: req.body.role || 'scan',
      url: '/user-meshes/' + encodeURIComponent(req.file.filename),
      bytes: req.file.size,
      triangles: meshInfo.triangles,
      vertices: meshInfo.vertices,
      geometryType: meshInfo.geometryType,
      sha256: createHash('sha256').update(bytes).digest('hex')
    });
  } catch (error) {
    await fs.rm(req.file.path, { force: true });
    res.status(400).json({ error: error.message || 'Mesh validation failed.' });
  }
});
app.get('/api/design/:id', async (req, res) => {
  const safeId = String(req.params.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  if (!safeId || safeId !== req.params.id) return res.status(400).json({ error: 'Invalid case id.' });
  try {
    const payload = await fs.readFile(path.join(stateDir, safeId + '.json'), 'utf8');
    res.type('json').send(payload);
  } catch {
    res.status(404).json({ error: 'No saved design for this case.' });
  }
});
app.get('/api/design/:id/approval', async (req, res) => {
  const safeId = safeCaseId(req.params.id);
  if (!safeId) return res.status(400).json({ error: 'Invalid case id.' });
  try {
    res.type('json').send(await fs.readFile(path.join(stateDir, safeId + '-approval.json'), 'utf8'));
  } catch {
    res.status(404).json({ error: 'No reviewer record exists for this design.' });
  }
});
app.post('/api/design/:id/approval', async (req, res) => {
  const safeId = safeCaseId(req.params.id);
  if (!safeId) return res.status(400).json({ error: 'Invalid case id.' });
  const body = req.body || {};
  if (body.approved !== true || !String(body.reviewerName || '').trim() || !String(body.approvalId || '').trim() || !/^[a-f0-9]{64}$/i.test(body.designFingerprint || '') || !/^[a-f0-9]{64}$/i.test(body.designContextFingerprint || '')) {
    return res.status(400).json({ error: 'Reviewer record requires the acknowledgment flag, reviewer name, record ID, design fingerprint, and design-context fingerprint.' });
  }
  let saved;
  try { saved = await readSavedCase(safeId); } catch { return res.status(404).json({ error: 'Save the design before recording a reviewer acknowledgment.' }); }
  const restorationType = saved.currentDesignInputs?.designBrief?.restorationType;
  if (restorationType !== 'single-crown') return res.status(409).json({ error: 'This restoration type is brief-only and cannot receive a geometry review handoff in the current release.' });
  const savedContextFingerprint = jsonSha256(saved.currentDesignInputs);
  if (saved.designStale === true || saved.generatedMesh?.sha256 !== body.designFingerprint || savedContextFingerprint !== body.designContextFingerprint.toLowerCase()) return res.status(409).json({ error: 'Reviewer record fingerprint does not match a fresh saved proposal and context.' });
  try { await verifySavedProposal(safeId, body.designFingerprint); }
  catch (error) { return res.status(409).json({ error: error.message || 'The saved proposal could not be independently verified.' }); }
  const approval = {
    schemaVersion: 1,
    approved: true,
    recordType: 'SELF_ATTESTED_REVIEW_ACKNOWLEDGMENT',
    selfAttested: true,
    caseId: safeId,
    reviewerName: String(body.reviewerName).trim().slice(0, 160),
    reviewerRole: String(body.reviewerRole || 'qualified dental reviewer').trim().slice(0, 160),
    approvalId: String(body.approvalId).trim().slice(0, 160),
    note: String(body.note || '').trim().slice(0, 2000),
    designFingerprint: body.designFingerprint.toLowerCase(),
    designContextFingerprint: body.designContextFingerprint.toLowerCase(),
    reviewedAt: String(body.reviewedAt || new Date().toISOString())
  };
  await writeStateFile(path.join(stateDir, safeId + '-approval.json'), approval);
  res.json({ ok: true, approval });
});
app.put('/api/design/:id/cam-artifact', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  const safeId = safeCaseId(req.params.id);
  if (!safeId) return res.status(400).json({ error: 'Invalid case id.' });
  const format = String(req.get('x-cam-format') || '').toLowerCase();
  const designFingerprint = String(req.get('x-design-fingerprint') || '').toLowerCase();
  const designContextFingerprint = String(req.get('x-design-context-fingerprint') || '').toLowerCase();
  if (!['stl', 'obj'].includes(format) || !/^[a-f0-9]{64}$/.test(designFingerprint) || !/^[a-f0-9]{64}$/.test(designContextFingerprint)) {
    return res.status(400).json({ error: 'CAM artifact requires STL/OBJ format and valid design/context fingerprints.' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length < 16) return res.status(400).json({ error: 'CAM artifact is empty.' });
  let saved, approval;
  try {
    saved = await readSavedCase(safeId);
    approval = JSON.parse(await fs.readFile(path.join(stateDir, safeId + '-approval.json'), 'utf8'));
  } catch {
    return res.status(403).json({ error: 'A saved reviewer acknowledgment is required before review-file upload.' });
  }
  const restorationType = saved.currentDesignInputs?.designBrief?.restorationType;
  const savedContextFingerprint = jsonSha256(saved.currentDesignInputs);
  if (restorationType !== 'single-crown' || saved.designStale === true || saved.generatedMesh?.sha256 !== designFingerprint || savedContextFingerprint !== designContextFingerprint || approval.approved !== true || approval.designFingerprint !== designFingerprint || approval.designContextFingerprint !== designContextFingerprint) {
    return res.status(409).json({ error: 'Review-file upload is blocked because the reviewer record and saved proposal do not match.' });
  }
  try {
    await verifySavedProposal(safeId, designFingerprint);
    if (format === 'stl') {
      validateGeometry(new STLLoader().parse(toArrayBuffer(req.body)), { requireClosed: true });
    } else {
      const parsed = parseMeshText(req.body.toString('utf8'), '.obj');
      if (parsed.geometryType !== 'surface-mesh') throw new Error('OBJ CAM artifact must contain faces.');
      validateParsedGeometry(parsed);
    }
  } catch (error) {
    return res.status(409).json({ error: error.message || 'The CAM artifact failed independent validation.' });
  }
  const sha256 = createHash('sha256').update(req.body).digest('hex');
  const fileName = safeId + '-REVIEW-ONLY.' + format;
  const file = path.join(stateDir, safeId + '-cam-artifact-' + sha256 + '.' + format);
  await fs.writeFile(file, req.body);
  res.json({ ok: true, sha256, bytes: req.body.length, format, fileName });
});
app.post('/api/design/:id/cam-handoff', async (req, res) => {
  const safeId = safeCaseId(req.params.id);
  if (!safeId) return res.status(400).json({ error: 'Invalid case id.' });
  const body = req.body || {};
  const format = String(body.format || '').toLowerCase();
  if (!['stl', 'obj'].includes(format)) return res.status(400).json({ error: 'Review handoff format must be STL or OBJ.' });
  if (!/^[a-f0-9]{64}$/i.test(body.designFingerprint || '') || !/^[a-f0-9]{64}$/i.test(body.designContextFingerprint || '') || !/^[a-f0-9]{64}$/i.test(body.artifactSha256 || '') || !String(body.machineProfile || '').trim() || !String(body.camVersion || '').trim() || !String(body.material || '').trim() || !String(body.blank || '').trim() || !String(body.toolProfile || '').trim()) {
    return res.status(400).json({ error: 'Review handoff requires matching design, context, and artifact fingerprints plus operator-supplied machine, version, material, blank, and tool labels.' });
  }
  let saved, approval;
  try {
    saved = await readSavedCase(safeId);
    approval = JSON.parse(await fs.readFile(path.join(stateDir, safeId + '-approval.json'), 'utf8'));
  } catch {
    return res.status(403).json({ error: 'A saved reviewer acknowledgment is required before review handoff.' });
  }
  const restorationType = saved.currentDesignInputs?.designBrief?.restorationType;
  if (restorationType !== 'single-crown') return res.status(409).json({ error: 'This restoration type is brief-only and cannot be exported as geometry.' });
  if (body.restorationType && String(body.restorationType) !== restorationType) return res.status(409).json({ error: 'Review handoff restoration type does not match the saved design brief.' });
  const savedContextFingerprint = jsonSha256(saved.currentDesignInputs);
  if (saved.designStale === true || saved.generatedMesh?.sha256 !== body.designFingerprint || savedContextFingerprint !== body.designContextFingerprint.toLowerCase() || approval.approved !== true || approval.designFingerprint !== body.designFingerprint || approval.designContextFingerprint !== body.designContextFingerprint.toLowerCase()) {
    return res.status(409).json({ error: 'Review handoff is blocked because the reviewer record and saved proposal do not match.' });
  }
  try { await verifySavedProposal(safeId, body.designFingerprint); }
  catch (error) { return res.status(409).json({ error: error.message || 'The saved proposal could not be independently verified.' }); }
  const artifactFile = path.join(stateDir, safeId + '-cam-artifact-' + body.artifactSha256.toLowerCase() + '.' + format);
  let artifactBytes;
  try { artifactBytes = await fs.readFile(artifactFile); }
  catch { return res.status(409).json({ error: 'Upload the exact review file before creating its handoff manifest.' }); }
  if (createHash('sha256').update(artifactBytes).digest('hex') !== body.artifactSha256.toLowerCase()) return res.status(409).json({ error: 'CAM artifact checksum verification failed.' });
  const stamp = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    product: 'procad Dental CAD',
    caseId: safeId,
    createdAt: stamp,
    delivery: 'local-file-handoff-only',
    directMachineTransmission: false,
    camStatus: 'GEOMETRY_HANDOFF_ONLY',
    geometry: {
      format,
      units: 'mm',
      fileName: safeId + '-REVIEW-ONLY.' + format,
      sha256: body.artifactSha256.toLowerCase(),
      designFingerprint: body.designFingerprint.toLowerCase(),
      status: 'CAM_SIMULATION_AND_OPERATOR_CHECK_REQUIRED'
    },
    machine: {
      profile: String(body.machineProfile).trim().slice(0, 200),
      profileId: String(body.machineProfileId || '').trim().slice(0, 160) || null,
      profileStatus: String(body.machineProfileId || '').trim() === 'dgshape-dwx-43w-dgshape-cam-v25.1.0-vita-suprinity-pc-ls14' ? 'CANDIDATE_UNVALIDATED_PUBLIC_SOURCE_ONLY' : 'UNVALIDATED_OPERATOR_SUPPLIED_LABEL',
      camVersion: String(body.camVersion).trim().slice(0, 120),
      material: String(body.material).trim().slice(0, 120),
      materialStatus: String(body.machineProfileId || '').trim() === 'dgshape-dwx-43w-dgshape-cam-v25.1.0-vita-suprinity-pc-ls14' ? 'CANDIDATE_UNVALIDATED_PUBLIC_SOURCE_ONLY' : 'UNVALIDATED_OPERATOR_SUPPLIED_LABEL',
      blank: String(body.blank).trim().slice(0, 200),
      toolProfile: String(body.toolProfile).trim().slice(0, 200)
    },
    sourceFormats: Array.isArray(body.sourceFormats) ? body.sourceFormats.map((value) => String(value).slice(0, 12)).slice(0, 32) : [],
    restorationType,
    reviewAcknowledgement: { recordType: approval.recordType, selfAttested: true, reviewerName: approval.reviewerName, reviewerRole: approval.reviewerRole, recordId: approval.approvalId, reviewedAt: approval.reviewedAt, designFingerprint: approval.designFingerprint, designContextFingerprint: approval.designContextFingerprint },
    warning: 'This review-only package is not a validated toolpath. Candidate profile metadata is transcribed from public manufacturer/CAM documents but is not validated for any installed machine, material lot, holder position, CAM strategy, or physical cut. Reviewer identity is self-attested. It must not be treated as manufacturing authorization. No CAM strategy or machine instructions are included.'
  };
  manifest.manifestFileName = safeId + '-review-handoff.json';
  await writeStateFile(path.join(stateDir, safeId + '-cam-handoff.json'), manifest);
  res.json({ ok: true, manifest });
});
app.post('/api/design/:id', async (req, res) => {
  const safeId = String(req.params.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  if (!safeId || safeId !== req.params.id) return res.status(400).json({ error: 'Invalid case id.' });
  const file = path.join(stateDir, safeId + '.json');
  const body = { ...req.body, savedAt: new Date().toISOString(), caseId: safeId };
  const temp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temp, JSON.stringify(body, null, 2), 'utf8');
  await fs.rename(temp, file);
  res.json({ ok: true, savedAt: body.savedAt });
});
app.get('/api/design/:id/mesh', async (req, res) => {
  const safeId = String(req.params.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  if (!safeId || safeId !== req.params.id) return res.status(400).json({ error: 'Invalid case id.' });
  try {
    const requestedHash = String(req.query.sha256 || '');
    if (requestedHash && !/^[a-f0-9]{64}$/.test(requestedHash)) return res.status(400).json({ error: 'Invalid proposal checksum.' });
    const file = requestedHash
      ? path.join(stateDir, safeId + '-proposal-' + requestedHash + '.stl')
      : path.join(stateDir, safeId + '-proposal.stl');
    res.type('application/octet-stream').send(await fs.readFile(file));
  } catch {
    res.status(404).json({ error: 'No saved proposal mesh for this case.' });
  }
});
app.put('/api/design/:id/mesh', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  const safeId = String(req.params.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  if (!safeId || safeId !== req.params.id) return res.status(400).json({ error: 'Invalid case id.' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 134) return res.status(400).json({ error: 'Expected a non-empty binary STL mesh.' });
  const triangles = req.body.readUInt32LE(80);
  if (!triangles || req.body.length !== 84 + triangles * 50) return res.status(400).json({ error: 'Binary STL length does not match its triangle count.' });
  const sha256 = createHash('sha256').update(req.body).digest('hex');
  const file = path.join(stateDir, safeId + '-proposal-' + sha256 + '.stl');
  const temp = file + '.' + process.pid + '.tmp';
  if (!(await fs.access(file).then(() => true).catch(() => false))) {
    await fs.writeFile(temp, req.body);
    await fs.rename(temp, file);
  }
  res.json({ ok: true, url: '/api/design/' + safeId + '/mesh?sha256=' + sha256, bytes: req.body.length, triangles, sha256 });
});

const hasBuild = await fs.access(distDir).then(() => true).catch(() => false);
if (hasBuild) {
  app.use(express.static(distDir));
  app.get(/.*/, (req, res) => {
    if (/^\/(api|user-meshes|sample)(\/|$)/.test(req.path)) return res.status(404).json({ error: 'Not found.' });
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.status(200).send('procad API is running. Start the Vite development app with npm run dev.'));
}

app.use((error, _req, res, _next) => {
  console.error(error.message);
  res.status(400).json({ error: error.message || 'Request failed.' });
});

export const server = app.listen(port, '127.0.0.1', () => {
  console.log('procad local service listening on http://127.0.0.1:' + port);
});
