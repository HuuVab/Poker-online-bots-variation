import test from 'node:test';
import {get} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createLocalServer} from '../server/app.mjs';
const password='Test-only-secret-12345';
async function fixture(t,options={}){
 const app=createLocalServer({filename:':memory:',timerMs:0,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 function client(){let cookie='';return{get cookie(){return cookie;},async request(path,body,headers={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),Cookie:cookie,...headers},...(body?{body:JSON.stringify(body)}:{})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json(),headers:r.headers};},table(body){return this.request('/api/table',{requestId:crypto.randomUUID(),...body});}};}
 const owner=client(),player=client();return{app,owner,player,client,base,async setup(){const r=await owner.request('/api/local/setup',{name:'Admin',email:'owner@example.test',password,clubName:'Local test club'});assert.equal(r.status,201,JSON.stringify(r.body));},async add(){const r=await owner.request('/api/local/accounts',{name:'Player',email:'player@example.test',password,role:'member'});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal((await player.request('/api/local/login',{email:'player@example.test',password})).status,200);return r;}};
}

test('localhost setup creates one hashed admin, migrates SQLite, and serves an authenticated game',async t=>{
 const f=await fixture(t);assert.equal((await f.owner.request('/api/local/session')).body.setupRequired,true);await f.setup();
 const r=await f.owner.request('/api/local/session');assert.equal(r.body.user.admin,true);assert.match(f.owner.cookie,/river_session=[a-f0-9]{64}/);const stored=f.app.db.sql.prepare('SELECT password FROM local_users').get().password;assert.notEqual(stored,password);assert.match(stored,/^[a-f0-9]{32}:[a-f0-9]{64}$/);
 assert.equal((await f.owner.request('/api/local/setup',{name:'Other',email:'other@example.test',password,clubName:'Takeover'})).status,409);
 const c=await f.owner.table({action:'status'});assert.equal(c.status,200);assert.equal(c.body.club.clockMode,'server');assert.equal(c.body.club.member.role,'owner');assert.deepEqual(c.body.club.member.tickets,{regular:0,tournament:0});assert.equal(f.app.db.sql.prepare('SELECT count(*) n FROM local_migrations').get().n,5);
 const html=await fetch(f.base);assert.equal(html.status,200);assert.match(await html.text(),/Riverroom/);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('local sign-in rejects identity headers, invented cookies, bad origins and DNS rebinding hosts',async t=>{
 const f=await fixture(t);await f.setup();const anonymous=f.client();assert.equal((await anonymous.table({action:'status',userId:'owner'},)).status,401);
 assert.equal((await anonymous.request('/api/table',{action:'status'},{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test',Cookie:'river_session='+ 'a'.repeat(64)})).status,401);
 assert.equal((await f.owner.request('/api/local/login',{email:'owner@example.test',password},{Origin:'https://evil.example'})).status,403);
 const status=await new Promise((resolve,reject)=>get(f.base+'/api/local/session',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(status,403);
 assert.equal((await anonymous.request('/api/local/login',{email:'owner@example.test',password:'Wrong-password-123'})).status,401);
 assert.equal((await f.owner.request('/api/local/logout',{})).status,200);assert.equal((await f.owner.table({action:'status'})).status,401);
});

test('admin creates accounts atomically, players cannot administer, and suspension revokes sessions',async t=>{
 const f=await fixture(t);await f.setup();await f.add();const list=await f.owner.request('/api/local/admin');assert.equal(list.body.accounts.length,2);assert.ok(list.body.accounts.every(a=>!('password' in a)));const p=list.body.accounts.find(a=>a.role==='member');
 assert.equal((await f.player.request('/api/local/accounts',{name:'Bad',email:'bad@example.test',password,role:'host'})).status,403);assert.equal((await f.player.request('/api/local/admin')).status,403);assert.equal((await f.player.table({action:'grant-tickets',mode:'regular',memberId:p.id,amount:5,reason:'Forged tickets'})).status,403);
 assert.equal((await f.owner.request('/api/local/accounts',{name:'Duplicate',email:'player@example.test',password,role:'member'})).status,409);
 assert.equal((await f.owner.request('/api/local/accounts',{name:'Bad password',email:'bad@example.test',password:'short',role:'member'})).status,400);assert.equal(f.app.db.sql.prepare('SELECT count(*) n FROM local_users').get().n,2);
 assert.equal((await f.owner.table({action:'member',memberId:p.id,role:'member',status:'suspended'})).status,200);assert.equal((await f.player.table({action:'status'})).status,401);assert.equal((await f.player.request('/api/local/login',{email:'player@example.test',password})).status,401);
 await f.owner.table({action:'member',memberId:p.id,role:'host',status:'active'});assert.equal((await f.player.request('/api/local/login',{email:'player@example.test',password})).status,200);assert.equal((await f.player.table({action:'status'})).body.club.member.role,'host');
});

test('password reset and own-password changes revoke old sessions and require authorization',async t=>{
 const f=await fixture(t);await f.setup();await f.add();const id=(await f.player.request('/api/local/session')).body.user.id;
 assert.equal((await f.player.request('/api/local/password',{currentPassword:'Wrong-password-123',password:'Another-test-password-123'})).status,403);
 const newPassword='Another-test-password-123';assert.equal((await f.owner.request('/api/local/reset-password',{memberId:id,password:newPassword})).status,200);assert.equal((await f.player.table({action:'status'})).status,401);assert.equal((await f.player.request('/api/local/login',{email:'player@example.test',password})).status,401);
 assert.equal((await f.player.request('/api/local/login',{email:'player@example.test',password:newPassword})).status,200);const second=f.client();await second.request('/api/local/login',{email:'player@example.test',password:newPassword});
 assert.equal((await f.player.request('/api/local/password',{currentPassword:newPassword,password})).status,200);assert.equal((await second.table({action:'status'})).status,401);assert.equal((await f.player.table({action:'status'})).status,200);
});

test('saved defaults affect new tables and event registrations, with validation and immutable active tables',async t=>{
 const f=await fixture(t);await f.setup();await f.add();const first=await f.owner.table({action:'create',title:'Original'}),settings={regularStack:4000,smallBlind:25,bigBlind:50,turnSeconds:30,tournamentPoints:2000};
 assert.equal((await f.player.table({action:'settings',settings})).status,403);assert.equal((await f.owner.table({action:'settings',settings:{...settings,smallBlind:100}})).status,400);assert.equal((await f.owner.table({action:'settings',settings:{...settings,unknown:5}})).status,400);assert.equal((await f.owner.table({action:'settings',settings})).status,200);
 const next=await f.owner.table({action:'create',title:'New'});assert.equal(next.body.room.startingStack,4000);assert.equal(next.body.room.smallBlind,25);assert.equal(next.body.room.turnMs,30000);const old=await f.owner.table({action:'state',code:first.body.code});assert.equal(old.body.room.startingStack,2000);assert.equal(old.body.room.bigBlind,20);
 const event=await f.owner.table({action:'tournament-create',title:'Configured points'});assert.equal(event.body.club.tournaments[0].pointsPerEntry,2000);
});

test('server clock settles an expired turn with no player polling and awards points once',async t=>{
 let now=1000;const f=await fixture(t,{now:()=>now});await f.setup();await f.add();const id=(await f.player.request('/api/local/session')).body.user.id,ownerId=(await f.owner.request('/api/local/session')).body.user.id;
 for(const memberId of [id,ownerId])await f.owner.table({action:'grant-tickets',memberId,mode:'regular',amount:1,reason:'Server timer test'});
 const created=await f.owner.table({action:'create',title:'Timer'}),code=created.body.code;await f.owner.table({action:'join',code});await f.player.table({action:'join',code});const dealt=await f.owner.table({action:'deal',code});assert.equal(dealt.body.room.deadline,46000);
 now=46001;await f.app.tick();let c=JSON.parse(f.app.db.sql.prepare('SELECT state FROM clubs').get().state);assert.equal(c.tables[code].stage,'showdown');assert.equal(c.members[id].points.regular,10);await f.app.tick();c=JSON.parse(f.app.db.sql.prepare('SELECT state FROM clubs').get().state);assert.equal(c.members[id].points.regular,10);
 assert.equal(f.app.db.sql.prepare("SELECT count(*) n FROM club_rate_limits WHERE key LIKE '%:read'").get().n<=2,true);
});

test('local data and sessions persist across server restarts without rerunning migrations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'riverroom-')),filename=join(dir,'club.sqlite');let app=createLocalServer({filename,timerMs:0});
 try{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${app.server.address().port}`;const r=await fetch(base+'/api/local/setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({name:'Owner',email:'owner@example.test',password,clubName:'Persistent'})});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];await app.close();app=createLocalServer({filename,timerMs:0});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;const next=await fetch(base+'/api/local/session',{headers:{Cookie:cookie}});const data=await next.json();assert.equal(data.user.name,'Owner');assert.equal(data.setupRequired,false);assert.equal(app.db.sql.prepare('SELECT count(*) n FROM local_migrations').get().n,5);}finally{await app.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(resolve(dir).includes('riverroom-'));rmSync(dir,{recursive:true,force:true});}
});

test('the interval advances game clocks with no open clients',async t=>{
 let now=1000;const f=await fixture(t,{now:()=>now,timerMs:20});await f.setup();await f.add();
 const ownerId=(await f.owner.request('/api/local/session')).body.user.id,id=(await f.player.request('/api/local/session')).body.user.id;
 for(const memberId of [ownerId,id])await f.owner.table({action:'grant-tickets',memberId,mode:'regular',amount:1,reason:'Autonomous timer test'});
 const code=(await f.owner.table({action:'create',title:'No browsers needed'})).body.code;await f.owner.table({action:'join',code});await f.player.table({action:'join',code});await f.owner.table({action:'deal',code});now=46001;
 let saved;for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,20));saved=JSON.parse(f.app.db.sql.prepare('SELECT state FROM clubs').get().state);if(saved.tables[code].stage==='showdown')break;}
 assert.equal(saved.tables[code].stage,'showdown');assert.equal(saved.members[id].points.regular,10);
});

test('expired sessions and brute-force sign-in attempts fail closed',async t=>{
 let now=1000;const f=await fixture(t,{now:()=>now});await f.setup();now+=6*60*60*1000+1;assert.equal((await f.owner.request('/api/local/session')).body.user,null);assert.equal((await f.owner.table({action:'status'})).status,401);
 const anonymous=f.client();for(let i=0;i<10;i++)assert.equal((await anonymous.request('/api/local/login',{email:'unknown@example.test',password})).status,401);assert.equal((await anonymous.request('/api/local/login',{email:'unknown@example.test',password})).status,429);
 now+=60001;assert.equal((await f.owner.request('/api/local/login',{email:'owner@example.test',password})).status,200);
});

test('failed account creation rolls the invitation and account back together',async t=>{
 const f=await fixture(t);await f.setup();f.app.db.sql.exec("CREATE TRIGGER fail_account BEFORE INSERT ON local_users BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
 const r=await f.owner.request('/api/local/accounts',{email:'new@example.test',name:'New',password,role:'member'});assert.equal(r.status,500);assert.equal(f.app.db.sql.prepare('SELECT count(*) n FROM local_users').get().n,1);const c=JSON.parse(f.app.db.sql.prepare('SELECT state FROM clubs').get().state);assert.equal(c.invites['new@example.test'],undefined);assert.equal(Object.keys(c.members).length,1);
});
