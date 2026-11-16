import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {TOTP} from 'otpauth';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {createLocalServer} from '../server/app.mjs';
import {deploymentConfig} from '../server/security.mjs';
import {restoreBackup} from '../server/backups.mjs';
import {DatabaseSync} from 'node:sqlite';

const password='Synthetic-admin-password-123',security={mode:'public',origin:'https://poker.example.test',team:'https://riverroom-test.cloudflareaccess.com',audience:'a'.repeat(64)};
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'riverroom-public-')),filename=join(dir,'club.sqlite'),key=randomBytes(32);let now=1800000000000,app=createLocalServer({filename,securityKey:key,timerMs:0});let base,cookie='';
 const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;};await listen();
 const raw=(path,body,headers={})=>new Promise((resolve,reject)=>{const req=httpRequest(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),Cookie:cookie,...headers}},r=>{let text='';r.on('data',c=>text+=c);r.on('end',()=>{let data;try{data=JSON.parse(text);}catch{}resolve({status:r.statusCode,data,headers:r.headers,text});});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
 // Recreate with the controlled clock before initializing synthetic credentials.
 await app.close();app=createLocalServer({filename,securityKey:key,timerMs:0,now:()=>now});await listen();
 let r=await raw('/api/local/setup',{name:'Admin',email:'owner@example.test',password,clubName:'Public test'});assert.equal(r.status,201);cookie=r.headers['set-cookie'][0].split(';')[0];
 r=await raw('/api/local/mfa/begin',{password});assert.equal(r.status,200);const secret=r.data.secret,otp=()=>new TOTP({secret}).generate({timestamp:now});r=await raw('/api/local/mfa/confirm',{code:otp()});assert.equal(r.status,200);const recoveryCodes=r.data.recoveryCodes;
 const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='test-key';const keySet=createLocalJWKSet({keys:[jwk]});
 const sign=async(claims={},signingKey=pair.privateKey)=>new SignJWT({email:'owner@example.test',type:'app',...claims}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(security.team).setAudience(security.audience).setSubject('owner-gateway-id').setIssuedAt(Math.floor(now/1000)).setExpirationTime(Math.floor(now/1000)+3600).sign(signingKey);
 const publicRequest=async(path,body,{token,headers={}}={})=>raw(path,body,{Host:new URL(security.origin).host,Origin:security.origin,'X-Forwarded-Proto':'https','Cf-Connecting-Ip':'203.0.113.4','Cf-Access-Jwt-Assertion':token||await sign(),...headers});
 async function publicMode(){await app.close();app=createLocalServer({filename,securityKey:key,timerMs:0,now:()=>now,security,accessKeySet:keySet,backupDirectory:join(dir,'backups')});cookie='';await listen();}
 t.after(async()=>{await app.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(resolve(dir).includes('riverroom-public-'));rmSync(dir,{recursive:true,force:true});});
 return{dir,filename,key,secret,recoveryCodes,raw,publicRequest,publicMode,otp,sign,pair,get app(){return app;},get now(){return now;},advance(ms){now+=ms;},get cookie(){return cookie;},set cookie(v){cookie=v;},async login(extra={}){const r=await publicRequest('/api/local/login',{email:'owner@example.test',password,code:otp(),...extra});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];return r;}};
}

test('public configuration fails closed without an HTTPS domain, pinned Access issuer/audience or enrolled admin',()=>{
 assert.deepEqual(deploymentConfig({}),{mode:'local'});for(const env of [{RIVERROOM_MODE:'other'},{RIVERROOM_MODE:'public'},{RIVERROOM_MODE:'public',RIVERROOM_PUBLIC_ORIGIN:'http://poker.test',RIVERROOM_ACCESS_TEAM:security.team,RIVERROOM_ACCESS_AUD:security.audience},{RIVERROOM_MODE:'public',RIVERROOM_PUBLIC_ORIGIN:security.origin,RIVERROOM_ACCESS_TEAM:'https://evil.test',RIVERROOM_ACCESS_AUD:security.audience}])assert.throws(()=>deploymentConfig(env));
 assert.throws(()=>createLocalServer({filename:':memory:',security,securityKey:randomBytes(32)}),/verified MFA/);
});

test('MFA enrollment encrypts its seed, prevents code reuse, and recovery codes work only once',async t=>{
 const f=await fixture(t);const row=f.app.db.sql.prepare('SELECT * FROM local_mfa').get();assert.ok(!row.secret.includes(f.secret));assert.ok(!row.recovery.includes(f.recoveryCodes[0]));assert.equal(f.recoveryCodes.length,10);
 await f.publicMode();assert.equal((await f.login()).status,401);f.advance(30000);let r=await f.login();assert.equal(r.status,200);assert.match(r.headers['set-cookie'][0],/__Host-river_session=/);assert.match(r.headers['set-cookie'][0],/; Secure/);assert.match(r.headers['set-cookie'][0],/HttpOnly/);assert.equal((await f.login()).status,401);
 r=await f.login({code:undefined,recoveryCode:f.recoveryCodes[0]});assert.equal(r.status,200);assert.equal((await f.login({code:undefined,recoveryCode:f.recoveryCodes[0]})).status,401);
});

test('public ingress rejects absent, forged, expired or wrong-application gateway tokens and bypass headers',async t=>{
 const f=await fixture(t);await f.publicMode();assert.equal((await f.raw('/api/local/session')).status,403);
 assert.equal((await f.publicRequest('/api/local/session',undefined,{headers:{'Cf-Access-Jwt-Assertion':''}})).status,403);
 const badPair=await generateKeyPair('RS256');assert.equal((await f.publicRequest('/api/local/session',undefined,{token:await f.sign({},badPair.privateKey)})).status,403);
 const wrongAudience=await new SignJWT({email:'owner@example.test',type:'app'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(security.team).setAudience('wrong').setSubject('owner-gateway-id').setIssuedAt(Math.floor(f.now/1000)).setExpirationTime(Math.floor(f.now/1000)+3600).sign(f.pair.privateKey);assert.equal((await f.publicRequest('/api/local/session',undefined,{token:wrongAudience})).status,403);
 const old=await f.sign();f.advance(3610000);assert.equal((await f.publicRequest('/api/local/session',undefined,{token:old})).status,403);
 for(const headers of [{'X-Forwarded-Proto':'http'},{Host:'other.example.test'},{'Cf-Connecting-Ip':'not-an-ip'}])assert.equal((await f.publicRequest('/api/local/session',undefined,{headers})).status,403);
 assert.equal((await f.publicRequest('/api/local/session')).status,200);
});

test('public login binds sessions to signed identity and requires recent admin step-up',async t=>{
 const f=await fixture(t);await f.publicMode();f.advance(30000);assert.equal((await f.login()).status,200);const stolen=f.cookie;
 let r=await f.publicRequest('/api/local/session');assert.equal(r.data.user.admin,true);assert.equal(r.headers['strict-transport-security'],'max-age=31536000');
 assert.equal((await f.publicRequest('/api/local/session',undefined,{token:await f.sign({email:'intruder@example.test'})})).data.user,null);
 assert.equal((await f.publicRequest('/api/local/login',{email:'owner@example.test',password,recoveryCode:f.recoveryCodes[1]},{token:await f.sign({email:'intruder@example.test'})})).status,403);
 f.cookie=stolen;f.advance(10*60*1000+1);assert.equal((await f.publicRequest('/api/local/accounts',{name:'Player',email:'player@example.test',password,role:'member'})).status,403);
 assert.equal((await f.publicRequest('/api/table',{action:'grant-tickets',requestId:crypto.randomUUID(),memberId:f.app.db.sql.prepare("SELECT value FROM local_meta WHERE key='owner'").get().value,mode:'regular',amount:2,reason:'Step-up test'})).status,403);
 r=await f.publicRequest('/api/local/reauth',{password,code:f.otp()});assert.equal(r.status,200);assert.equal((await f.publicRequest('/api/local/accounts',{name:'Player',email:'player@example.test',password,role:'member'})).status,201);
 assert.equal((await f.publicRequest('/api/local/setup',{name:'Bad',email:'bad@example.test',password,clubName:'Takeover'})).status,409);
});

test('public idle expiry, audit redaction and MFA-protected password changes are enforced',async t=>{
 const f=await fixture(t);await f.publicMode();f.advance(30000);await f.login();const r=await f.publicRequest('/api/local/password',{currentPassword:password,password:'Changed-synthetic-password-123',code:f.otp()});assert.equal(r.status,403);
 const events=JSON.stringify(f.app.db.sql.prepare('SELECT * FROM local_security_events').all());assert.ok(!events.includes(password)&&!events.includes(f.secret)&&!events.includes(f.cookie));
 f.advance(30*60*1000+1);assert.equal((await f.publicRequest('/api/local/session')).data.user,null);
});

test('encrypted backup restores an intact database, revokes sessions, and rejects tampering or overwrites',async t=>{
 const f=await fixture(t);await f.publicMode();const file=await f.app.backup();const bytes=readFileSync(file);assert.ok(!bytes.includes(Buffer.from(password)));assert.ok(!bytes.includes(Buffer.from('SQLite format 3')));
 const output=join(f.dir,'restored.sqlite');await restoreBackup({file,output,key:f.key});const restored=new DatabaseSync(output);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('SELECT count(*) n FROM local_users').get().n,1);assert.equal(restored.prepare('SELECT count(*) n FROM local_sessions').get().n,0);assert.equal(restored.prepare('SELECT count(*) n FROM local_mfa').get().n,1);restored.close();
 await assert.rejects(restoreBackup({file,output,key:f.key}),/already exists/);const bad=join(f.dir,'tampered.rrbackup');bytes[bytes.length-25]^=1;writeFileSync(bad,bytes);await assert.rejects(restoreBackup({file:bad,output:join(f.dir,'bad.sqlite'),key:f.key}));
});

test('loopback health probes expose no account data and detect stalled game clocks',async t=>{
 const f=await fixture(t);await f.publicMode();await f.app.tick();let r=await f.raw('/healthz');assert.equal(r.status,200);assert.deepEqual(r.data,{status:'ok'});assert.ok(!r.text.includes('owner'));
 f.advance(11000);r=await f.raw('/healthz');assert.equal(r.status,503);await f.app.tick();assert.equal((await f.raw('/healthz')).status,200);assert.equal((await f.raw('/healthz',undefined,{Host:'evil.test'})).status,403);
});
