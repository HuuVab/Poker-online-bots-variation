import {gateway,loadSecurityKey,unseal} from './security.mjs';
import {beginMfa,confirmMfa,consumeMfa,mfaEnabled} from './mfa.mjs';
import {backupManager} from './backups.mjs';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {readJsonBody} from './request-body.mjs';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {handleClub} from '../lib/club-api.mjs';
import {openDatabase} from './database.mjs';
import {hashPassword,validPassword,verifyPassword,createSession,sessionUser,sessionCookie} from './auth.mjs';

const identity=u=>({userId:u.id,email:u.email,displayName:u.name});
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const requireValue=(value,message,status=400)=>{if(!value)fail(message,status);};
const address=value=>typeof value==='string'?value.trim().toLowerCase():'';
const displayName=value=>typeof value==='string'?value.trim().replace(/[\u0000-\u001f]/g,'').slice(0,18):'';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav'};
export function createLocalServer({filename,staticRoot=resolve('local-dist'),now=()=>Date.now(),timerMs=1000,bodyTimeoutMs=3000,security={mode:'local'},securityKey,accessKeySet,backupDirectory}={}){
 const db=openDatabase(filename||resolve('data/riverroom.sqlite'));
 const publicMode=security.mode==='public',key=securityKey||(filename===':memory:'?randomBytes(32):loadSecurityKey(resolve(dirname(filename||'data/riverroom.sqlite'),'security.key'))),verifyGateway=gateway(security,{keySet:accessKeySet});
 const cookieOptions={secure:publicMode},cookie=(token='',age)=>sessionCookie(token,age,cookieOptions);
 const session=request=>{const u=sessionUser(db,request.headers.cookie,now(),{secure:publicMode,binding:request.gatewayIdentity?.binding||'',idleMs:publicMode?30*60*1000:Infinity});return u&&(!publicMode||u.email.toLowerCase()===request.gatewayIdentity?.email)?u:null;};
 const newSession=(user,request,mfa=false)=>createSession(db,user.id,now(),{binding:request.gatewayIdentity?.binding||'',mfa,elevated:mfa});
 const club=()=>{const row=db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get();return row?JSON.parse(row.state):null;};
 const ownerId=()=>db.sql.prepare("SELECT value FROM local_meta WHERE key='owner'").get()?.value;
 if(publicMode){const root=db.sql.prepare("SELECT value FROM local_meta WHERE key='owner'").get()?.value;if(!root||!mfaEnabled(db,root)){db.sql.close();throw new Error('Public mode requires an existing admin with verified MFA. Complete setup in local mode first.');}try{unseal(db.sql.prepare('SELECT secret FROM local_mfa WHERE user_id=?').get(root).secret,key);}catch{db.sql.close();throw new Error('The MFA security key does not match the database. Restore the original key.');}}
 let lastTickError=null,lastTickAt=null,closed=false,bodyReaders=0,running=false;const jobs=[],idleWaiters=[];
 const pump=()=>{if(running)return;if(!jobs.length){while(idleWaiters.length)idleWaiters.shift()();return;}running=true;const job=jobs.shift();Promise.resolve().then(job.fn).then(job.resolve,job.reject).finally(()=>{running=false;pump();});};
 const serial=(fn,priority=false)=>new Promise((resolve,reject)=>{if(!priority&&jobs.length>=64){reject(Object.assign(new Error('Server busy. Try again shortly.'),{status:503}));return;}const job={fn,resolve,reject};if(priority)jobs.unshift(job);else jobs.push(job);pump();});
 const idle=()=>running||jobs.length?new Promise(r=>idleWaiters.push(r)):Promise.resolve();
 const auditBuffer=[];let deniedWindow=0,deniedCount=0;
 const audit=(event,actor=null,status=200)=>{if(auditBuffer.length<200)auditBuffer.push({event,actor,status,at:now()});if(status===401||status===403||status===429){const window=Math.floor(now()/60000);if(window!==deniedWindow){deniedWindow=window;deniedCount=0;}if(++deniedCount===10){auditBuffer.push({event:'alert_auth_denials',actor:null,status:429,at:now()});console.error(JSON.stringify({event:'alert_auth_denials',at:new Date(now()).toISOString()}));}}};
 const flushAudit=()=>{const events=auditBuffer.splice(0);if(!events.length)return;db.sql.exec('SAVEPOINT security_audit');try{const insert=db.sql.prepare('INSERT INTO local_security_events VALUES (?,?,?,?,?)');for(const e of events)insert.run(randomUUID(),e.at,e.event,e.actor,e.status);db.sql.exec('DELETE FROM local_security_events WHERE id IN (SELECT id FROM local_security_events ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 10000)');db.sql.exec('RELEASE security_audit');}catch(e){db.sql.exec('ROLLBACK TO security_audit; RELEASE security_audit');throw e;}};
 const backups=backupDirectory?backupManager(db,{directory:backupDirectory,key,onEvent:event=>{audit(event,null,event==='backup_failed'?500:200);if(event==='backup_failed')console.error(JSON.stringify({event,at:new Date().toISOString()}));}}):null;
 const sessionInfo=(request,user)=>({id:user.id,name:user.name,email:user.email,admin:user.id===ownerId(),mfaEnabled:mfaEnabled(db,user.id),elevatedUntil:user.elevatedUntil||0});
 const call=async(user,body,config={})=>{
  const root=db.sql.prepare('SELECT email FROM local_users WHERE id=?').get(ownerId());
  return handleClub(new Request('http://localhost/api/table',{method:'POST',body:JSON.stringify({requestId:randomUUID(),...body})}),db,identity(user),{ownerEmail:root?.email,now:now(),...config});
 };
 const checkedCall=async(user,body)=>{const response=await call(user,body),data=await response.json();if(!response.ok)fail(data.error,response.status);return data;};
 const transaction=async fn=>{db.sql.exec('BEGIN IMMEDIATE');try{const value=await fn();db.sql.exec('COMMIT');return value;}catch(e){db.sql.exec('ROLLBACK');throw e;}};
 function authenticated(request){
  const u=session(request);requireValue(u,'Sign in to your local account.',401);
  requireValue(!publicMode||u.id!==ownerId()||u.mfa===1,'Admin MFA sign-in is required.',401);request.authenticatedUser=u;
  requireValue(club()?.members[u.id]?.status==='active','Account access is inactive. Contact the admin.',403);return u;
 }
 function admin(request,elevated=false){const u=authenticated(request);requireValue(u.id===ownerId()&&club()?.ownerId===u.id,'Only the admin can manage accounts.',403);if(elevated&&publicMode)requireValue(u.elevatedUntil>now(),'Confirm your password and authenticator in Account and server management before this action.',403);return u;}
 const attempts=new Map();
 function authRate(request,email){
  const at=now();for(const [key,v] of attempts)if(at-v.at>60000)attempts.delete(key);
  for(const [key,limit] of [[`ip:${request.gatewayIdentity?.ip||request.socket.remoteAddress}`,30],[`email:${email}`,10]]){requireValue(attempts.has(key)||attempts.size<4096,'Authentication capacity reached. Try again shortly.',429);const v=attempts.get(key)||{at,count:0};v.count++;attempts.set(key,v);requireValue(v.count<=limit,'Too many sign-in attempts. Wait one minute.',429);}
 }
 async function route(request,url,b){
  const path=url.pathname;
  if(path==='/api/local/session'&&request.method==='GET'){
   const user=session(request),c=club();return json({setupRequired:!publicMode&&!ownerId()&&!c,publicMode,user:user&&c?.members[user.id]?.status==='active'&&(!publicMode||user.id!==ownerId()||user.mfa===1)?sessionInfo(request,user):null});
  }
  if(path==='/api/local/admin'&&request.method==='GET'){
   admin(request,true);flushAudit();const c=club();return json({accounts:db.sql.prepare('SELECT id,email,name,created_at FROM local_users ORDER BY created_at').all().map(u=>({...u,role:c.members[u.id]?.role,status:c.members[u.id]?.status})),server:{host:'127.0.0.1',database:filename||resolve('data/riverroom.sqlite'),clock:'running',lastTickError,lastTickAt,publicMode,backups:backups?.status||null,securityEvents:db.sql.prepare('SELECT created_at,event,status FROM local_security_events ORDER BY created_at DESC,rowid DESC LIMIT 30').all(),settingsScope:'New tables and registrations only'}});
  }
  if(path==='/api/table'){
   requireValue(request.method==='POST','Use POST.',405);const u=authenticated(request),payload=b;if(publicMode&&u.id===ownerId()&&['member','grant-tickets','settings','invite','revoke'].includes(payload.action))admin(request,true);const response=await call(u,payload);const data=await response.json();
   if(data.club)data.club.clockMode='server';if(data.room){data.room.clockMode='server';if(data.room.tournament)data.room.tournament.clockMode='server';}if(data.club?.tournaments)for(const t of data.club.tournaments)t.clockMode='server';
   if(response.ok&&payload.action==='member'&&payload.status!=='active')db.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(payload.memberId);
   if(!['status','state','history'].includes(payload.action))audit('game_'+(['grant-tickets','member','settings','invite','revoke'].includes(payload.action)?payload.action:'mutation'),u.id,response.status);return json(data,response.status);
  }
  requireValue(request.method==='POST','Use POST.',405);
  if(path==='/api/local/setup'){
   requireValue(!publicMode&&!ownerId()&&!club(),'The server already has an admin or public setup is disabled.',409);authRate(request,address(b.email));
   const email=address(b.email),name=displayName(b.name),clubName=typeof b.clubName==='string'?b.clubName.trim().slice(0,50):'';requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&name&&clubName,'Enter your name, email and club name.');
   requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const password=await hashPassword(b.password),u={id:randomUUID(),email,name};
   const token=await transaction(async()=>{db.sql.prepare('INSERT INTO local_users VALUES (?,?,?,?,?)').run(u.id,email,name,password,now());db.sql.prepare('INSERT INTO local_meta VALUES (?,?)').run('owner',u.id);await checkedCall(u,{action:'setup',name:clubName});return newSession(u,request);});
   return json({ok:true},201,{'Set-Cookie':cookie(token)});
  }
  if(path==='/api/local/login'){
   const email=address(b.email);authRate(request,email);const u=db.sql.prepare('SELECT * FROM local_users WHERE email=?').get(email);
   // A fixed dummy hash keeps unknown-account verification on the same scrypt path.
   const dummy='00000000000000000000000000000000:'+ '00'.repeat(32);
   const good=await verifyPassword(b.password,u?.password||dummy);requireValue(good&&u&&club()?.members[u.id]?.status==='active','Email or password is incorrect, or access is inactive.',401);
   requireValue(!publicMode||request.gatewayIdentity.email===u.email.toLowerCase(),'Gateway identity must match the local account.',403);const hasMfa=mfaEnabled(db,u.id);const token=await transaction(async()=>{if(hasMfa)requireValue(consumeMfa(db,u,key,b,now()),'A valid unused authenticator or recovery code is required.',401);return newSession(u,request,hasMfa);});return json({ok:true},200,{'Set-Cookie':cookie(token)});
  }
  if(path==='/api/local/mfa/begin'){
   const u=admin(request);authRate(request,u.email);const current=db.sql.prepare('SELECT password FROM local_users WHERE id=?').get(u.id);requireValue(await verifyPassword(b.password,current.password),'Current password is incorrect.',403);return json(beginMfa(db,u,key,now()));
  }
  if(path==='/api/local/mfa/confirm'){
   const u=admin(request);authRate(request,u.email);const recoveryCodes=await transaction(async()=>{const codes=confirmMfa(db,u,key,b.code,now());requireValue(codes,'The enrollment code is invalid or expired.');db.sql.prepare('DELETE FROM local_sessions WHERE user_id=? AND token_hash<>?').run(u.id,u.tokenHash);db.sql.prepare('INSERT INTO local_session_security VALUES (?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET mfa=1,elevated_until=excluded.elevated_until,last_seen=excluded.last_seen').run(u.tokenHash,u.binding||'',1,now()+10*60*1000,now());return codes;});return json({recoveryCodes});
  }
  if(path==='/api/local/reauth'){
   const u=admin(request);authRate(request,u.email);const current=db.sql.prepare('SELECT password FROM local_users WHERE id=?').get(u.id);requireValue(await verifyPassword(b.password,current.password),'Current password is incorrect.',403);if(mfaEnabled(db,u.id))requireValue(consumeMfa(db,u,key,b,now()),'An unused authenticator or recovery code is required.',403);else requireValue(!publicMode,'Enable MFA locally before public access.',403);db.sql.prepare('INSERT INTO local_session_security VALUES (?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET elevated_until=excluded.elevated_until,last_seen=excluded.last_seen').run(u.tokenHash,u.binding||'',u.mfa||0,now()+10*60*1000,now());return json({ok:true,elevatedUntil:now()+10*60*1000});
  }
  if(path==='/api/local/backup'){
   admin(request,true);requireValue(backups,'Backups are not configured.',503);await backups.run();return json({ok:true,status:backups.status});
  }
  if(path==='/api/local/logout'){
   const u=session(request);if(u)db.sql.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(u.tokenHash);return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(path==='/api/local/accounts'){
   const root=admin(request,true),email=address(b.email),name=displayName(b.name);requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&name,'Enter a valid name and email.');requireValue(['member','host'].includes(b.role),'Choose Member or Host.');requireValue(!db.sql.prepare('SELECT id FROM local_users WHERE email=?').get(email),'An account already uses that email.',409);
   requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const password=await hashPassword(b.password),u={id:randomUUID(),email,name};
   await transaction(async()=>{await checkedCall(root,{action:'invite',email,role:b.role});db.sql.prepare('INSERT INTO local_users VALUES (?,?,?,?,?)').run(u.id,email,name,password,now());await checkedCall(u,{action:'accept'});});return json({ok:true},201);
  }
  if(path==='/api/local/password'){
   const u=authenticated(request);authRate(request,u.email);const current=db.sql.prepare('SELECT password FROM local_users WHERE id=?').get(u.id);requireValue(await verifyPassword(b.currentPassword,current.password),'Current password is incorrect.',403);
   requireValue(validPassword(b.password),'Use a password with 12–256 characters.');if(mfaEnabled(db,u.id))requireValue(consumeMfa(db,u,key,b,now()),'An unused authenticator or recovery code is required.',403);const hash=await hashPassword(b.password);const token=await transaction(async()=>{db.sql.prepare('UPDATE local_users SET password=? WHERE id=?').run(hash,u.id);db.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(u.id);return newSession(u,request,mfaEnabled(db,u.id));});return json({ok:true},200,{'Set-Cookie':cookie(token)});
  }
  if(path==='/api/local/reset-password'){
   const root=admin(request,true);requireValue(typeof b.memberId==='string'&&b.memberId!==root.id,'Use Change my password for your own account.');requireValue(db.sql.prepare('SELECT id FROM local_users WHERE id=?').get(b.memberId),'Account not found.',404);requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const hash=await hashPassword(b.password);
   await transaction(async()=>{db.sql.prepare('UPDATE local_users SET password=? WHERE id=?').run(hash,b.memberId);db.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(b.memberId);});return json({ok:true});
  }
  return json({error:'Not found.'},404);
 }
 const ingressBuckets=new Map();function ingress(id,limit){const window=Math.floor(now()/60000);if(ingressBuckets.size>4096)for(const [k,v] of ingressBuckets)if(v.window!==window)ingressBuckets.delete(k);requireValue(ingressBuckets.has(id)||ingressBuckets.size<4096,'Request capacity reached. Try again shortly.',429);const value=ingressBuckets.get(id);const bucket=value?.window===window?value:{window,count:0};bucket.count++;ingressBuckets.set(id,bucket);requireValue(bucket.count<=limit,'Request rate limit exceeded.',429);}
 async function respond(response,result){
  response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
 }
 const server=createServer(async(request,response)=>{
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','same-origin');response.setHeader('X-Frame-Options','DENY');response.setHeader('Cache-Control','no-store');
  if(publicMode)response.setHeader('Strict-Transport-Security','max-age=31536000');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   requireValue(!closed,'Server is shutting down.',503);
   const port=server.address()?.port,hosts=[`localhost:${port}`,`127.0.0.1:${port}`],proxied=['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip','cf-connecting-ip','cf-access-jwt-assertion'].some(name=>request.headers[name]!==undefined);
   if(!publicMode)requireValue(!proxied,'Proxy access is disabled in local mode.',403);
   if(!proxied&&request.method==='GET'&&request.url==='/healthz'&&hosts.includes(request.headers.host)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress)){
    const healthy=(!ownerId()||lastTickAt!==null&&now()-lastTickAt<10000)&&!lastTickError&&!backups?.status.lastError;await respond(response,json({status:healthy?'ok':'degraded'},healthy?200:503));return;
   }
   ingress(request.socket.remoteAddress,2400);
   if(publicMode){request.gatewayIdentity=await verifyGateway(request,now());ingress('client:'+request.gatewayIdentity.ip,600);}else requireValue(hosts.includes(request.headers.host),'Localhost access only.',403);
   const expected=publicMode?security.origin:`http://${request.headers.host}`,url=new URL(request.url,expected);requireValue(url.origin===expected,'Invalid request URL.',400);
   if(url.pathname.startsWith('/api/')){
    if(request.method!=='GET')requireValue(request.headers.origin===url.origin&&request.headers['sec-fetch-site']!=='cross-site','Cross-site request refused.',403);
    let payload;if(request.method==='POST'){if(bodyReaders>=32)throw Object.assign(new Error('Too many open requests. Try again shortly.'),{status:429,closeConnection:true});bodyReaders++;try{payload=await readJsonBody(request,{timeoutMs:bodyTimeoutMs});}finally{bodyReaders--;}}const result=await serial(async()=>{const result=await route(request,url,payload);if(url.pathname.startsWith('/api/local/')&&request.method==='POST'){const kind=['setup','login','logout','password','reset-password','accounts','begin','confirm','reauth','backup'].includes(url.pathname.split('/').at(-1))?url.pathname.split('/').at(-1):'unknown';audit('auth_'+kind,request.authenticatedUser?.id||null,result.status);}flushAudit();return result;});await respond(response,result);return;
   }
   requireValue(['GET','HEAD'].includes(request.method),'Use GET.',405);
   let path;try{path=decodeURIComponent(url.pathname);}catch{fail('Invalid request URL.',400);}requireValue(!path.includes('\\')&&!path.split('/').some(s=>s.startsWith('.')),'Not found.',404);
   const file=resolve(staticRoot,path==='/'?'index.html':'.'+path),rel=relative(resolve(staticRoot),file);requireValue(!rel.startsWith('..')&&!!MIME[extname(file)],'Not found.',404);
   const info=await stat(file);requireValue(info.isFile(),'Not found.',404);response.setHeader('Content-Type',MIME[extname(file)]);response.setHeader('Content-Length',info.size);response.end(request.method==='HEAD'?undefined:await readFile(file));
  }catch(e){if([401,403,429].includes(e.status))audit('request_denied',request.authenticatedUser?.id||null,e.status);if(e.closeConnection)response.setHeader('Connection','close');if(response.headersSent){response.destroy();return;}await respond(response,json({error:e.status?e.message:e.code==='ENOENT'?'Not found.':'The server could not complete the request.'},e.status|| (e.code==='ENOENT'?404:500)));if(!e.status&&e.code!=='ENOENT')console.error('Local server request failed:',e.name);}
 });
 server.maxConnections=128;server.requestTimeout=15000;server.headersTimeout=10000;
 async function tick(){
  flushAudit();const id=ownerId();if(!id)return;const u=db.sql.prepare('SELECT id,email,name FROM local_users WHERE id=?').get(id);if(!u)return;
  const response=await call(u,{action:'status'},{internalTick:true});if(!response.ok)throw new Error(`Game clock failed (${response.status})`);lastTickError=null;lastTickAt=now();
 }
 let clockPending=null;const runTick=()=>{if(!clockPending)clockPending=serial(tick,true).finally(()=>{clockPending=null;});return clockPending;};
 const timer=timerMs>0?setInterval(()=>{if(!closed)runTick().catch(e=>{lastTickError=e.message;audit('clock_failed',null,500);console.error(JSON.stringify({event:'clock_failed',at:new Date().toISOString()}));});},timerMs):null;timer?.unref();
 return{server,db,backup:()=>backups?.run(),backupStatus:backups?.status,tick:runTick,async close(){closed=true;if(timer)clearInterval(timer);await backups?.close();await new Promise((done,reject)=>server.listening?server.close(e=>e?reject(e):done()):done());await idle();flushAudit();db.sql.close();}};
}
