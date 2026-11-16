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
export function createLocalServer({filename,staticRoot=resolve('local-dist'),now=()=>Date.now(),timerMs=1000,bodyTimeoutMs=3000}={}){
 const db=openDatabase(filename||resolve('data/riverroom.sqlite'));
 const club=()=>{const row=db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get();return row?JSON.parse(row.state):null;};
 const ownerId=()=>db.sql.prepare("SELECT value FROM local_meta WHERE key='owner'").get()?.value;
 let chain=Promise.resolve(),lastTickError=null,closed=false,queued=0,bodyReaders=0;
 const serial=fn=>{if(queued>=64)return Promise.reject(Object.assign(new Error('Server busy. Try again shortly.'),{status:503}));queued++;const next=chain.then(fn).finally(()=>queued--);chain=next.catch(()=>{});return next;};
 const call=async(user,body,config={})=>{
  const root=db.sql.prepare('SELECT email FROM local_users WHERE id=?').get(ownerId());
  return handleClub(new Request('http://localhost/api/table',{method:'POST',body:JSON.stringify({requestId:randomUUID(),...body})}),db,identity(user),{ownerEmail:root?.email,now:now(),...config});
 };
 const checkedCall=async(user,body)=>{const response=await call(user,body),data=await response.json();if(!response.ok)fail(data.error,response.status);return data;};
 const transaction=async fn=>{db.sql.exec('BEGIN IMMEDIATE');try{const value=await fn();db.sql.exec('COMMIT');return value;}catch(e){db.sql.exec('ROLLBACK');throw e;}};
 function authenticated(request){
  const u=sessionUser(db,request.headers.cookie,now());requireValue(u,'Sign in to your local account.',401);
  requireValue(club()?.members[u.id]?.status==='active','Account access is inactive. Contact the admin.',403);return u;
 }
 function admin(request){const u=authenticated(request);requireValue(u.id===ownerId()&&club()?.ownerId===u.id,'Only the admin can manage accounts.',403);return u;}
 const attempts=new Map();
 function authRate(request,email){
  const at=now();for(const [key,v] of attempts)if(at-v.at>60000)attempts.delete(key);
  for(const [key,limit] of [[`ip:${request.socket.remoteAddress}`,30],[`email:${email}`,10]]){const v=attempts.get(key)||{at,count:0};v.count++;attempts.set(key,v);requireValue(v.count<=limit,'Too many sign-in attempts. Wait one minute.',429);}
 }
 async function route(request,url,b){
  const path=url.pathname;
  if(path==='/api/local/session'&&request.method==='GET'){
   const user=sessionUser(db,request.headers.cookie,now()),c=club();return json({setupRequired:!ownerId()&&!c,user:user&&c?.members[user.id]?.status==='active'?{id:user.id,name:user.name,email:user.email,admin:user.id===ownerId()}:null});
  }
  if(path==='/api/local/admin'&&request.method==='GET'){
   admin(request);const c=club();return json({accounts:db.sql.prepare('SELECT id,email,name,created_at FROM local_users ORDER BY created_at').all().map(u=>({...u,role:c.members[u.id]?.role,status:c.members[u.id]?.status})),server:{host:'127.0.0.1',database:filename||resolve('data/riverroom.sqlite'),clock:'running',lastTickError,settingsScope:'New tables and registrations only'}});
  }
  if(path==='/api/table'){
   requireValue(request.method==='POST','Use POST.',405);const u=authenticated(request),payload=b;const response=await call(u,payload);const data=await response.json();
   if(data.club)data.club.clockMode='server';if(data.room){data.room.clockMode='server';if(data.room.tournament)data.room.tournament.clockMode='server';}if(data.club?.tournaments)for(const t of data.club.tournaments)t.clockMode='server';
   if(response.ok&&payload.action==='member'&&payload.status!=='active')db.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(payload.memberId);
   return json(data,response.status);
  }
  requireValue(request.method==='POST','Use POST.',405);
  if(path==='/api/local/setup'){
   requireValue(!ownerId()&&!club(),'The server already has an admin.',409);authRate(request,address(b.email));
   const email=address(b.email),name=displayName(b.name),clubName=typeof b.clubName==='string'?b.clubName.trim().slice(0,50):'';requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&name&&clubName,'Enter your name, email and club name.');
   requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const password=await hashPassword(b.password),u={id:randomUUID(),email,name};
   const token=await transaction(async()=>{db.sql.prepare('INSERT INTO local_users VALUES (?,?,?,?,?)').run(u.id,email,name,password,now());db.sql.prepare('INSERT INTO local_meta VALUES (?,?)').run('owner',u.id);await checkedCall(u,{action:'setup',name:clubName});return createSession(db,u.id,now());});
   return json({ok:true},201,{'Set-Cookie':sessionCookie(token)});
  }
  if(path==='/api/local/login'){
   const email=address(b.email);authRate(request,email);const u=db.sql.prepare('SELECT * FROM local_users WHERE email=?').get(email);
   // A fixed dummy hash keeps unknown-account verification on the same scrypt path.
   const dummy='00000000000000000000000000000000:'+ '00'.repeat(32);
   const good=await verifyPassword(b.password,u?.password||dummy);requireValue(good&&u&&club()?.members[u.id]?.status==='active','Email or password is incorrect, or access is inactive.',401);
   return json({ok:true},200,{'Set-Cookie':sessionCookie(createSession(db,u.id,now()))});
  }
  if(path==='/api/local/logout'){
   const u=sessionUser(db,request.headers.cookie,now());if(u)db.sql.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(u.tokenHash);return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
  }
  if(path==='/api/local/accounts'){
   const root=admin(request),email=address(b.email),name=displayName(b.name);requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&name,'Enter a valid name and email.');requireValue(['member','host'].includes(b.role),'Choose Member or Host.');requireValue(!db.sql.prepare('SELECT id FROM local_users WHERE email=?').get(email),'An account already uses that email.',409);
   requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const password=await hashPassword(b.password),u={id:randomUUID(),email,name};
   await transaction(async()=>{await checkedCall(root,{action:'invite',email,role:b.role});db.sql.prepare('INSERT INTO local_users VALUES (?,?,?,?,?)').run(u.id,email,name,password,now());await checkedCall(u,{action:'accept'});});return json({ok:true},201);
  }
  if(path==='/api/local/password'){
   const u=authenticated(request);authRate(request,u.email);const current=db.sql.prepare('SELECT password FROM local_users WHERE id=?').get(u.id);requireValue(await verifyPassword(b.currentPassword,current.password),'Current password is incorrect.',403);
   requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const hash=await hashPassword(b.password);const token=await transaction(async()=>{db.sql.prepare('UPDATE local_users SET password=? WHERE id=?').run(hash,u.id);db.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(u.id);return createSession(db,u.id,now());});return json({ok:true},200,{'Set-Cookie':sessionCookie(token)});
  }
  if(path==='/api/local/reset-password'){
   const root=admin(request);requireValue(typeof b.memberId==='string'&&b.memberId!==root.id,'Use Change my password for your own account.');requireValue(db.sql.prepare('SELECT id FROM local_users WHERE id=?').get(b.memberId),'Account not found.',404);requireValue(validPassword(b.password),'Use a password with 12–256 characters.');const hash=await hashPassword(b.password);
   await transaction(async()=>{db.sql.prepare('UPDATE local_users SET password=? WHERE id=?').run(hash,b.memberId);db.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(b.memberId);});return json({ok:true});
  }
  return json({error:'Not found.'},404);
 }
 async function respond(response,result){
  response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));
 }
 const server=createServer(async(request,response)=>{
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','same-origin');response.setHeader('X-Frame-Options','DENY');response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const port=server.address()?.port,hosts=[`localhost:${port}`,`127.0.0.1:${port}`];requireValue(hosts.includes(request.headers.host),'Localhost access only.',403);
   const url=new URL(request.url,`http://${request.headers.host}`);requireValue(url.origin===`http://${request.headers.host}`,'Invalid request URL.',400);
   if(url.pathname.startsWith('/api/')){
    if(request.method!=='GET')requireValue(request.headers.origin===url.origin&&request.headers['sec-fetch-site']!=='cross-site','Cross-site request refused.',403);
    let payload;if(request.method==='POST'){if(bodyReaders>=32)throw Object.assign(new Error('Too many open requests. Try again shortly.'),{status:429,closeConnection:true});bodyReaders++;try{payload=await readJsonBody(request,{timeoutMs:bodyTimeoutMs});}finally{bodyReaders--;}}const result=await serial(()=>route(request,url,payload));await respond(response,result);return;
   }
   requireValue(['GET','HEAD'].includes(request.method),'Use GET.',405);
   let path;try{path=decodeURIComponent(url.pathname);}catch{fail('Invalid request URL.',400);}requireValue(!path.includes('\\')&&!path.split('/').some(s=>s.startsWith('.')),'Not found.',404);
   const file=resolve(staticRoot,path==='/'?'index.html':'.'+path),rel=relative(resolve(staticRoot),file);requireValue(!rel.startsWith('..')&&!!MIME[extname(file)],'Not found.',404);
   const info=await stat(file);requireValue(info.isFile(),'Not found.',404);response.setHeader('Content-Type',MIME[extname(file)]);response.setHeader('Content-Length',info.size);response.end(request.method==='HEAD'?undefined:await readFile(file));
  }catch(e){if(e.closeConnection)response.setHeader('Connection','close');if(response.headersSent){response.destroy();return;}await respond(response,json({error:e.status?e.message:e.code==='ENOENT'?'Not found.':'The server could not complete the request.'},e.status|| (e.code==='ENOENT'?404:500)));if(!e.status&&e.code!=='ENOENT')console.error('Local server request failed:',e.name);}
 });
 server.maxConnections=128;server.requestTimeout=15000;server.headersTimeout=10000;
 async function tick(){
  const id=ownerId();if(!id)return;const u=db.sql.prepare('SELECT id,email,name FROM local_users WHERE id=?').get(id);if(!u)return;
  const response=await call(u,{action:'status'},{internalTick:true});if(!response.ok)throw new Error(`Game clock failed (${response.status})`);lastTickError=null;
 }
 const timer=timerMs>0?setInterval(()=>{if(!closed)serial(tick).catch(e=>{lastTickError=e.message;console.error(e.message);});},timerMs):null;timer?.unref();
 return{server,db,tick:()=>serial(tick),async close(){closed=true;if(timer)clearInterval(timer);await new Promise((done,reject)=>server.listening?server.close(e=>e?reject(e):done()):done());await chain;db.sql.close();}};
}
