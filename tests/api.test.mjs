import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleTable} from '../lib/table-api.mjs';
const alice={userId:'alice',email:'alice@example.com',displayName:'Alice'},bob={userId:'bob',email:'bob@example.com',displayName:'Bob'},eve={userId:'eve',email:'eve@example.com',displayName:'Eve'};
function database(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const db={sql,fail:false,prepare(query){return{bind(...args){return{query,args,async first(){return sql.prepare(query).get(...args);},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>{if(db.fail&&s.query.includes('INSERT INTO club_ledger'))throw new Error('injected failure');return{meta:{changes:Number(sql.prepare(s.query).run(...s.args).changes)}};});sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return db;
}
async function send(db,b,user=alice){const response=await handleTable(new Request('https://club.test/api/table',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...b})}),db,user,{ownerEmail:alice.email});return{status:response.status,...await response.json()};}
async function setup(){const db=database();assert.equal((await send(db,{action:'setup',name:'The Club'})).status,200);await send(db,{action:'invite',email:bob.email,role:'member'});await send(db,{action:'accept'},bob);for(const memberId of ['alice','bob'])await send(db,{action:'adjust',memberId,amount:5000,reason:'Initial club chips'});return db;}
async function table(db){const a=await send(db,{action:'create',title:'Friends',minBuyIn:400,maxBuyIn:10000});assert.equal(a.status,200);return a.code;}
const state=(db,code,user=alice)=>send(db,{action:'state',code},user);
const resetRate=db=>db.sql.exec('DELETE FROM club_rate_limits');

test('verified identity, owner bootstrap, invitation and role authorization',async()=>{
 const db=database();assert.equal((await send(db,{action:'setup',name:'Stolen'},eve)).status,403);assert.equal((await send(db,{action:'status'},null)).status,401);
 await send(db,{action:'setup',name:'Club'});assert.equal((await send(db,{action:'create',userId:'alice',role:'owner'},eve)).status,403);
 await send(db,{action:'invite',email:bob.email,role:'member'});assert.equal((await send(db,{action:'accept'},eve)).status,403);assert.equal((await send(db,{action:'accept'},bob)).status,200);
 assert.equal((await send(db,{action:'adjust',memberId:'bob',amount:999999,reason:'Hack'},bob)).status,403);assert.equal((await send(db,{action:'create'},bob)).status,403);
 await send(db,{action:'member',memberId:'bob',role:'host',status:'active'});assert.equal((await send(db,{action:'create'},bob)).status,200);db.sql.close();
});
test('buy-ins debit wallet; duplicate requests apply once and changed replay is rejected',async()=>{
 const db=await setup(),code=await table(db),requestId=crypto.randomUUID(),payload={action:'join',code,amount:2000,requestId};
 const results=await Promise.all([send(db,payload),send(db,payload)]);assert.ok(results.every(r=>r.status===200));assert.equal(results[0].club.member.wallet,3000);
 assert.equal((await send(db,{...payload,amount:3000})).status,409);assert.equal(db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='buy_in'").get().n,1);
 assert.equal((await send(db,{action:'join',code,amount:-500},bob)).status,400);db.sql.close();
});
test('concurrent buy-ins at different tables cannot spend the same wallet twice',async()=>{
 const db=await setup(),a=await table(db),b=await table(db);const results=await Promise.all([send(db,{action:'join',code:a,amount:4000}),send(db,{action:'join',code:b,amount:4000})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal((await send(db,{action:'status'})).club.member.wallet,1000);db.sql.close();
});
test('SQL failure rolls wallet, seat and ledger back as one transaction',async()=>{
 const db=await setup(),code=await table(db);db.fail=true;assert.equal((await send(db,{action:'join',code,amount:2000})).status,503);db.fail=false;const r=await state(db,code);assert.equal(r.room.players.length,0);assert.equal(r.club.member.wallet,5000);assert.equal(db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='buy_in'").get().n,0);db.sql.close();
});
test('funded game hides cards from opponents and unseated manager; settlement reconciles ledger',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:2000});await send(db,{action:'join',code,amount:2000},bob);
 let r=await send(db,{action:'deal',code});assert.equal(r.status,200);assert.deepEqual(r.room.players.find(p=>p.id!==r.room.you).cards,['??','??']);assert.ok(!JSON.stringify(r).includes('accountId'));assert.ok(!JSON.stringify(r).includes('opening'));
 const aliceSeat=r.room.you;let moves=0;while(r.room.stage!=='showdown'&&moves++<30){const who=r.room.turnId===aliceSeat?alice:bob;const q=await state(db,code,who);r=await send(db,{action:'act',code,version:q.room.version,move:q.room.legal.check?'check':'call'},who);assert.equal(r.status,200);}
 assert.equal(r.room.stage,'showdown');assert.equal(r.room.players.reduce((n,p)=>n+p.chips,0),4000);assert.equal(db.sql.prepare("SELECT sum(table_delta) n FROM club_ledger WHERE kind='hand_result'").get().n,0);assert.equal(db.sql.prepare('SELECT count(*) n FROM club_hands').get().n,1);
 await send(db,{action:'leave',code});await send(db,{action:'leave',code},bob);
 for(const id of ['alice','bob']){const club=(await send(db,{action:'status'},id==='alice'?alice:bob)).club;assert.equal(club.member.wallet,db.sql.prepare('SELECT sum(wallet_delta) n FROM club_ledger WHERE member_id=?').get(id).n);}db.sql.close();
});
test('all-in departure retains pot eligibility; closing waits and cashes out exactly once',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);let r=await send(db,{action:'deal',code});
 r=await send(db,{action:'act',code,version:r.room.version,move:'allin'});assert.equal(r.status,200);await send(db,{action:'leave',code});
 const raw=JSON.parse(db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get().state);const p=raw.tables[code].players.find(p=>p.accountId==='alice');assert.equal(p.folded,false);assert.equal(p.exitAfterHand,true);
 r=await send(db,{action:'close',code});assert.equal(r.room.closed,undefined);const q=await state(db,code,bob);r=await send(db,{action:'act',code,version:q.room.version,move:'call'},bob);assert.equal(r.status,200);assert.equal(r.room.closed,true);
 const count=db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='cash_out'").get().n;await state(db,code);assert.equal(db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='cash_out'").get().n,count);assert.equal(count,2);
 assert.equal((await send(db,{action:'status'})).club.member.wallet+(await send(db,{action:'status'},bob)).club.member.wallet,10000);db.sql.close();
});
test('host kick cannot fold an opponent during a hand; lock and pause enforced',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'lock',code,value:true});assert.equal((await send(db,{action:'join',code,amount:400},bob)).status,403);await send(db,{action:'lock',code,value:false});await send(db,{action:'join',code,amount:400});await send(db,{action:'join',code,amount:400},bob);await send(db,{action:'pause',code,value:true});assert.equal((await send(db,{action:'deal',code})).status,400);await send(db,{action:'pause',code,value:false});let r=await send(db,{action:'deal',code});const bp=r.room.players.find(p=>p.id!==r.room.you);r=await send(db,{action:'kick',code,playerId:bp.id});assert.equal(r.room.players.find(p=>p.id===bp.id).folded,false);assert.equal((await send(db,{action:'close',code},bob)).status,403);db.sql.close();
});
test('suspension freezes access, preserves wallet, and revoked invitations cannot be used',async()=>{
 const db=await setup();await send(db,{action:'member',memberId:'bob',role:'member',status:'suspended'});assert.equal((await send(db,{action:'create',practice:true},bob)).status,403);assert.equal((await send(db,{action:'status'},bob)).club.member,null);
 await send(db,{action:'member',memberId:'bob',role:'member',status:'active'});assert.equal((await send(db,{action:'status'},bob)).club.member.wallet,5000);
 await send(db,{action:'invite',email:eve.email,role:'member'});await send(db,{action:'revoke',email:eve.email});assert.equal((await send(db,{action:'accept'},eve)).status,403);db.sql.close();
});
test('practice cannot mint or transfer wallet chips; free funded rebuy removed',async()=>{
 const db=await setup();let r=await send(db,{action:'create',practice:true});assert.equal(r.status,200);assert.equal(r.club.member.wallet,5000);assert.equal((await state(db,r.code,bob)).status,403);await send(db,{action:'leave',code:r.code});assert.equal((await send(db,{action:'status'})).club.member.wallet,5000);assert.equal((await send(db,{action:'create',practice:true})).status,200);
 const code=await table(db);await send(db,{action:'join',code,amount:400});assert.equal((await send(db,{action:'rebuy',code})).status,400);assert.equal((await send(db,{action:'rebuy',code,amount:100000})).status,400);db.sql.close();
});
test('request bounds, origin protection, rate limits and ledger visibility',async()=>{
 const db=await setup();const req=new Request('https://club.test/api/table',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'});assert.equal((await handleTable(req,db,alice)).status,403);
 assert.equal((await handleTable(new Request('https://club.test/api/table',{method:'POST',body:'x'.repeat(9000)}),db,alice)).status,413);
 assert.equal((await send(db,{action:'history',memberId:'alice'},bob)).status,403);resetRate(db);db.sql.prepare('INSERT INTO club_rate_limits VALUES (?,?,?)').run('bob:read',Math.floor(Date.now()/60000),150);assert.equal((await send(db,{action:'status'},bob)).status,429);db.sql.close();
});

test('expired invitations and missing owner configuration fail closed',async()=>{
 const db=database();const req=new Request('https://club.test/api/table',{method:'POST',body:JSON.stringify({action:'setup',name:'Bad',requestId:crypto.randomUUID()})});assert.equal((await handleTable(req,db,alice,{})).status,403);
 await send(db,{action:'setup',name:'Club'});await send(db,{action:'invite',email:bob.email,role:'member'});const row=db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get(),c=JSON.parse(row.state);c.invites[bob.email].expires=0;db.sql.prepare("UPDATE clubs SET state=? WHERE id='main'").run(JSON.stringify(c));assert.equal((await send(db,{action:'accept'},bob)).status,403);db.sql.close();
});
test('table hosts cannot manage other hosts tables or see seated private cards',async()=>{
 const db=await setup();await send(db,{action:'member',memberId:'bob',role:'host',status:'active'});await send(db,{action:'invite',email:eve.email,role:'member'});await send(db,{action:'accept'},eve);await send(db,{action:'adjust',memberId:'eve',amount:5000,reason:'Initial chips'});
 const code=await table(db);const owned=await send(db,{action:'create'},bob);assert.equal((await send(db,{action:'close',code},bob)).status,403);assert.equal((await send(db,{action:'pause',code:owned.code,value:true})).status,200);
 await send(db,{action:'join',code,amount:400},bob);await send(db,{action:'join',code,amount:400},eve);const r=await send(db,{action:'deal',code});assert.equal(r.room.you,null);assert.ok(r.room.players.every(p=>p.cards.every(c=>c==='??')));assert.ok(!('deck' in r.room));assert.equal(r.room.canManage,true);db.sql.close();
});
test('concurrent betting commits once and stale actions cannot take another turn',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:2000});await send(db,{action:'join',code,amount:2000},bob);let r=await send(db,{action:'deal',code});const body={action:'act',code,version:r.room.version,move:'raise',amount:40};const results=await Promise.all([send(db,body),send(db,body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);r=await state(db,code);assert.equal(r.room.players.find(p=>p.id===r.room.you).chips,1960);db.sql.close();
});
test('cash-out repeats and automatic suspended-seat settlement never duplicate a payout',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code,amount:400},bob);const requestId=crypto.randomUUID();const b={action:'leave',code,requestId};const results=await Promise.all([send(db,b,bob),send(db,b,bob)]);assert.ok(results.every(r=>r.status===200));assert.equal((await send(db,{action:'status'},bob)).club.member.wallet,5000);
 await send(db,{action:'join',code,amount:400},bob);await send(db,{action:'member',memberId:'bob',role:'member',status:'suspended'});await state(db,code);await send(db,{action:'member',memberId:'bob',role:'member',status:'active'});assert.equal((await send(db,{action:'status'},bob)).club.member.wallet,5000);assert.equal(db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='cash_out'").get().n,2);db.sql.close();
});
