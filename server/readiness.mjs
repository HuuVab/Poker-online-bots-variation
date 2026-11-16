import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {deploymentConfig,unseal} from './security.mjs';
import {privateStorage} from './storage.mjs';
const filename=resolve(process.env.RIVERROOM_DB||'data/riverroom.sqlite'),checks=[];
try{deploymentConfig({...process.env,RIVERROOM_MODE:'public'});checks.push({check:'HTTPS domain and pinned Access application',ok:true});}catch(e){checks.push({check:'HTTPS domain and pinned Access application',ok:false,detail:e.message});}
let db;
try{db=new DatabaseSync(filename,{readOnly:true});const root=db.prepare("SELECT value FROM local_meta WHERE key='owner'").get()?.value;checks.push({check:'Existing admin; public signup disabled',ok:!!root});const mfa=root&&db.prepare('SELECT secret FROM local_mfa WHERE user_id=?').get(root),key=readFileSync(resolve(dirname(filename),'security.key'));if(mfa)unseal(mfa.secret,key);checks.push({check:'Verified admin MFA and matching encryption key',ok:!!mfa});checks.push({check:'SQLite integrity',ok:db.prepare('PRAGMA quick_check').get().quick_check==='ok'});}catch(e){checks.push({check:'Admin database and security key',ok:false,detail:'Start locally, create the admin, and enroll MFA first.'});}finally{db?.close();}
if(process.platform==='win32'){
 checks.push({check:'Private Windows storage ACLs',ok:privateStorage(dirname(filename))});
}else checks.push({check:'Private storage permissions',ok:false,detail:'Verify file ownership and permissions for this operating system.'});
checks.push({check:'Built client',ok:existsSync(resolve('local-dist/index.html'))});
for(const c of checks)console.log(`${c.ok?'PASS':'PENDING'}  ${c.check}${c.detail?' — '+c.detail:''}`);
if(checks.some(c=>!c.ok))process.exitCode=1;else console.log('Local prerequisites pass. Real DNS, Access policy, tunnel and remote-device checks are still required before inviting players.');
