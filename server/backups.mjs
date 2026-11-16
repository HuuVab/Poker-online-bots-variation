import {backup,DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,open,readdir,rename,unlink,stat} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pipeline} from 'node:stream/promises';
const MAGIC=Buffer.from('RIVERROOM-BACKUP-1\n');
const within=(dir,path)=>dirname(resolve(path))===resolve(dir);
async function removeOwned(dir,path){if(!within(dir,path))throw new Error('Backup path escaped its directory.');try{await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}}
export function backupManager(db,{directory,key,intervalMs=6*60*60*1000,retain=14,onEvent=()=>{}}){
 const dir=resolve(directory);let pending=null,closed=false;const status={lastSuccess:null,lastError:null};
 async function make(){
  await mkdir(dir,{recursive:true});for(const name of await readdir(dir))if(/^riverroom-[\dTZ-]+-[a-f0-9]{8}\.(sqlite|rrbackup)\.tmp$/.test(name))await removeOwned(dir,resolve(dir,name));
  const stem='riverroom-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex'),plain=resolve(dir,stem+'.sqlite.tmp'),encrypted=resolve(dir,stem+'.rrbackup.tmp'),final=resolve(dir,stem+'.rrbackup');
  try{
   await backup(db.sql,plain);const check=new DatabaseSync(plain,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed.');}finally{check.close();}
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);const handle=await open(encrypted,'wx',0o600);try{await handle.write(Buffer.concat([MAGIC,iv]));}finally{await handle.close();}
   await pipeline(createReadStream(plain),cipher,createWriteStream(encrypted,{flags:'a',mode:0o600}));const out=await open(encrypted,'a');try{await out.write(cipher.getAuthTag());}finally{await out.close();}await rename(encrypted,final);
   const files=(await readdir(dir)).filter(n=>/^riverroom-[\dTZ-]+-[a-f0-9]{8}\.rrbackup$/.test(n)).sort().reverse();for(const name of files.slice(retain))await removeOwned(dir,resolve(dir,name));status.lastSuccess=Date.now();status.lastError=null;onEvent('backup_success');return final;
  }catch(e){status.lastError='Backup failed; check storage and key permissions.';onEvent('backup_failed');throw e;}finally{await removeOwned(dir,plain);await removeOwned(dir,encrypted);}
 }
 const run=()=>{if(closed)return Promise.reject(new Error('Backup manager is closed.'));if(!pending)pending=make().finally(()=>{pending=null;});return pending;};
 const timer=intervalMs>0?setInterval(()=>run().catch(()=>{}),intervalMs):null;timer?.unref();
 return{run,status,async close(){closed=true;if(timer)clearInterval(timer);if(pending)await pending.catch(()=>{});}};
}
export async function restoreBackup({file,output,key}){
 const source=resolve(file),target=resolve(output),dir=dirname(target),temp=resolve(dir,basename(target)+'.restore-'+randomBytes(6).toString('hex'));
 try{await stat(target);throw new Error('Restore output already exists. Choose a NEW database path.');}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(dir,{recursive:true});const input=await open(source,'r');let size,head,tag;try{size=(await input.stat()).size;if(size<MAGIC.length+12+16)throw new Error('Invalid backup.');head=Buffer.alloc(MAGIC.length+12);tag=Buffer.alloc(16);await input.read(head,0,head.length,0);await input.read(tag,0,16,size-16);}finally{await input.close();}
 if(!head.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Invalid backup format.');const decipher=createDecipheriv('aes-256-gcm',key,head.subarray(MAGIC.length));decipher.setAAD(MAGIC);decipher.setAuthTag(tag);
 try{
  await pipeline(createReadStream(source,{start:head.length,end:size-17}),decipher,createWriteStream(temp,{flags:'wx',mode:0o600}));
  const db=new DatabaseSync(temp);try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Restored database failed integrity check.');db.exec('PRAGMA foreign_keys=ON; DELETE FROM local_sessions; DELETE FROM local_mfa_pending;');}finally{db.close();}
  // link() creates the final name without replacing an existing target.
  const {link}=await import('node:fs/promises');await link(temp,target);return target;
 }finally{await removeOwned(dir,temp);}
}
