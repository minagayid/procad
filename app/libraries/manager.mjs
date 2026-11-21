import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
const here=fileURLToPath(new URL('.',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
export function validateRegistry(registry){
 need(registry?.schema==='cad.library-registry.v1'&&Number.isInteger(registry.version)&&registry.version>0,'Unsupported registry');
 need(Array.isArray(registry.assets)&&registry.assets.length<=500,'Invalid asset list');
 const ids=new Set();
 for(const a of registry.assets){
  need(typeof a.id==='string'&&/^[a-z0-9-]{1,80}$/.test(a.id)&&!ids.has(a.id),'Invalid or duplicate asset ID');ids.add(a.id);
  need(['anatomy-reference','restoration-morphology','prosthetic-mechanism','implant-component','research-software'].includes(a.kind),'Unknown asset kind');
  need(typeof a.title==='string'&&a.title.length>0&&typeof a.sourceUrl==='string'&&a.sourceUrl.startsWith('https://'),'Missing asset identity');
  need(typeof a.status==='string'&&typeof a.license==='string'&&typeof a.units?.status==='string','Missing status, license or units');
  if(a.download){
   need(a.download.url?.startsWith('https://')&&/^[a-f0-9]{64}$/.test(a.download.sha256)&&Number.isInteger(a.download.bytes)&&a.download.bytes>0&&a.download.bytes<=25*1024*1024,'Unpinned download');
   need(a.download.rightsReviewed===true&&a.kind==='anatomy-reference'&&a.format==='glb','Only reviewed pinned anatomy GLBs are enabled for download in v1');
   need(typeof a.attribution==='string'&&a.attribution.length>0&&typeof a.licenseUrl==='string'&&a.licenseUrl.startsWith('https://'),'Missing redistribution notice');
  }
 }
 return registry;
}
export async function loadRegistry(){return validateRegistry(JSON.parse(await readFile(join(here,'registry.json'),'utf8')));}
export function verifyBytes(asset,bytes){need(asset.download,'Asset is metadata-only');need(bytes.byteLength===asset.download.bytes,'Asset size mismatch');need(hash(bytes)===asset.download.sha256,'Asset checksum mismatch');return bytes;}
const cachePath=(cache,id)=>join(resolve(cache),id+'.glb');
export async function assetState(asset,cache){
 if(!asset.download)return {available:false,status:'metadata-only'};
 try{verifyBytes(asset,await readFile(cachePath(cache,asset.id)));return {available:true,status:'verified-cache'};}
 catch(e){if(e.code==='ENOENT')return {available:false,status:'not-installed'};return {available:false,status:'invalid-cache',error:e.message};}
}
export async function installAsset(asset,cache,fetcher=fetch){
 need(asset.download?.rightsReviewed===true,'Asset not enabled for download');
 const response=await fetcher(asset.download.url,{redirect:'error',signal:AbortSignal.timeout(30000)});
 need(response.ok,'Asset download failed');
 const declared=response.headers.get('content-length');if(declared)need(Number(declared)<=asset.download.bytes,'Unexpected download size');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;need(size<=asset.download.bytes,'Download exceeds pinned size');chunks.push(value);}}
 catch(e){await reader.cancel();throw e;}
 const bytes=verifyBytes(asset,Buffer.concat(chunks));
 await mkdir(cache,{recursive:true});const tmp=cachePath(cache,asset.id)+'.'+process.pid+'.tmp';
 try{await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,cachePath(cache,asset.id));}
 finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 return {id:asset.id,bytes:bytes.byteLength,sha256:hash(bytes)};
}
export function createLibraryServer(registry,cache){
 validateRegistry(registry);
 return createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'};
  const reply=(code,body,type='application/json')=>{res.writeHead(code,{...headers,'Content-Type':type});res.end(req.method==='HEAD'?undefined:body);};
  if(!['GET','HEAD'].includes(req.method))return reply(405,JSON.stringify({error:'Read-only library viewer'}));
  if(!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host||''))return reply(403,JSON.stringify({error:'Loopback host required'}));
  try{
   const path=new URL(req.url,'http://127.0.0.1').pathname;
   if(path==='/registry.json')return reply(200,JSON.stringify({...registry,assets:await Promise.all(registry.assets.map(async a=>({...a,local:await assetState(a,cache)})))}));
   if(path.startsWith('/asset/')){
    const id=path.slice(7);need(/^[a-z0-9-]{1,80}$/.test(id),'Invalid asset ID');const a=registry.assets.find(a=>a.id===id);need(a?.download,'Unknown or metadata-only asset');
    const b=verifyBytes(a,await readFile(cachePath(cache,id)));return reply(200,b,'model/gltf-binary');
   }
   const files={'/':'index.html','/library-browser.mjs':'library-browser.mjs'};
   if(!files[path])return reply(404,JSON.stringify({error:'Not found'}));
   return reply(200,await readFile(join(here,files[path])),path==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
  }catch(e){return reply(400,JSON.stringify({error:e.code==='ENOENT'?'Asset not installed. Run the local install command.':e.message}));}
 });
}
const launched=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:'';
if(launched===import.meta.url){
 try{
  const registry=await loadRegistry(),[command='status',id,cacheArg]=process.argv.slice(2),cache=resolve(cacheArg||process.env.CAD_LIBRARY_CACHE||join(homedir(),'.cache',registry.application+'-reference-library'));
  if(command==='status'){for(const a of registry.assets)console.log(JSON.stringify({id:a.id,kind:a.kind,license:a.license,units:a.units.status,...await assetState(a,cache)}));}
  else if(command==='install'){const a=registry.assets.find(a=>a.id===id);need(a,'Unknown asset');console.log(JSON.stringify(await installAsset(a,cache)));console.log(a.attribution);console.log(a.licenseUrl);}
  else if(command==='serve'){const port=Number(process.env.CAD_LIBRARY_PORT||4187);need(Number.isInteger(port)&&port>=1024&&port<=65535,'Invalid port');createLibraryServer(registry,cache).listen(port,'127.0.0.1',()=>console.log(`Library viewer: http://127.0.0.1:${port}`));}
  else throw Error('Commands: status | install ASSET_ID [CACHE_DIR] | serve. Optional CAD_LIBRARY_CACHE and CAD_LIBRARY_PORT.');
 }catch(e){console.error(e.message);process.exitCode=1;}
  }
