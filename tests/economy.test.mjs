import test from 'node:test';
import assert from 'node:assert/strict';
import {alice,bob,send,setup,table,state,database} from './support/club.mjs';
const raw=db=>JSON.parse(db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get().state);
const save=(db,c)=>db.sql.prepare("UPDATE clubs SET state=? WHERE id='main'").run(JSON.stringify(c));
const grant=(db,mode='regular',amount=1,memberId='alice',extra={})=>send(db,{action:'grant-tickets',mode,amount,memberId,reason:'Ticket test grant',...extra});

test('new members start with independent zero tickets and points, and no wallet is exposed',async()=>{
 const db=database();let r=await send(db,{action:'setup',name:'Ticket club'});
 assert.deepEqual(r.club.member.tickets,{regular:0,tournament:0});assert.deepEqual(r.club.member.points,{regular:0,tournament:0});assert.ok(!('wallet' in r.club.member));assert.ok(!('legacyWallet' in r.club.member));
 await send(db,{action:'invite',email:bob.email,role:'member'});r=await send(db,{action:'accept'},bob);assert.deepEqual(r.club.member.tickets,{regular:0,tournament:0});
 const code=await table(db);assert.equal((await send(db,{action:'join',code},bob)).status,400);assert.equal(raw(db).tables[code].players.length,0);db.sql.close();
});

test('only admins grant tickets; mode, integer, reason, replay and SQL rollback are enforced',async()=>{
 const db=await setup(),requestId=crypto.randomUUID();const b={action:'grant-tickets',mode:'tournament',amount:3,memberId:'bob',reason:'Three entries',requestId};
 assert.equal((await send(db,b,bob)).status,403);let r=await send(db,b);assert.equal(r.status,200);r=await send(db,b);assert.equal(r.club.members.find(m=>m.id==='bob').tickets.tournament,3);assert.equal((await send(db,{...b,amount:4})).status,409);
 for(const mode of ['practice','__proto__','points',null])assert.equal((await grant(db,mode)).status,400);
 for(const amount of [-1,0,1.5,'1',1000001])assert.equal((await grant(db,'regular',amount)).status,400);
 assert.equal((await grant(db,'regular',1,'alice',{reason:'x'})).status,400);
 const before=raw(db).members.alice.tickets.regular;db.fail=true;assert.equal((await grant(db)).status,503);db.fail=false;assert.equal(raw(db).members.alice.tickets.regular,before);
 assert.equal((await send(db,{action:'adjust',amount:1000,memberId:'alice',reason:'Old wallet grant'})).status,400);db.sql.close();
});

test('matching tickets are required and prizes or other mode tickets cannot buy entry',async()=>{
 const db=await setup(),c=raw(db);c.members.alice.tickets={regular:0,tournament:1};c.members.alice.points={regular:100000,tournament:100000};save(db,c);
 const code=await table(db);assert.equal((await send(db,{action:'join',code,mode:'tournament',tickets:999,points:999})).status,400);
 let r=await send(db,{action:'tournament-create',title:'Tickets only',pointsPerEntry:100});const tournamentId=r.tournamentId;r=await send(db,{action:'tournament-register',tournamentId});assert.equal(r.status,200);assert.equal(r.club.member.tickets.tournament,0);assert.equal(r.club.member.points.tournament,100000);
 const other=await send(db,{action:'tournament-create',title:'Another cup'});assert.equal((await send(db,{action:'tournament-register',tournamentId:other.tournamentId})).status,400);
 r=await send(db,{action:'tournament-unregister',tournamentId});assert.equal(r.club.member.tickets.tournament,1);assert.equal(r.club.member.tickets.regular,0);assert.equal(r.club.member.points.tournament,100000);db.sql.close();
});

test('regular hands award positive net profit, not gross pot or returned chips, exactly once',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code});await send(db,{action:'join',code},bob);let r=await send(db,{action:'deal',code});
 const actor=r.room.turnId===r.room.you?alice:bob,q=await state(db,code,actor);r=await send(db,{action:'act',code,version:q.room.version,move:'fold'},actor);assert.equal(r.status,200);
 const c=raw(db),winner=actor.userId==='alice'?'bob':'alice';assert.equal(c.members[winner].points.regular,10);assert.equal(c.members[actor.userId].points.regular,0);assert.equal(c.members[winner].points.tournament,0);
 const count=db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE resource='points'").get().n;await state(db,code);await send(db,{action:'status'});assert.equal(db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE resource='points'").get().n,count);
 await send(db,{action:'close',code});assert.equal(raw(db).members[winner].points.regular,10);assert.equal(raw(db).members[winner].tickets.regular,4999);assert.equal(raw(db).tables[code].chipsRetired,4000);db.sql.close();
});

test('point settlement SQL failure rolls back both action and award, then succeeds once on retry',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code});await send(db,{action:'join',code},bob);let r=await send(db,{action:'deal',code});const b={action:'act',code,version:r.room.version,move:'fold',requestId:crypto.randomUUID()};
 db.fail=true;assert.equal((await send(db,b)).status,503);db.fail=false;assert.equal(raw(db).tables[code].stage,'preflop');assert.equal(raw(db).members.bob.points.regular,0);
 assert.equal((await send(db,b)).status,200);assert.equal((await send(db,b)).status,200);assert.equal(raw(db).members.bob.points.regular,10);db.sql.close();
});

test('zero-stack regular rebuy consumes one ticket, preserves points and cannot be replayed to mint chips',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code});const c=raw(db),r=c.tables[code];r.chipsRetired=2000;r.players[0].chips=0;c.members.alice.points.regular=123;save(db,c);
 const b={action:'rebuy',code,requestId:crypto.randomUUID()};const results=await Promise.all([send(db,b),send(db,b)]);assert.ok(results.every(r=>r.status===200));assert.equal(raw(db).members.alice.tickets.regular,4998);assert.equal(raw(db).tables[code].players[0].chips,2000);assert.equal(raw(db).members.alice.points.regular,123);
 assert.equal((await send(db,{...b,requestId:crypto.randomUUID()})).status,400);assert.equal((await send(db,{action:'rebuy',code,amount:900000})).status,400);db.sql.close();
});

test('legacy wallets are archived once without conversion; active chips and hand accounting survive migration',async()=>{
 const db=await setup(),code=await table(db);await send(db,{action:'join',code});await send(db,{action:'join',code},bob);await send(db,{action:'deal',code});let c=raw(db);delete c.economyVersion;for(const m of Object.values(c.members)){m.wallet=7000;delete m.tickets;delete m.points;}delete c.tables[code].chipsIssued;delete c.tables[code].chipsRetired;save(db,c);
 let q=await state(db,code);assert.equal(q.status,200,q.error);c=raw(db);assert.equal(c.economyVersion,2);assert.equal(c.members.alice.legacyWallet,7000);assert.equal(c.tables[code].chipsIssued,4000);assert.deepEqual(c.members.alice.tickets,{regular:0,tournament:0});assert.ok(!JSON.stringify(q).includes('legacyWallet'));assert.ok(!('wallet' in q.room));
 q=await send(db,{action:'act',code,version:q.room.version,move:'fold'});assert.equal(q.status,200,q.error);assert.equal(raw(db).members.bob.points.regular,10);await grant(db);await state(db,code);assert.equal(raw(db).members.alice.tickets.regular,1);assert.equal(raw(db).members.alice.legacyWallet,7000);db.sql.close();
});

test('resource history excludes retired wallet fields and other members cannot inspect it',async()=>{
 const db=await setup();await grant(db,'tournament',2);const r=await send(db,{action:'history'});assert.ok(r.entries.length>0);assert.ok(r.entries.every(e=>e.mode&&e.resource&&Number.isSafeInteger(e.resource_delta)));assert.ok(r.entries.every(e=>!('wallet_delta' in e)&&!('wallet_after' in e)));assert.equal((await send(db,{action:'history',memberId:'alice'},bob)).status,403);db.sql.close();
});
