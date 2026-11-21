import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {proposeLibraryPlacement} from './morphology-library.mjs';
// Input and output stay local. Never commit patient-derived inputs or proposals.
try {
  const [jobPath,outPath]=process.argv.slice(2);
  if(!jobPath||!outPath)throw Error('Usage: node research/place-library.mjs job.json proposal.json');
  const job=JSON.parse(await readFile(jobPath,'utf8'));
  const assetPath=resolve(dirname(jobPath),job.assetFile);
  if((await stat(assetPath)).size>25*1024*1024)throw Error('Asset exceeds 25 MiB research limit');
  const bytes=await readFile(assetPath);
  const scanPath=resolve(dirname(jobPath),job.scanFile);
  if((await stat(scanPath)).size>256*1024*1024)throw Error('Scan exceeds 256 MiB research limit');
  const scanBytes=await readFile(scanPath);
  const digest=await crypto.subtle.digest('SHA-256',scanBytes);
  const scanSha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength>25*1024*1024)throw Error('Asset exceeds 25 MiB research limit');
  const result=await proposeLibraryPlacement({...job,bytes,scanSha256});
  await writeFile(outPath,JSON.stringify(result,null,2),{flag:'wx'});
  console.log('Research-only placement saved. Clinical fit and CAM remain unassessed.');
}catch(e){console.error(e.message);process.exitCode=1;}
