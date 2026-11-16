import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createLocalServer} from '../server/app.mjs';

const password='Isolated-attack-fixture-only-123';
async function fixture(t,options={}){
 const app=createLocalServer({filename:':memory:',timerMs:0,...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
 const raw=async(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const request=httpRequest(base+path,{method,headers:{...(method==='POST'?{'Content-Type':'application/json',Origin:base}:{}),...headers}},response=>{const chunks=[];response.on('data',v=>chunks.push(v));response.on('end',()=>{const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{}resolve({status:response.statusCode,headers:response.headers,data,text});});});request.on('error',reject);request.end(body);
 });
 const client=()=>{let cookie='';return{get cookie(){return cookie;},async send(path,body,headers={}){const r=await raw(path,{method:body?'POST':'GET',headers:{Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});if(r.headers['set-cookie'])cookie=r.headers['set-cookie'][0].split(';')[0];return r;},game(body){return this.send('/api/table',{requestId:crypto.randomUUID(),...body});}};};
 const owner=client(),player=client();assert.equal((await owner.send('/api/local/setup',{email:'owner@attack.test',name:'Owner',password,clubName:'Isolated attack lab'})).status,201);assert.equal((await owner.send('/api/local/accounts',{email:'player@attack.test',name:'Player',password,role:'member'})).status,201);assert.equal((await player.send('/api/local/login',{email:'player@attack.test',password})).status,200);
 const id=(await player.send('/api/local/session')).data.user.id,ownerId=(await owner.send('/api/local/session')).data.user.id;
 const state=()=>JSON.parse(app.db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get().state);
 const grant=async(memberId,mode='regular',amount=1)=>{const r=await owner.game({action:'grant-tickets',memberId,mode,amount,reason:'Isolated attack fixture'});assert.equal(r.status,200);};
 return{app,base,raw,client,owner,player,id,ownerId,state,grant};
}

test('attack: unauthenticated callers cannot impersonate accounts with headers, cookies or body fields',async t=>{
 const f=await fixture(t),attacker=f.client();
 for(const cookie of ['', 'river_session='+ 'a'.repeat(64),'river_session=1','river_session='+ 'a'.repeat(64)+'; river_session='+ 'b'.repeat(64)]){
  const r=await attacker.send('/api/table',{action:'grant-tickets',requestId:crypto.randomUUID(),memberId:f.id,amount:999999,mode:'regular',role:'owner',userId:f.ownerId},{Cookie:cookie,'oai-authenticated-user-id':f.ownerId,'oai-authenticated-user-email':'owner@attack.test'});assert.equal(r.status,401);
 }
 for(const path of ['/api/local/accounts','/api/local/reset-password'])assert.equal((await attacker.send(path,{email:'hacker@attack.test',name:'Hacker',password,role:'owner',memberId:f.ownerId})).status,401);
 assert.equal((await attacker.send('/api/local/admin')).status,401);assert.deepEqual(f.state().members[f.id].tickets,{regular:0,tournament:0});assert.equal(f.app.db.sql.prepare('SELECT count(*) n FROM local_users').get().n,2);
});

test('attack: members cannot promote themselves, reset the admin, grant tickets or change settings',async t=>{
 const f=await fixture(t);const attempts=[{action:'member',memberId:f.id,role:'owner',status:'active'},{action:'settings',settings:{regularStack:999999}},{action:'grant-tickets',memberId:f.id,mode:'regular',amount:999999,reason:'Forged grant'},{action:'adjust',memberId:f.id,amount:999999,reason:'Old wallet exploit'},{action:'create',role:'owner',managerId:f.id}];
 for(const attack of attempts)assert.equal((await f.player.game({...attack,userId:f.ownerId,accountId:f.ownerId})).status,403);
 assert.equal((await f.player.send('/api/local/reset-password',{memberId:f.ownerId,password})).status,403);assert.equal((await f.player.send('/api/local/setup',{name:'Attacker',email:'steal@attack.test',password,clubName:'Takeover'})).status,409);
 assert.equal(f.state().members[f.id].role,'member');assert.equal(f.state().ownerId,f.ownerId);assert.equal(f.state().members[f.id].points.regular,0);
});

test('attack: SQL injection and prototype keys do not bypass sign-in or modify accounts',async t=>{
 const f=await fixture(t),attacker=f.client();for(const email of ["' OR 1=1 --",'owner@attack.test\u0000','__proto__','constructor'])assert.equal((await attacker.send('/api/local/login',{email,password})).status,401);
 for(const memberId of ['__proto__','constructor',"' OR 1=1 --"])assert.equal((await f.owner.game({action:'grant-tickets',memberId,mode:'regular',amount:1,reason:'Bad target test'})).status,404);
 assert.equal((await f.owner.game({action:'grant-tickets',memberId:f.id,mode:'__proto__',amount:1,reason:'Bad mode test'})).status,400);assert.equal(Object.prototype.role,undefined);assert.equal(f.app.db.sql.prepare('SELECT count(*) n FROM local_users').get().n,2);
});

test('attack: forged stacks, tickets, points and cards are ignored; hidden cards remain server-side',async t=>{
 const f=await fixture(t);await f.grant(f.id);await f.grant(f.ownerId);const code=(await f.owner.game({action:'create',title:'Privacy test'})).data.code;
 for(const amount of [-1,0,1.5,'2000',1000000000])assert.equal((await f.player.game({action:'join',code,amount})).status,400);
 let r=await f.player.game({action:'join',code,chips:999999,tickets:{regular:999999},points:{regular:999999},cards:['As','Ah'],role:'owner',userId:f.ownerId});assert.equal(r.status,200);assert.equal(r.data.room.players.find(p=>p.id===r.data.room.you).chips,2000);assert.equal(r.data.club.member.tickets.regular,0);assert.equal(r.data.club.member.points.regular,0);
 await f.owner.game({action:'join',code});r=await f.owner.game({action:'deal',code});const mine=r.data.room.you;assert.deepEqual(r.data.room.players.find(p=>p.id!==mine).cards,['??','??']);assert.ok(!('deck' in r.data.room));assert.ok(!('opening' in r.data.room));assert.ok(!('accountId' in r.data.room.players[0]));
 const before=f.state();r=await f.player.game({action:'act',code,version:r.data.room.version,move:'raise',amount:999999,turnId:f.state().tables[code].players.find(p=>p.accountId===f.id).id});assert.equal(r.status,400);assert.equal(f.state().tables[code].hand,before.tables[code].hand);assert.equal(f.state().members[f.id].points.regular,0);
});

test('attack: repeated concurrent requests and cross-table races cannot duplicate chips or spend one ticket twice',async t=>{
 const f=await fixture(t);await f.grant(f.id);const a=(await f.owner.game({action:'create',title:'A'})).data.code,b=(await f.owner.game({action:'create',title:'B'})).data.code;
 const requestId=crypto.randomUUID(),payload={action:'join',code:a,requestId};const results=await Promise.all(Array.from({length:12},()=>f.player.game(payload)));assert.ok(results.every(r=>r.status===200));assert.equal(f.state().members[f.id].tickets.regular,0);assert.equal(f.state().tables[a].players.length,1);assert.equal(f.state().tables[a].chipsIssued,2000);assert.equal((await f.player.game({...payload,code:b})).status,409);
 await f.grant(f.id);const c=(await f.owner.game({action:'create',title:'C'})).data.code;const race=await Promise.all([f.player.game({action:'join',code:b}),f.player.game({action:'join',code:c})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);assert.equal(f.state().members[f.id].tickets.regular,0);assert.equal(f.app.db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE member_id=? AND kind='regular_entry'").get(f.id).n,2);
});

test('attack: cross-site and rebinding requests cannot mutate data or expose admin information',async t=>{
 const f=await fixture(t);for(const headers of [{Origin:'https://evil.example'},{Origin:''},{Origin:f.base,'Sec-Fetch-Site':'cross-site'},{Origin:'null'},{Host:'evil.example',Origin:'http://evil.example'}])assert.equal((await f.raw('/api/local/logout',{method:'POST',headers:{Cookie:f.owner.cookie,...headers},body:'{}'})).status,403);
 assert.equal((await f.raw('/api/local/admin',{headers:{Host:'evil.example',Cookie:f.owner.cookie}})).status,403);assert.equal((await f.owner.send('/api/local/session')).data.user.admin,true);
});

test('attack: local mode refuses accidental proxy or tunnel access even with a valid local cookie',async t=>{
 const f=await fixture(t);for(const headers of [{'X-Forwarded-Proto':'https'},{'X-Forwarded-For':'203.0.113.10'},{'Cf-Connecting-Ip':'203.0.113.10'},{Forwarded:'for=203.0.113.10;proto=https'}])assert.equal((await f.owner.send('/api/local/session',undefined,headers)).status,403);
 assert.equal((await f.owner.send('/api/local/session')).data.user.admin,true);
});

test('attack: source paths, database paths, malformed JSON and oversized bodies are refused',async t=>{
 const f=await fixture(t);for(const path of ['/server/app.mjs','/data/riverroom.sqlite','/.env','/%2e%2e/server/auth.mjs','/..%5cserver/auth.mjs','/assets/../../server/auth.mjs'])assert.equal((await f.raw(path)).status,404,path);
 for(const body of ['null','[]','"text"','{bad json'])assert.equal((await f.raw('/api/local/login',{method:'POST',body})).status,400);
 const oversized=await f.raw('/api/local/login',{method:'POST',body:JSON.stringify({padding:'x'.repeat(9000)})});assert.equal(oversized.status,413);assert.equal((await f.owner.send('/api/local/session')).status,200);
});

test('attack: an unfinished unauthenticated body must not block other requests or the game clock',async t=>{
 const f=await fixture(t);const slow=httpRequest(f.base+'/api/local/login',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json','Content-Length':100}},r=>r.resume());slow.on('error',()=>{});slow.write('{');
 try{
  await new Promise(r=>setTimeout(r,50));const started=performance.now();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),500);
  try{const response=await fetch(f.base+'/api/local/session',{signal:controller.signal});assert.equal(response.status,200);assert.ok(performance.now()-started<500);}finally{clearTimeout(timeout);}
  await f.app.tick();
 }finally{slow.destroy();}
});

test('attack: trickled and chunked bodies are bounded without starving timers',async t=>{
 const f=await fixture(t,{bodyTimeoutMs:150});
 const timeout=await new Promise((resolve,reject)=>{const req=httpRequest(f.base+'/api/local/login',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json','Content-Length':100}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});req.on('error',reject);req.write('{');});assert.equal(timeout,408);
 const chunked=await f.raw('/api/local/login',{method:'POST',headers:{'Transfer-Encoding':'chunked'},body:JSON.stringify({padding:'x'.repeat(9000)})});assert.equal(chunked.status,413);
 assert.equal((await f.raw('/%ZZ')).status,400);assert.equal((await f.owner.send('/api/local/session')).status,200);await f.app.tick();
});

test('attack: excess concurrent incomplete requests are refused while normal requests stay available',async t=>{
 const f=await fixture(t,{bodyTimeoutMs:2000}),requests=[];
 const responses=Array.from({length:33},()=>new Promise(resolve=>{const req=httpRequest(f.base+'/api/local/login',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json','Content-Length':100}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});req.on('error',()=>resolve(0));req.write('{');requests.push(req);}));
 let timeout;try{
  const first=await Promise.race([...responses,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Reader limit did not reject excess requests promptly.')),1000);})]);assert.equal(first,429);assert.equal((await f.owner.send('/api/local/session')).status,200);await f.app.tick();
 }finally{clearTimeout(timeout);for(const req of requests)req.destroy();}
});
