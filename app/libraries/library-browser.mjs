const need=(ok,message)=>{if(!ok)throw Error(message);};
export function parseAtlas(bytes){
 const data=new DataView(bytes);need(data.byteLength>=20&&data.getUint32(0,true)===0x46546c67&&data.getUint32(4,true)===2&&data.getUint32(8,true)===bytes.byteLength,'Invalid GLB');
 const n=data.getUint32(12,true);need(data.getUint32(16,true)===0x4e4f534a&&20+n+8<=bytes.byteLength,'Invalid GLB JSON chunk');
 const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,n))),start=20+n,binSize=data.getUint32(start,true);need(data.getUint32(start+4,true)===0x004e4942&&start+8+binSize===bytes.byteLength,'Invalid GLB binary chunk');
 const read=index=>{
  const a=doc.accessors[index];need(a&&!a.sparse&&a.bufferView!==undefined,'Unsupported sparse/missing accessor');
  const v=doc.bufferViews[a.bufferView];need(v&&v.buffer===0,'External buffers unsupported');
  const sizes={5126:4,5125:4,5123:2,5121:1},components={SCALAR:1,VEC3:3};
  const size=sizes[a.componentType],count=components[a.type];need(size&&count&&a.count<=200000,'Unsupported accessor');
  const offset=start+8+(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||size*count;
  need(a.count>0&&stride>=size*count&&offset+(a.count-1)*stride+size*count<=start+8+binSize,'Out of bounds accessor');
  const fn={5126:'getFloat32',5125:'getUint32',5123:'getUint16',5121:'getUint8'}[a.componentType];
  return Array.from({length:a.count},(_,i)=>Array.from({length:count},(_,j)=>{const x=data[fn](offset+i*stride+j*size,true);need(Number.isFinite(x),'Nonfinite coordinate');return x;}));
 };
 const nodes=doc.nodes||[];need(nodes.length===33,'Pinned atlas must contain 33 named structures');
 return nodes.map(node=>{
  need(!node.matrix&&!node.rotation&&!node.scale&&!node.translation,'Unexpected node transform');
  const primitives=doc.meshes[node.mesh]?.primitives;need(primitives?.length===1,'Expected one triangle primitive per structure');const p=primitives[0];need((p.mode??4)===4,'Non-triangle primitive');
  const vertices=read(p.attributes.POSITION),indices=read(p.indices).flat();need(indices.length%3===0&&indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length),'Invalid mesh indices');
  const triangles=[];for(let i=0;i<indices.length;i+=3)triangles.push(indices.slice(i,i+3));
  return {name:node.name,vertices,triangles};
 });
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d');let registry,selected,meshes=[],yaw=.5,pitch=.2;
 const text=(id,value)=>{$(id).textContent=value;};
 function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#13222f';ctx.fillRect(0,0,canvas.width,canvas.height);
  const mesh=meshes[Number($('structure').value)];canvas.hidden=!mesh;if(!mesh)return;
  const vertices=mesh.vertices.map(([x,y,z])=>{const qx=Math.cos(yaw)*x+Math.sin(yaw)*z,qz=-Math.sin(yaw)*x+Math.cos(yaw)*z;return [qx,Math.cos(pitch)*y-Math.sin(pitch)*qz,Math.sin(pitch)*y+Math.cos(pitch)*qz];});
  const min=[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i]))),center=min.map((v,i)=>(v+max[i])/2),scale=Math.min(canvas.width/(max[0]-min[0]||1),canvas.height/(max[1]-min[1]||1))*.78;
  const faces=mesh.triangles.map(f=>({f,z:f.reduce((s,i)=>s+vertices[i][2],0)/3})).sort((a,b)=>a.z-b.z);
  for(const {f}of faces){const ps=f.map(i=>vertices[i]);const shade=Math.round(115+65*(1+Math.sin(ps[0][2]))/2);ctx.beginPath();ps.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](canvas.width/2+(p[0]-center[0])*scale,canvas.height/2-(p[1]-center[1])*scale));ctx.closePath();ctx.fillStyle=`rgb(${shade+35},${shade+25},${shade})`;ctx.fill();ctx.strokeStyle='rgba(25,40,50,.15)';ctx.lineWidth=.4;ctx.stroke();}
  text('meshInfo',`${mesh.name} | ${mesh.vertices.length} vertices | ${mesh.triangles.length} triangles | display coordinates only`);
 }
 function showAsset(a){selected=a;meshes=[];render();text('assetTitle',a.title);text('details',`${a.kind} | ${a.status}\nLicense: ${a.license}\nLocal: ${a.local.status}\nUnits: ${a.units.status}\n${a.units.note}\n${a.notes}\n${a.attribution||'No geometry is included for this entry.'}`);$('source').href=a.sourceUrl;text('source','Open source and rights record');$('load').disabled=!a.local.available;$('structure').replaceChildren();text('meshInfo','');text('command',a.download?`node libraries/manager.mjs install ${a.id}`:'Metadata only. No download or clinical use is enabled.');}
 function list(){const query=$('search').value.toLowerCase();$('assets').replaceChildren();for(const a of registry.assets.filter(a=>JSON.stringify([a.title,a.kind,a.status,a.coverage]).toLowerCase().includes(query))){const b=document.createElement('button');b.textContent=`${a.title} · ${a.local.status}`;b.onclick=()=>showAsset(a);$('assets').append(b);}}
 $('search').oninput=list;
 $('load').onclick=async()=>{try{text('meshInfo','Reading and verifying local asset...');const r=await fetch('/asset/'+selected.id);if(!r.ok)throw Error((await r.json()).error);const bytes=await r.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes),sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');need(bytes.byteLength===selected.download.bytes&&sha===selected.download.sha256,'Browser checksum mismatch');meshes=parseAtlas(bytes);$('structure').replaceChildren();for(const [i,m]of meshes.entries()){const o=document.createElement('option');o.value=i;o.textContent=m.name+(selected.structureMap?.[m.name]?` | FDI ${selected.structureMap[m.name]}`:'');$('structure').append(o);}render();}catch(e){meshes=[];render();text('meshInfo',e.message);}};
 $('structure').onchange=render;$('left').onclick=()=>{yaw-=.25;render();};$('right').onclick=()=>{yaw+=.25;render();};$('up').onclick=()=>{pitch+=.2;render();};$('down').onclick=()=>{pitch-=.2;render();};$('reset').onclick=()=>{yaw=.5;pitch=.2;render();};
 fetch('/registry.json').then(r=>r.json()).then(r=>{registry=r;list();showAsset(r.assets[0]);}).catch(e=>text('details',e.message));render();
                                                        }
