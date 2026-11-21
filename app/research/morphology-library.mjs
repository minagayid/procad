// Research geometry only. No clinical fitting or manufacturing qualification.
const point = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((s,v,i) => s+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.hypot(...a);
const unit = a => { const n=norm(a); if(n<1e-8) throw Error('Degenerate landmark frame'); return a.map(v=>v/n); };
const need = (ok,msg) => { if(!ok) throw Error(msg); };
export function validateMesh(mesh) {
  need(mesh && Array.isArray(mesh.vertices) && mesh.vertices.length>=3 && mesh.vertices.length<=60000,'Expected 3..60000 mesh vertices');
  need(mesh.vertices.every(v=>point(v)&&v.every(x=>Math.abs(x)<=1e6)),'Invalid mesh coordinates');
  need(Array.isArray(mesh.triangles)&&mesh.triangles.length>0&&mesh.triangles.length<=20000,'Expected 1..20000 triangles');
  for(const f of mesh.triangles) {
    need(Array.isArray(f)&&f.length===3&&f.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.vertices.length)&&new Set(f).size===3,'Invalid triangle indices');
    need(norm(cross(sub(mesh.vertices[f[1]],mesh.vertices[f[0]]),sub(mesh.vertices[f[2]],mesh.vertices[f[0]])))>1e-10,'Degenerate triangle');
  }
  return mesh;
}
export function validFDI(value) { return typeof value==='string' && /^[1-4][1-8]$/.test(value); }
const sha = s => typeof s==='string' && /^[a-f0-9]{64}$/.test(s);
export function validateAsset(asset, fdi) {
  need(asset?.schema==='procad.morphology.v1','Unsupported library schema');
  need(validFDI(fdi)&&Array.isArray(asset.fdi)&&asset.fdi.includes(fdi)&&asset.fdi.every(validFDI),'Asset does not cover requested permanent FDI tooth');
  need(asset.kind==='restoration-morphology','Atlas and implant geometry are not crown morphology');
  need(asset.units==='mm','Library coordinates must be millimetres');
  need(typeof asset.id==='string'&&asset.id.length>0&&asset.id.length<=120,'Missing bounded asset ID');
  need(sha(asset.sha256),'Missing SHA-256');
  need(typeof asset.sourceUrl==='string'&&/^https:\/\//.test(asset.sourceUrl),'Missing HTTPS source');
  need(typeof asset.version==='string'&&asset.version.length>0,'Missing exact asset version');
  need(typeof asset.license==='string'&&asset.license.length>0&&typeof asset.attribution==='string'&&asset.attribution.length>0,'Missing license or attribution');
  need(asset.rightsReviewed===true,'Asset rights must be reviewed separately; metadata does not establish permission');
  return asset;
}
export async function verifyAssetBytes(asset, bytes) {
  need(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes),'Expected asset bytes');
  need(bytes.byteLength<=25*1024*1024,'Asset exceeds 25 MiB research limit');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  need(actual===asset.sha256,'Library checksum mismatch');
  return actual;
}
function frame(points) {
  need(Array.isArray(points)&&points.length===3&&points.every(point),'Exactly three corresponding frame landmarks required');
  const x=unit(sub(points[1],points[0]));
  const z=unit(cross(x,sub(points[2],points[0])));
  const y=cross(z,x);
  const baseline=norm(sub(points[1],points[0]));
  need(norm(cross(x,sub(points[2],points[0])))/norm(sub(points[2],points[0]))>1e-3,'Nearly collinear landmarks');
  return {origin:points[0],axes:[x,y,z],baseline};
}
export function placeByLandmarks(mesh,source,target,{allowUniformScale=false,maxResidualMm=0.5}={}) {
  validateMesh(mesh);
  need(Array.isArray(source)&&Array.isArray(target)&&source.length===target.length&&source.length>=3&&source.length<=128&&source.every(point)&&target.every(point),'Expected 3..128 corresponding finite landmarks');
  need(Number.isFinite(maxResidualMm)&&maxResidualMm>0&&maxResidualMm<=10,'Invalid residual threshold');
  const a=frame(source.slice(0,3)),b=frame(target.slice(0,3));
  const scale=allowUniformScale ? b.baseline/a.baseline : 1;
  need(Number.isFinite(scale)&&scale>=0.5&&scale<=2,'Uniform scale outside research guardrail [0.5, 2]');
  const rotation=b.axes[0].map((_,i)=>a.axes[0].map((_,j)=>b.axes.reduce((s,axis,k)=>s+axis[i]*a.axes[k][j],0)));
  const translation=b.origin.map((v,i)=>v-scale*dot(rotation[i],a.origin));
  const transform=p=>rotation.map((row,i)=>scale*dot(row,p)+translation[i]);
  const residuals=source.map((p,i)=>norm(sub(transform(p),target[i])));
  const max=Math.max(...residuals),rms=Math.sqrt(residuals.reduce((s,v)=>s+v*v,0)/residuals.length);
  need(max<=maxResidualMm,`Landmark residual ${max.toFixed(4)} mm exceeds operator threshold`);
  const output={vertices:mesh.vertices.map(transform),triangles:mesh.triangles.map(f=>[...f])};
  validateMesh(output);
  return {mesh:output,transform:{rotation,translation,scale},metrics:{rmsLandmarkMm:rms,maxLandmarkMm:max,residualsMm:residuals},method:'three-landmark-frame-not-best-fit',clinicalFit:'not-assessed'};
}
export async function proposeLibraryPlacement({asset,bytes,mesh,fdi,sourceLandmarks,targetLandmarks,scanSha256,options={}}) {
  validateAsset(asset,fdi);
  need(sha(scanSha256),'Source scan SHA-256 is required');
  await verifyAssetBytes(asset,bytes);
  // Derive the mesh from the verified bytes, never trust a separately supplied mesh.
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const verifiedMesh=JSON.parse(text);
  need(mesh===undefined,'Pass only verified JSON bytes, not an independently supplied mesh');
  const result=placeByLandmarks(verifiedMesh,sourceLandmarks,targetLandmarks,options);
  return {...result,manifest:{schema:'procad.library-proposal.v1',assetId:asset.id,assetSha256:asset.sha256,scanSha256,fdi,units:'mm',license:asset.license,attribution:asset.attribution,sourceUrl:asset.sourceUrl,version:asset.version,sourceLandmarks,targetLandmarks,transform:result.transform,metrics:result.metrics,clinicalFit:'not-assessed',camReady:false}};
}
