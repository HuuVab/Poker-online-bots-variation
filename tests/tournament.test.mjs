import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTable} from '../lib/table-api.mjs';
import {makePlayer,makeRoom,startHand,act,legalActions,shuffledDeck} from '../lib/poker.mjs';
import {LEVEL_MS,BREAK_MS,START_STACK} from '../lib/tournament.mjs';
import {alice,bob,database,resetRate} from './support/club.mjs';
const raw=db=>JSON.parse(db.sql.prepare("SELECT state FROM clubs WHERE id='main'").get().state);
const save=(db,c)=>db.sql.prepare("UPDATE clubs SET state=? WHERE id='main'").run(JSON.stringify(c));
async function send(db,body,user=alice,now=1000){const r=await handleTable(new Request('https://club.test/api/table',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),...body})}),db,user,{ownerEmail:alice.email,now});return{status:r.status,...await r.json()};}
async function fixture(n=2){const db=database();await send(db,{action:'setup',name:'Tournament club'});const users=[alice];for(let i=1;i<n;i++){const u=i===1?bob:{userId:`u${i}`,email:`u${i}@example.com`,displayName:`Player ${i+1}`};users.push(u);await send(db,{action:'invite',email:u.email,role:'member'});await send(db,{action:'accept'},u);}resetRate(db);for(const u of users)await send(db,{action:'adjust',memberId:u.userId,amount:10000,reason:'Tournament test chips'});resetRate(db);const r=await send(db,{action:'tournament-create',title:'Club Cup',buyIn:1000});assert.equal(r.status,200,r.error);const id=r.tournamentId;for(const u of users){const q=await send(db,{action:'tournament-register',tournamentId:id},u);assert.equal(q.status,200,q.error);}return{db,id,users};}
async function start(f){const r=await send(f.db,{action:'tournament-start',tournamentId:f.id});assert.equal(r.status,200,r.error);return r;}
function reconcile(db){const c=raw(db);let held=0;for(const [id,m] of Object.entries(c.members)){assert.equal(m.wallet,db.sql.prepare('SELECT coalesce(sum(wallet_delta),0) n FROM club_ledger WHERE member_id=?').get(id).n);held+=m.wallet;}for(const t of Object.values(c.tournaments)){held+=t.escrow;if(t.state!=='registration'&&t.state!=='cancelled'){const sum=Object.values(c.tables).filter(r=>r.tournamentId===t.id).reduce((n,r)=>n+r.players.reduce((a,p)=>a+p.chips+(!['waiting','showdown'].includes(r.stage)?p.total:0),0)+(!['waiting','showdown'].includes(r.stage)?r.antePot:0),0);assert.equal(sum,t.chipsIssued);}}assert.equal(held,db.sql.prepare("SELECT sum(wallet_delta) n FROM club_ledger WHERE kind='owner_adjustment'").get().n);}
function tourRoom(stacks){const ps=stacks.map((chips,i)=>({...makePlayer(`P${i}`,''),chips,seat:i})),r=makeRoom('ABCDEF',ps[0]);Object.assign(r,{players:ps,maxSeats:9,tournamentId:'TOUR01',turnMs:20000,smallBlind:25,bigBlind:50,ante:50,initialButtonSeat:0});return r;}

test('27 players become three balanced nine-seat tables with separate wallet and stack accounting',async()=>{
 const f=await fixture(27);await start(f);const c=raw(f.db),t=c.tournaments[f.id];assert.equal(t.tableCodes.length,3);assert.deepEqual(t.tableCodes.map(code=>c.tables[code].players.length),[9,9,9]);assert.equal(t.prizePool,27000);assert.equal(t.totalEntries,27);assert.equal(t.chipsIssued,135000);
 for(const r of Object.values(c.tables)){assert.equal(r.maxSeats,9);assert.equal(r.antePot,50);assert.equal(r.currentBet,50);assert.equal(r.deadline,21000);assert.equal(r.players.reduce((n,p)=>n+p.total,0)+r.antePot,125);}
 reconcile(f.db);f.db.sql.close();
});
test('registration withdrawal and cancellation refund once; late registrations and host takeover denied',async()=>{
 const f=await fixture();let r=await send(f.db,{action:'tournament-unregister',tournamentId:f.id},bob);assert.equal(r.status,200);assert.equal(raw(f.db).members.bob.wallet,10000);await send(f.db,{action:'tournament-register',tournamentId:f.id},bob);assert.equal((await send(f.db,{action:'tournament-start',tournamentId:f.id},bob)).status,403);
 await start(f);assert.equal((await send(f.db,{action:'tournament-register',tournamentId:f.id},bob)).status,400);assert.equal((await send(f.db,{action:'tournament-cancel',tournamentId:f.id})).status,400);reconcile(f.db);f.db.sql.close();
 const g=await fixture();const requestId=crypto.randomUUID();assert.equal((await send(g.db,{action:'tournament-cancel',tournamentId:g.id,requestId})).status,200);assert.equal((await send(g.db,{action:'tournament-cancel',tournamentId:g.id,requestId})).status,200);assert.equal(raw(g.db).members.alice.wallet,10000);reconcile(g.db);g.db.sql.close();
});
test('two time cards, 20-second turns, +20 seconds exactly once per turn, safe request replay',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),r=c.tables[c.tournaments[f.id].tableCodes[0]],u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId),e=c.tournaments[f.id].entrants[u.userId];assert.equal(e.timeCards,2);
 const b={action:'timecard',code:r.code,hand:r.hand,turnSerial:r.turnSerial,requestId:crypto.randomUUID()};let q=await send(f.db,b,u);assert.equal(q.status,200,q.error);assert.equal(q.room.deadline,41000);assert.equal(q.room.tournament.self.timeCards,1);q=await send(f.db,b,u);assert.equal(q.status,200);assert.equal(q.room.tournament.self.timeCards,1);assert.equal((await send(f.db,{...b,requestId:crypto.randomUUID()},u)).status,400);
 assert.equal((await send(f.db,{...b,turnSerial:0,requestId:crypto.randomUUID()},u)).status,409);reconcile(f.db);f.db.sql.close();
});
test('big-blind ante is dead money, blind-first for short stacks, and chips are conserved',()=>{
 for(const stacks of [[5000,5000],[5000,70],[5000,35],Array(9).fill(5000)]){
  const r=tourRoom(stacks),sum=stacks.reduce((a,b)=>a+b,0);startHand(r,r.hostId,1000);const bb=r.players.find(p=>p.id===r.bigBlindId);assert.equal(bb.bet,Math.min(stacks[bb.seat],50));assert.equal(bb.antePaid,Math.min(Math.max(0,stacks[bb.seat]-50),50));let moves=0;while(r.stage!=='showdown'&&moves++<60){const l=legalActions(r,r.turnId);act(r,r.turnId,l.check?'check':'call');}assert.equal(r.players.reduce((n,p)=>n+p.chips,0),sum);assert.equal(r.stage,'showdown');
 }
});
test('tournament dead button survives elimination and heads-up avoids consecutive big blinds',()=>{
 const r=tourRoom([5000,5000,5000,5000]);startHand(r,r.hostId);assert.equal(r.buttonSeat,0);assert.equal(r.bigBlindSeat,2);while(r.stage!=='showdown')act(r,r.turnId,'fold');r.players=r.players.filter(p=>p.seat!==1);startHand(r,r.hostId);assert.equal(r.buttonSeat,1);assert.equal(r.dealer,-1);assert.equal(r.smallBlindSeat,2);assert.equal(r.bigBlindSeat,3);while(r.stage!=='showdown')act(r,r.turnId,'fold');r.players=r.players.filter(p=>p.seat!==0);startHand(r,r.hostId);assert.equal(r.bigBlindSeat,2);assert.equal(r.buttonSeat,3);assert.equal(r.turnId,r.players.find(p=>p.seat===3).id);
});
test('tournament stacks cannot use cash-table management, top-up, seat or leave endpoints',async()=>{
 const f=await fixture();await start(f);const c=raw(f.db),r=c.tables[c.tournaments[f.id].tableCodes[0]];for(const action of ['rebuy','leave','seat','deal','close','kick','lock','pause'])assert.equal((await send(f.db,{action,code:r.code,amount:5000,seat:8,value:true})).status,400,action);reconcile(f.db);f.db.sql.close();
});
test('Level 6 closes rebuys and produces exactly one 10-minute break before Level 7',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]];
 // Produce a valid settled hand without eliminating anyone.
 let now=1000;while(r.stage!=='showdown'){const u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId);await send(f.db,{action:'act',code:r.code,hand:r.hand,turnSerial:r.turnSerial,move:'fold'},u,now);c=raw(f.db);r=c.tables[r.code];}
 t=c.tournaments[f.id];t.level=6;t.nextLevelAt=2000;save(f.db,c);let q=await send(f.db,{action:'status'},alice,2000);assert.equal(q.status,200,q.error);t=raw(f.db).tournaments[f.id];assert.equal(t.state,'break');assert.equal(t.breakUntil,2000+BREAK_MS);assert.equal(t.rebuyClosed,true);
 await send(f.db,{action:'status'},alice,t.breakUntil-1);assert.equal(raw(f.db).tournaments[f.id].state,'break');await send(f.db,{action:'status'},alice,t.breakUntil);t=raw(f.db).tournaments[f.id];assert.equal(t.level,7);assert.equal(t.state,'running');assert.equal(t.nextLevelAt,2000+BREAK_MS+LEVEL_MS);reconcile(f.db);f.db.sql.close();
});
test('Level 6 hand finishing after the clock cutoff allows its last rebuy, then locks during break',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]];t.level=6;t.nextLevelAt=2000;r.handLevel=6;
 const winner=[...r.players].sort((a,b)=>(b.chips+b.bet)-(a.chips+a.bet))[0];winner.cards=['As','Ah'];r.players.find(p=>p!==winner).cards=['Ks','Kh'];const draw=['2c','2s','3d','7h','4c','8c','5c','9s'],used=new Set([...r.players.flatMap(p=>p.cards),...draw]);r.deck=[...shuffledDeck().filter(v=>!used.has(v)),...draw.reverse()];save(f.db,c);await send(f.db,{action:'status'},alice,2000);
 while(r.stage!=='showdown'){const u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId);const q=await send(f.db,{action:'act',code:r.code,hand:r.hand,turnSerial:r.turnSerial,move:'allin'},u,2000);assert.equal(q.status,200,q.error);c=raw(f.db);r=c.tables[r.code];}
 t=c.tournaments[f.id];const busted=Object.values(t.entrants).find(e=>e.state==='rebuy'),u=f.users.find(u=>u.userId===busted.memberId);assert.ok(busted);busted.timeCards=1;save(f.db,c);
 const q=await send(f.db,{action:'tournament-rebuy',tournamentId:f.id},u,2100);assert.equal(q.status,200,q.error);t=raw(f.db).tournaments[f.id];assert.equal(t.state,'break');assert.equal(t.totalEntries,3);assert.equal(t.totalRebuys,1);assert.equal(t.prizePool,3000);assert.equal(t.entrants[u.userId].timeCards,1);assert.equal((await send(f.db,{action:'tournament-rebuy',tournamentId:f.id},u,2200)).status,400);reconcile(f.db);f.db.sql.close();
});
test('payouts and tied eliminations are automatic and cannot be duplicated',async()=>{
 const f=await fixture(4);await start(f);let c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]];
 const winner=r.players.find(p=>p.id!==r.bigBlindId),others=r.players.filter(p=>p!==winner),hole=['Ks Kh','Qs Qh','Js Jh'];winner.cards=['As','Ah'];others.forEach((p,i)=>p.cards=hole[i].split(' '));const draw=['2c','2s','3d','7h','4c','8c','5c','9s'],used=new Set([...r.players.flatMap(p=>p.cards),...draw]);r.deck=[...shuffledDeck().filter(v=>!used.has(v)),...draw.reverse()];save(f.db,c);
 while(r.stage!=='showdown'){const u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId);const q=await send(f.db,{action:'act',code:r.code,hand:r.hand,turnSerial:r.turnSerial,move:'allin'},u);assert.equal(q.status,200,q.error);c=raw(f.db);r=c.tables[r.code];}
 for(const u of f.users){if(raw(f.db).tournaments[f.id].entrants[u.userId].state==='rebuy')await send(f.db,{action:'tournament-decline',tournamentId:f.id},u);}
 t=raw(f.db).tournaments[f.id];assert.equal(t.state,'completed');assert.equal(t.escrow,0);assert.equal(t.results.find(x=>x.id===winner.id).amount,2800);assert.deepEqual(t.results.filter(x=>x.id!==winner.id).map(x=>x.amount),[400,400,400]);assert.ok(t.results.filter(x=>x.id!==winner.id).every(x=>x.place===2));const count=f.db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='tournament_prize'").get().n;await send(f.db,{action:'status'});assert.equal(f.db.sql.prepare("SELECT count(*) n FROM club_ledger WHERE kind='tournament_prize'").get().n,count);reconcile(f.db);f.db.sql.close();
});
test('all remaining players must approve a pause; clocks and deadlines shift on resume',async()=>{
 const f=await fixture();await start(f);await send(f.db,{action:'tournament-pause-vote',tournamentId:f.id,value:true});assert.equal(raw(f.db).tournaments[f.id].state,'running');await send(f.db,{action:'tournament-pause-vote',tournamentId:f.id,value:true},bob);
 let c=raw(f.db),r=c.tables[c.tournaments[f.id].tableCodes[0]];const u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId);await send(f.db,{action:'act',code:r.code,hand:r.hand,turnSerial:r.turnSerial,move:'fold'},u,1100);c=raw(f.db);assert.equal(c.tournaments[f.id].state,'paused');const old=c.tournaments[f.id].nextLevelAt;await send(f.db,{action:'tournament-resume',tournamentId:f.id},bob,11100);assert.equal(raw(f.db).tournaments[f.id].nextLevelAt,old+10000);reconcile(f.db);f.db.sql.close();
});
test('27-player all-in event balances, breaks tables and awards the published four prize places',async()=>{
 const f=await fixture(27);await start(f);let now=1000,steps=0;
 while(raw(f.db).tournaments[f.id].state!=='completed'&&steps++<500){
  resetRate(f.db);let c=raw(f.db),t=c.tournaments[f.id];const pending=Object.values(t.entrants).filter(e=>e.state==='rebuy');
  if(pending.length){for(const e of pending){const q=await send(f.db,{action:'tournament-decline',tournamentId:f.id},f.users.find(u=>u.userId===e.memberId),now);assert.equal(q.status,200,q.error);}}
  else{const live=t.tableCodes.map(code=>c.tables[code]).filter(r=>!r.closed&&r.turnId);if(live.length){for(const r of live){const u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId);const q=await send(f.db,{action:'act',code:r.code,hand:r.hand,turnSerial:r.turnSerial,move:'allin'},u,now);assert.ok([200,409].includes(q.status),q.error);}}else{now+=6000;const q=await send(f.db,{action:'status'},alice,now);assert.equal(q.status,200,q.error);}}
  reconcile(f.db);
 }
 const t=raw(f.db).tournaments[f.id];assert.equal(t.state,'completed');assert.equal(t.results.length,27);assert.equal(t.results.reduce((n,e)=>n+e.amount,0),27000);assert.equal(t.escrow,0);assert.equal(t.tableCodes.filter(code=>!raw(f.db).tables[code].closed).length,1);f.db.sql.close();
});

test('unlimited eligible rebuys increase entries and reserve while keeping remaining time cards',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]],e=t.entrants.alice;e.timeCards=1;save(f.db,c);
 for(let i=0;i<3;i++){
  c=raw(f.db);t=c.tournaments[f.id];r=c.tables[t.tableCodes[0]];e=t.entrants.alice;const other=r.players.find(p=>p.accountId!=='alice');other.chips=t.chipsIssued;r.players.find(p=>p.accountId==='alice').chips=0;r.players.forEach(p=>{p.bet=0;p.total=0;});r.antePot=0;r.stage='showdown';r.turnId=null;r.deadline=null;r.hand++;r.tournamentRecordedHand=r.hand;r.nextHandAt=1000000;e.state='rebuy';e.stack=0;e.rebuyUntil=21000;e.bustGroup=`fixture:${i}`;e.bustOrder=i+1;save(f.db,c);
  const requestId=crypto.randomUUID(),body={action:'tournament-rebuy',tournamentId:f.id,requestId};const q=await send(f.db,body);assert.equal(q.status,200,q.error);assert.equal((await send(f.db,body)).status,200);reconcile(f.db);
 }
 t=raw(f.db).tournaments[f.id];assert.equal(t.totalRebuys,3);assert.equal(t.totalEntries,5);assert.equal(t.prizePool,5000);assert.equal(t.escrow,5000);assert.equal(t.entrants.alice.timeCards,1);assert.equal(raw(f.db).members.alice.wallet,6000);f.db.sql.close();
});
test('membership suspension pauses all tables and restoration permits timed recovery',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),r=c.tables[c.tournaments[f.id].tableCodes[0]],deadline=r.deadline;
 await send(f.db,{action:'member',memberId:'bob',role:'member',status:'suspended'},alice,2000);assert.equal(raw(f.db).tournaments[f.id].state,'paused');assert.equal((await send(f.db,{action:'tournament-resume',tournamentId:f.id},alice,3000)).status,400);
 await send(f.db,{action:'member',memberId:'bob',role:'member',status:'active'},alice,12000);await send(f.db,{action:'tournament-resume',tournamentId:f.id},alice,12000);c=raw(f.db);assert.equal(c.tables[r.code].deadline,deadline+10000);assert.equal(c.tournaments[f.id].state,'running');reconcile(f.db);f.db.sql.close();
});
test('a rebuy SQL error rolls back wallet, reserve, entry count and tournament stack together',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]],e=t.entrants.alice;r.players.find(p=>p.accountId==='bob').chips=t.chipsIssued;r.players.find(p=>p.accountId==='alice').chips=0;r.players.forEach(p=>p.total=p.bet=0);Object.assign(r,{antePot:0,stage:'showdown',turnId:null,deadline:null,tournamentRecordedHand:r.hand,nextHandAt:999999});Object.assign(e,{state:'rebuy',stack:0,rebuyUntil:21000,bustGroup:'fixture',bustOrder:1});save(f.db,c);
 f.db.fail=true;const b={action:'tournament-rebuy',tournamentId:f.id,requestId:crypto.randomUUID()};assert.equal((await send(f.db,b)).status,503);f.db.fail=false;t=raw(f.db).tournaments[f.id];assert.equal(t.totalEntries,2);assert.equal(t.escrow,2000);assert.equal(t.entrants.alice.state,'rebuy');assert.equal(raw(f.db).members.alice.wallet,9000);assert.equal((await send(f.db,b)).status,200);reconcile(f.db);f.db.sql.close();
});
test('registration capacity, forged levels and tournament card privacy are enforced',async()=>{
 const f=await fixture(27),extra={userId:'extra',email:'extra@example.com',displayName:'Extra'};resetRate(f.db);await send(f.db,{action:'invite',email:extra.email,role:'member'});await send(f.db,{action:'accept'},extra);await send(f.db,{action:'adjust',memberId:extra.userId,amount:2000,reason:'Capacity fixture'});assert.equal((await send(f.db,{action:'tournament-register',tournamentId:f.id},extra)).status,400);await start(f);
 const c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]],viewer=await send(f.db,{action:'state',code:r.code},extra);assert.equal(viewer.room.you,null);assert.ok(viewer.room.players.every(p=>p.cards.every(v=>v==='??')));for(const key of ['deck','handOpening','accountId'])assert.ok(!JSON.stringify(viewer.room).includes(`"${key}"`));assert.equal((await send(f.db,{action:'tournament-rebuy',tournamentId:f.id,level:1,rebuyClosed:false},extra)).status,400);reconcile(f.db);f.db.sql.close();
});
test('nine-player varied-stack all-ins conserve tournament chips across blind levels',()=>{
 for(let run=0;run<100;run++){
  const stacks=Array.from({length:9},(_,i)=>1+((run*719+i*937)%15000)),r=tourRoom(stacks);r.bigBlind=50*(1+run%10);r.smallBlind=r.bigBlind/2;r.ante=r.bigBlind;startHand(r,r.hostId,0);let moves=0;while(r.stage!=='showdown'&&moves++<100)act(r,r.turnId,'allin');assert.equal(r.stage,'showdown');assert.equal(r.players.reduce((n,p)=>n+p.chips,0),stacks.reduce((a,b)=>a+b));assert.ok(r.players.every(p=>Number.isSafeInteger(p.chips)&&p.chips>=0));
 }
});

test('valid tournament winnings can exceed the grant ceiling without blocking the payout',async()=>{
 const f=await fixture();await start(f);const c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]],extra=1000000000000-c.members.alice.wallet;c.members.alice.wallet+=extra;
 f.db.sql.prepare('INSERT INTO club_ledger (id,member_id,actor_id,kind,table_code,wallet_delta,table_delta,wallet_after,stack_after,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'alice','alice','owner_adjustment',null,extra,0,c.members.alice.wallet,null,'High-balance test fixture',1000);
 r.players.forEach(p=>{p.chips=p.accountId==='alice'?t.chipsIssued:0;p.total=p.bet=0;});Object.assign(r,{stage:'showdown',antePot:0,turnId:null,deadline:null,tournamentRecordedHand:r.hand,nextHandAt:999999});Object.assign(t.entrants.bob,{state:'eliminated',stack:0,bustGroup:'test',bustOrder:1,eliminationStack:5000});t.eliminations=[{key:'test',order:1}];save(f.db,c);
 const q=await send(f.db,{action:'status'});assert.equal(q.status,200,q.error);assert.equal(raw(f.db).members.alice.wallet,1000000002000);assert.equal(raw(f.db).tournaments[f.id].escrow,0);assert.equal((await send(f.db,{action:'adjust',memberId:'alice',amount:1,reason:'Over grant ceiling'})).status,400);reconcile(f.db);f.db.sql.close();
});
test('eliminated spectators can watch another tournament table rather than being redirected to their old seat',async()=>{
 const f=await fixture(10);await start(f);let c=raw(f.db),t=c.tournaments[f.id],e=t.entrants.alice,old=c.tables[e.tableCode],other=t.tableCodes.map(code=>c.tables[code]).find(r=>r!==old);
 // An eliminated spectator fixture after a settled tournament hand.
 e.state='eliminated';e.stack=0;const me=old.players.find(p=>p.id===e.playerId),receiver=old.players.find(p=>p.id!==me.id);receiver.chips+=me.chips+me.total;me.chips=me.total=0;me.left=true;old.players=old.players.filter(p=>p.id!==me.id);old.pending=old.pending.filter(id=>id!==me.id);if(old.turnId===me.id){old.turnId=old.pending[0];old.deadline=21000;}save(f.db,c);
 const q=await send(f.db,{action:'state',code:other.code});assert.equal(q.status,200,q.error);assert.equal(q.room.code,other.code);assert.equal(q.room.you,null);reconcile(f.db);f.db.sql.close();
});

test('table breaks move 27 to 18 to 9 players without losing stacks, time cards or seat routing',async()=>{
 const f=await fixture(27);await start(f);
 for(let phase=1;phase<=2;phase++){
  let c=raw(f.db),t=c.tournaments[f.id],rs=t.tableCodes.map(code=>c.tables[code]).filter(r=>!r.closed);t.rebuyClosed=true;t.level=7;t.nextLevelAt=900000;t.needsBarrier=true;const oldLocations=new Map(Object.values(t.entrants).map(e=>[e.memberId,e.tableCode]));
  const candidates=rs.flatMap(r=>r.players.filter(p=>t.entrants[p.accountId].state==='playing').slice(0,phase===1?3:r===rs[0]?5:4));
  for(const p of candidates){const e=t.entrants[p.accountId];Object.assign(e,{state:'eliminated',stack:0,bustGroup:`phase:${phase}`,bustOrder:phase,eliminationStack:5000});}
  t.eliminations.push({key:`phase:${phase}`,order:phase});
  let sum=0,receiver;
  for(const r of rs){r.stage='showdown';r.turnId=null;r.deadline=null;r.antePot=0;r.tournamentRecordedHand=r.hand;r.nextHandAt=1000;for(const p of r.players){p.chips=t.entrants[p.accountId].state==='playing'?5000:0;p.total=p.bet=0;sum+=p.chips;if(p.chips&&!receiver)receiver=p;}}
  receiver.chips+=t.chipsIssued-sum;for(const e of Object.values(t.entrants))e.timeCards=1;save(f.db,c);
  const q=await send(f.db,{action:'status'});assert.equal(q.status,200,q.error);c=raw(f.db);t=c.tournaments[f.id];rs=t.tableCodes.map(code=>c.tables[code]).filter(r=>!r.closed);assert.equal(rs.length,3-phase);assert.ok(rs.every(r=>r.players.length===9));
  const moved=Object.values(t.entrants).find(e=>e.state==='playing'&&e.tableCode!==oldLocations.get(e.memberId));assert.ok(moved);assert.equal(moved.timeCards,1);const u=f.users.find(u=>u.userId===moved.memberId),view=await send(f.db,{action:'state',code:oldLocations.get(moved.memberId)},u);assert.equal(view.status,200,view.error);assert.equal(view.room.code,moved.tableCode);assert.equal(view.room.you,moved.playerId);reconcile(f.db);
 }
 f.db.sql.close();
});
test('new Level 7 hands eliminate busted players without offering another rebuy',async()=>{
 const f=await fixture();await start(f);let c=raw(f.db),t=c.tournaments[f.id],r=c.tables[t.tableCodes[0]];t.level=7;t.rebuyClosed=true;t.nextLevelAt=1000000;r.handLevel=7;
 const winner=[...r.players].sort((a,b)=>(b.chips+b.bet)-(a.chips+a.bet))[0];winner.cards=['As','Ah'];r.players.find(p=>p!==winner).cards=['Ks','Kh'];const draw=['2c','2s','3d','7h','4c','8c','5c','9s'],used=new Set([...r.players.flatMap(p=>p.cards),...draw]);r.deck=[...shuffledDeck().filter(v=>!used.has(v)),...draw.reverse()];save(f.db,c);
 while(r.stage!=='showdown'){const u=f.users.find(u=>r.players.find(p=>p.id===r.turnId).accountId===u.userId);assert.equal((await send(f.db,{action:'act',code:r.code,hand:r.hand,turnSerial:r.turnSerial,move:'allin'},u)).status,200);c=raw(f.db);r=c.tables[r.code];}
 t=c.tournaments[f.id];assert.equal(t.state,'completed');const loser=Object.values(t.entrants).find(e=>e.state==='eliminated'),u=f.users.find(u=>u.userId===loser.memberId),before=c.members[u.userId].wallet;assert.equal((await send(f.db,{action:'tournament-rebuy',tournamentId:f.id,level:6,rebuyClosed:false},u)).status,400);assert.equal(raw(f.db).members[u.userId].wallet,before);reconcile(f.db);f.db.sql.close();
});
