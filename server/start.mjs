import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {existsSync,writeFileSync,readFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {createLocalServer} from './app.mjs';
import {deploymentConfig} from './security.mjs';
import {privateStorage} from './storage.mjs';
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be 1024–65535.');
if(!existsSync(resolve('local-dist/index.html')))throw new Error('Run npm run build:local first.');
const filename=resolve(process.env.RIVERROOM_DB||'data/riverroom.sqlite'),lock=filename+'.server.lock';mkdirSync(dirname(filename),{recursive:true});
try{writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid server lock; inspect it before restarting.');let active=true;try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')active=false;else throw error;}if(active)throw new Error('Another server process already owns this database.');unlinkSync(lock);writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}
const release=()=>{if(existsSync(lock)&&readFileSync(lock,'utf8')===String(process.pid))unlinkSync(lock);};process.on('exit',release);
const security=deploymentConfig();
const backupDirectory=resolve(process.env.RIVERROOM_BACKUPS||resolve(dirname(filename),'backups'));
if(security.mode==='public'){
 const backupPath=relative(dirname(filename),backupDirectory);if(backupPath.startsWith('..')||isAbsolute(backupPath))throw new Error('Public-mode backup scratch storage must be inside the private database directory. Copy encrypted snapshots off-device separately.');
 if(process.platform!=='win32')throw new Error('This public launcher requires the Windows storage check. Configure an equivalent private-storage policy before porting it.');
 if(!privateStorage(dirname(filename)))throw new Error('Public mode requires private storage ACLs. Run server/protect-data.ps1 as the server account first.');
}
const app=createLocalServer({filename,security,backupDirectory});
await app.backup();
app.server.on('error',async e=>{console.error(`Could not start localhost server: ${e.code||e.message}`);await app.close();process.exitCode=1;});
app.server.listen(port,'127.0.0.1',()=>console.log(`Riverroom server: ${security.mode==='public'?security.origin:'http://localhost:'+port}\nOrigin listener: 127.0.0.1:${port} · ${security.mode} mode\nDatabase: ${filename}\nSign in or complete first-time setup locally. Ctrl+C stops the server.`));
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
