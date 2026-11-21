import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMesh,validateAsset,verifyAssetBytes,placeByLandmarks,proposeLibraryPlacement,validFDI} from './morphology-library.mjs';
const mesh={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],triangles:[[0,2,1],[0,1,3],[1,2,3],[2,0,3]]};
const source=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]];
const target=source.map(([x,y,z])=>[5-y,2+x,3+z]);
const bytes=new TextEncoder().encode(JSON.stringify(mesh));
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const asset={schema:'procad.morphology.v1',id:'synthetic-test-not-anatomy',kind:'restoration-morphology',fdi:['11'],units:'mm',sha256:hash,sourceUrl:'https://example.test/synthetic',version:'test-1',license:'MIT',attribution:'Original synthetic test tetrahedron',rightsReviewed:true};
test('FDI accepts permanent notation only',()=>{for(const f of ['11','18','21','48'])assert.ok(validFDI(f));for(const f of [11,'19','51','00','1'])assert.ok(!validFDI(f));});
test('proper rigid placement, unchanged source and face winding',()=>{const before=JSON.stringify(mesh);const p=placeByLandmarks(mesh,source,target);assert.deepEqual(p.mesh.vertices,target);assert.deepEqual(p.mesh.triangles,mesh.triangles);assert.equal(p.transform.scale,1);assert.equal(p.metrics.maxLandmarkMm,0);assert.equal(JSON.stringify(mesh),before);});
test('arbitrary frame rotation and inverse recover source',()=>{const s=[[1,1,1],[3,2,1],[0,4,2],[5,6,7]];const t=s.map(([x,y,z])=>[z+2,x-5,y+1]);const out=placeByLandmarks(mesh,s,t);const recovered=placeByLandmarks(out.mesh,t,s);mesh.vertices.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-recovered.mesh.vertices[i][j])<1e-9)));});
test('scale is opt-in and bounded',()=>{const twice=source.map(p=>p.map(v=>v*2));assert.throws(()=>placeByLandmarks(mesh,source,twice),/residual/);assert.equal(placeByLandmarks(mesh,source,twice,{allowUniformScale:true}).transform.scale,2);assert.throws(()=>placeByLandmarks(mesh,source,source.map(p=>p.map(v=>v*3)),{allowUniformScale:true}),/scale/);});
test('bad landmarks and mismatched independent landmarks stop placement',()=>{assert.throws(()=>placeByLandmarks(mesh,[[0,0,0],[1,0,0],[2,0,0]],target.slice(0,3)),/Degenerate/);const t=structuredClone(target);t[3][2]+=1;assert.throws(()=>placeByLandmarks(mesh,source,t),/residual/);assert.throws(()=>placeByLandmarks(mesh,source,target,{maxResidualMm:NaN}),/threshold/);});
test('license, units, kind, tooth and rights are gated',()=>{validateAsset(asset,'11');for(const patch of [{units:'cm'},{kind:'atlas'},{rightsReviewed:false},{license:''},{sha256:'bad'}])assert.throws(()=>validateAsset({...asset,...patch},'11'));assert.throws(()=>validateAsset(asset,'12'));});
test('corrupt or substituted geometry is rejected',async()=>{await verifyAssetBytes(asset,bytes);await assert.rejects(verifyAssetBytes(asset,new Uint8Array([0])),/checksum/);await assert.rejects(proposeLibraryPlacement({asset,bytes,mesh,fdi:'11',sourceLandmarks:source,targetLandmarks:target,scanSha256:'a'.repeat(64)}),/only verified/);});
test('proposal manifest binds exact asset bytes and scan',async()=>{const p=await proposeLibraryPlacement({asset,bytes,fdi:'11',sourceLandmarks:source,targetLandmarks:target,scanSha256:'a'.repeat(64)});assert.equal(p.manifest.assetSha256,hash);assert.equal(p.manifest.camReady,false);assert.equal(p.manifest.clinicalFit,'not-assessed');assert.deepEqual(p.mesh.vertices,target);});
test('invalid triangles and nonfinite inputs fail closed',()=>{assert.throws(()=>validateMesh({...mesh,triangles:[[0,1,99]]}),/indices/);assert.throws(()=>validateMesh({...mesh,vertices:[[NaN,0,0],...mesh.vertices.slice(1)]}),/coordinates/);assert.throws(()=>validateMesh({...mesh,triangles:[[0,1,1]]}),/indices/);});
test('CLI hashes actual scan bytes and refuses overwrite',async()=>{
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {spawnSync}=await import('node:child_process');const dir=await mkdtemp(join(tmpdir(),'procad-placement-'));
  try{
    await writeFile(join(dir,'asset.json'),bytes);await writeFile(join(dir,'scan.stl'),'synthetic scan identity only, not an STL parser test');
    await writeFile(join(dir,'job.json'),JSON.stringify({assetFile:'asset.json',scanFile:'scan.stl',asset,fdi:'11',sourceLandmarks:source,targetLandmarks:target,scanSha256:'f'.repeat(64)}));
    const args=[new URL('./place-library.mjs',import.meta.url).pathname,join(dir,'job.json'),join(dir,'out.json')];
    const run=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    const output=JSON.parse(await readFile(join(dir,'out.json'),'utf8'));assert.notEqual(output.manifest.scanSha256,'f'.repeat(64));
    assert.equal(spawnSync(process.execPath,args,{encoding:'utf8'}).status,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
