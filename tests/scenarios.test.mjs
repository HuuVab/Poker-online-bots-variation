import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTable} from '../lib/table-api.mjs';
import {alice,bob,eve,setup,send,table,state,resetRate} from './support/club.mjs';
const raw=db=>JSON.parse(db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get().state);
function reconcile(db){
 const c=raw(db);let actual=0;
 for(const [id,m] of Object.entries(c.members)){
  assert.equal(m.wallet,db.sql.prepare('SELECT coalesce(sum(wallet_delta),0) n FROM club_ledger WHERE member_id=?').get(id).n,`wallet ledger: ${id}`);
  assert.ok(Number.isSafeInteger(m.wallet)&&m.wallet>=0);actual+=m.wallet;
 }
 for(const t of Object.values(c.tables))if(!t.practice)for(const p of t.players){assert.ok(Number.isSafeInteger(p.chips)&&p.chips>=0);actual+=p.chips+(!['waiting','showdown'].includes(t.stage)?p.total:0);}
 const issued=db.sql.prepare("SELECT coalesce(sum(wallet_delta),0) n FROM club_ledger WHERE kind='owner_adjustment'").get().n;
 assert.equal(actual,issued,'wallets + stacks + live pots = net chips issued');
}
async function add(db,user,role='member'){await send(db,{action:'invite',email:user.email,role});assert.equal((await send(db,{action:'accept'},user)).status,200);await send(db,{action:'adjust',memberId:user.userId,amount:5000,reason:'Test opening chips'});}

test('invalid and inherited table keys are rejected as client errors',async t=>{
 const db=await setup();for(const code of [null,0,{},[],"",'abc','__proto__','constructor','toString',"' OR 1=1"]){await t.test(JSON.stringify(code),async()=>{const r=await state(db,code);assert.equal(r.status,400);});}reconcile(db);db.sql.close();
});
test('unknown actions and malformed booleans are rejected without changing a table',async()=>{
 const db=await setup(),code=await table(db);assert.equal((await send(db,{action:'not-an-action',code})).status,400);
 for(const value of ['true','false',1,0,null])for(const action of ['pause','lock'])assert.equal((await send(db,{action,code,value})).status,400);
 const r=await state(db,code);assert.equal(r.room.paused,false);assert.equal(r.room.locked,false);reconcile(db);db.sql.close();
});
test('inherited member names cannot be adjusted, promoted or added to object prototypes',async()=>{
 const db=await setup();for(const memberId of ['__proto__','constructor','toString']){
  assert.equal((await send(db,{action:'adjust',memberId,amount:1,reason:'Invalid member test'})).status,404);
  assert.equal((await send(db,{action:'member',memberId,role:'host',status:'active'})).status,400);
 }assert.equal(Object.prototype.status,undefined);assert.equal(Object.prototype.role,undefined);reconcile(db);db.sql.close();
});
test('malformed payloads, missing request IDs and anonymous old tokens fail closed',async()=>{
 const db=await setup();for(const body of ['null','[]','"test"','{bad json']){
  const r=await handleTable(new Request('https://club.test/api/table',{method:'POST',body}),db,alice);assert.equal(r.status,400);
 }
 assert.equal((await send(db,{action:'create',requestId:null})).status,400);
 assert.equal((await handleTable(new Request('https://club.test/api/table',{method:'GET'}),db,alice)).status,405);
 assert.equal((await handleTable(new Request('https://club.test/api/table',{method:'POST',headers:{Authorization:'Bearer old-seat-token'},body:'{}'}),db,null)).status,401);
 assert.equal((await handleTable(new Request('https://club.test/api/table',{method:'POST',body:'{}'}),null,alice)).status,503);db.sql.close();
});
test('buy-in accepts exact limits and rejects invalid numeric representations',async t=>{
 const db=await setup(),code=await table(db);
 for(const amount of [0,-1,399,10001,1.5,'400',null,Number.MAX_SAFE_INTEGER])await t.test(String(amount),async()=>assert.equal((await send(db,{action:'join',code,amount},bob)).status,400));
 let r=await send(db,{action:'join',code,amount:400},bob);assert.equal(r.status,200);assert.equal(r.club.member.wallet,4600);
 await send(db,{action:'leave',code},bob);await send(db,{action:'adjust',memberId:'bob',amount:5000,reason:'Upper boundary test'});
 r=await send(db,{action:'join',code,amount:10000},bob);assert.equal(r.status,200);assert.equal(r.club.member.wallet,0);reconcile(db);db.sql.close();
});
test('body identity, money, cards and role fields cannot override trusted values',async()=>{
 const db=await setup(),code=await table(db);const r=await send(db,{action:'join',code,amount:400,userId:'alice',accountId:'alice',role:'owner',chips:900000,wallet:999999,cards:['As','Ah'],name:'Impersonated'},bob);
 assert.equal(r.status,200);const p=r.room.players.find(p=>p.id===r.room.you);assert.equal(p.name,'Bob');assert.equal(p.chips,400);assert.deepEqual(p.cards,[]);assert.equal(r.club.member.wallet,4600);assert.equal(r.club.member.id,'bob');reconcile(db);db.sql.close();
});
test('same idempotency key is scoped per account and retries survive a table close',async()=>{
 const db=await setup(),code=await table(db),requestId=crypto.randomUUID();const body={action:'join',code,amount:400,requestId};
 assert.equal((await send(db,body)).status,200);assert.equal((await send(db,body,bob)).status,200);await send(db,{action:'close',code});
 const retry=await send(db,body,bob);assert.equal(retry.status,200);assert.equal(retry.room.closed,true);assert.equal(retry.club.member.wallet,5000);reconcile(db);db.sql.close();
});
test('two accounts cannot buy the same physical seat; losing request keeps its wallet',async()=>{
 const db=await setup(),code=await table(db);const results=await Promise.all([send(db,{action:'join',code,amount:400,seat:3}),send(db,{action:'join',code,amount:400,seat:3},bob)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(raw(db).tables[code].players.length,1);reconcile(db);db.sql.close();
});
test('six seats fill; seventh player is rejected without debiting chips',async()=>{
 const db=await setup(),code=await table(db),users=[alice,bob];for(let i=2;i<7;i++){const u={userId:`u${i}`,email:`u${i}@example.com`,displayName:`User ${i}`};await add(db,u);users.push(u);}
 for(const [seat,u] of users.slice(0,6).entries())assert.equal((await send(db,{action:'join',code,amount:400,seat},u)).status,200);
 const r=await send(db,{action:'join',code,amount:400},users[6]);assert.equal(r.status,400);assert.equal(raw(db).members.u6.wallet,5000);reconcile(db);db.sql.close();
});
test('simultaneous owner deductions cannot make a wallet negative',async()=>{
 const db=await setup();const results=await Promise.all([send(db,{action:'adjust',memberId:'bob',amount:-4000,reason:'Correction one'}),send(db,{action:'adjust',memberId:'bob',amount:-4000,reason:'Correction two'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(raw(db).members.bob.wallet,1000);reconcile(db);db.sql.close();
});
test('concurrent top-up and departure conserve chips',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400},bob);
 const results=await Promise.all([send(db,{action:'rebuy',code,amount:400},bob),send(db,{action:'leave',code},bob)]);assert.ok(results.every(r=>[200,403].includes(r.status)));assert.equal(raw(db).members.bob.wallet,5000);reconcile(db);db.sql.close();
});
test('concurrent close and buy-in either reject the seat or refund it completely',async()=>{
 const db=await setup(),code=await table(db);const results=await Promise.all([send(db,{action:'close',code}),send(db,{action:'join',code,amount:400},bob)]);assert.ok(results.every(r=>[200,400,403].includes(r.status)));assert.equal(raw(db).tables[code].closed,true);assert.equal(raw(db).members.bob.wallet,5000);reconcile(db);db.sql.close();
});
test('concurrent deal requests start exactly one hand',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);
 const results=await Promise.all([send(db,{action:'deal',code}),send(db,{action:'deal',code})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(raw(db).tables[code].hand,1);reconcile(db);db.sql.close();
});
test('late joiners wait, cannot act, and are fully refunded after settlement',async()=>{
 const db=await setup(),code=await table(db);await add(db,eve);await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);await send(db,{action:'deal',code});
 let r=await send(db,{action:'join',code,amount:400},eve);assert.equal(r.room.players.find(p=>p.id===r.room.you).waiting,true);assert.deepEqual(r.room.players.find(p=>p.id===r.room.you).cards,[]);assert.equal((await send(db,{action:'act',code,version:r.room.version,move:'call'},eve)).status,400);
 await send(db,{action:'leave',code},eve);r=await state(db,code);await send(db,{action:'act',code,version:r.room.version,move:'fold'});assert.equal(raw(db).members.eve.wallet,5000);reconcile(db);db.sql.close();
});
test('demoting a host removes management rights without transferring them to the next player',async()=>{
 const db=await setup();await send(db,{action:'member',memberId:'bob',role:'host',status:'active'});const r=await send(db,{action:'create'},bob);await send(db,{action:'member',memberId:'bob',role:'member',status:'active'});
 assert.equal((await send(db,{action:'close',code:r.code},bob)).status,403);assert.equal((await send(db,{action:'close',code:r.code})).status,200);reconcile(db);db.sql.close();
});
test('removal and invitation restore preserve balances but cannot promote to owner',async()=>{
 const db=await setup();await send(db,{action:'member',memberId:'bob',role:'member',status:'removed'});assert.equal((await send(db,{action:'accept'},bob)).status,403);
 assert.equal((await send(db,{action:'invite',email:bob.email,role:'owner'})).status,400);await send(db,{action:'invite',email:' BOB@EXAMPLE.COM ',role:'member'});const r=await send(db,{action:'accept'},bob);assert.equal(r.status,200);assert.equal(r.club.member.wallet,5000);assert.equal(r.club.member.role,'member');reconcile(db);db.sql.close();
});
test('owner cannot be removed, demoted, or replaced by another matching-email identity',async()=>{
 const db=await setup();assert.equal((await send(db,{action:'member',memberId:'alice',role:'member',status:'removed'})).status,400);assert.equal((await send(db,{action:'setup',name:'Takeover'},{userId:'other',email:alice.email,displayName:'Other'})).status,403);assert.equal(raw(db).ownerId,'alice');reconcile(db);db.sql.close();
});
test('suspending an all-in player preserves pot eligibility and cashes out after settlement',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);let r=await send(db,{action:'deal',code});
 await send(db,{action:'act',code,version:r.room.version,move:'call'});r=await state(db,code,bob);await send(db,{action:'act',code,version:r.room.version,move:'allin'},bob);
 await send(db,{action:'member',memberId:'bob',role:'member',status:'suspended'});
 let p=raw(db).tables[code].players.find(p=>p.accountId==='bob');assert.equal(p.folded,false);assert.equal(p.exitAfterHand,true);assert.equal(p.cashedOut,undefined);
 assert.equal((await send(db,{action:'act',code,version:0,move:'fold'},bob)).status,403);
 r=await state(db,code);assert.equal((await send(db,{action:'act',code,version:r.room.version,move:'call'})).status,200);
 p=raw(db).tables[code].players.find(p=>p.accountId==='bob');assert.equal(p.cashedOut,true);reconcile(db);db.sql.close();
});
test('owner-issued chips require a reason; zero and fractional corrections are rejected',async()=>{
 const db=await setup();for(const extra of [{amount:0,reason:'zero'},{amount:1.5,reason:'fraction'},{amount:1,reason:''},{amount:1,reason:'ab'},{amount:'100',reason:'string'}])assert.equal((await send(db,{action:'adjust',memberId:'bob',...extra})).status,400);assert.equal(raw(db).members.bob.wallet,5000);reconcile(db);db.sql.close();
});
test('write limit blocks the next mutation without issuing chips',async()=>{
 const db=await setup();resetRate(db);for(let i=0;i<60;i++)assert.equal((await send(db,{action:'adjust',memberId:'bob',amount:1,reason:'Rate boundary test'})).status,200);
 assert.equal((await send(db,{action:'adjust',memberId:'bob',amount:1,reason:'Blocked request'})).status,429);assert.equal(raw(db).members.bob.wallet,5060);reconcile(db);db.sql.close();
});
test('thirty open tables are allowed and closing one releases capacity',async()=>{
 const db=await setup();let code;for(let i=0;i<30;i++){const r=await send(db,{action:'create'});assert.equal(r.status,200);code=r.code;}assert.equal((await send(db,{action:'create'})).status,400);await send(db,{action:'close',code});assert.equal((await send(db,{action:'create'})).status,200);reconcile(db);db.sql.close();
});
test('seeded funded games reconcile wallets, pots and ledger after every action',async()=>{
 let seed=0x523056;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let run=0;run<30;run++){
  const db=await setup(),code=await table(db),users=[alice,bob];for(let i=2;i<2+run%5;i++){const u={userId:`u${i}`,email:`u${i}@example.com`,displayName:`User ${i}`};await add(db,u);users.push(u);}
  for(const u of users)assert.equal((await send(db,{action:'join',code,amount:400*(1+Math.floor(random()*3))},u)).status,200);
  let r=await send(db,{action:'deal',code}),moves=0;reconcile(db);
  while(r.room.stage!=='showdown'&&moves++<150){
   const p=raw(db).tables[code].players.find(p=>p.id===r.room.turnId),u=users.find(u=>u.userId===p.accountId);const q=await state(db,code,u),l=q.room.legal,roll=random();
   const move=roll<.12?'fold':roll<.35&&l.allIn?'allin':roll<.5&&l.canRaise&&l.max>=l.min?'raise':l.check?'check':'call';
   r=await send(db,{action:'act',code,version:q.room.version,move,amount:move==='raise'?l.min:undefined},u);assert.equal(r.status,200,`seeded game ${run}, move ${moves}: ${r.error}`);reconcile(db);
  }
  assert.equal(r.room.stage,'showdown');await send(db,{action:'close',code});reconcile(db);assert.equal(raw(db).tables[code].closed,true);assert.ok(raw(db).tables[code].players.every(p=>p.chips===0));db.sql.close();
 }
});

test('kicked all-in player stays eligible, is paid once and cannot rejoin',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);let r=await send(db,{action:'deal',code});await send(db,{action:'act',code,version:r.room.version,move:'call'});
 r=await state(db,code,bob);await send(db,{action:'act',code,version:r.room.version,move:'allin'},bob);const target=raw(db).tables[code].players.find(p=>p.accountId==='bob');await send(db,{action:'kick',code,playerId:target.id});assert.equal(raw(db).tables[code].players.find(p=>p.id===target.id).folded,false);
 r=await state(db,code);await send(db,{action:'act',code,version:r.room.version,move:'call'});assert.equal(raw(db).tables[code].players.find(p=>p.id===target.id).cashedOut,true);assert.equal((await send(db,{action:'join',code,amount:400},bob)).status,403);assert.equal(db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='cash_out' AND member_id='bob'").get().n,1);reconcile(db);db.sql.close();
});
test('pausing an active hand allows settlement and blocks only the next deal',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);await send(db,{action:'deal',code});await send(db,{action:'pause',code,value:true});let r=await state(db,code);assert.equal((await send(db,{action:'act',code,version:r.room.version,move:'fold'})).status,200);
 assert.equal((await send(db,{action:'deal',code})).status,400);await send(db,{action:'pause',code,value:false});assert.equal((await send(db,{action:'deal',code})).status,200);reconcile(db);db.sql.close();
});
