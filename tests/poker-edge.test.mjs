import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,compare,makePlayer,makeRoom,joinRoom,startHand,act,legalActions,tick,viewRoom,settle,moveSeat,leaveRoom} from '../lib/poker.mjs';
function table(stacks){const players=stacks.map((chips,i)=>({...makePlayer(`P${i}`,'secret-'+i),chips}));const r=makeRoom('ABCDEF',players[0]);for(const p of players.slice(1))joinRoom(r,p);return r;}
const sum=r=>r.players.reduce((n,p)=>n+p.chips+(r.stage==='showdown'?0:p.total),0);
function finishByCalling(r){let count=0;while(r.stage!=='showdown'&&count++<100){const l=legalActions(r,r.turnId);act(r,r.turnId,l.check?'check':'call');}assert.equal(r.stage,'showdown');}

test('six-player full runout has unique hole cards, board and remaining deck with three burns',()=>{
 const r=table(Array(6).fill(2000));startHand(r,r.hostId);finishByCalling(r);const visible=[...r.players.flatMap(p=>p.cards),...r.board,...r.deck];assert.equal(visible.length,49);assert.equal(new Set(visible).size,49);assert.equal(r.deck.length,32);assert.equal(r.board.length,5);assert.equal(sum(r),12000);
});
test('blinds larger than the stacks produce a complete, conserved all-in runout',()=>{
 for(const stacks of [[5,10],[10,20],[1,1],[1,2,3],[5,10,15,20,25,30]]){const r=table(stacks);startHand(r,r.hostId);finishByCalling(r);assert.equal(sum(r),stacks.reduce((a,b)=>a+b));assert.equal(r.board.length,5);assert.ok(r.players.every(p=>Number.isSafeInteger(p.chips)&&p.chips>=0));}
});
test('minimum full raise follows the last full raise increment',()=>{
 const r=table([2000,2000,2000]);startHand(r,r.hostId);assert.equal(legalActions(r,r.turnId).min,40);act(r,r.turnId,'raise',60);assert.equal(legalActions(r,r.turnId).min,100);act(r,r.turnId,'raise',100);assert.equal(legalActions(r,r.turnId).min,140);assert.equal(sum(r),6000);
});
test('cumulative short all-ins reopen a caller after a full raise increment is reached',()=>{
 const r=table([30,40,2000,2000]);startHand(r,r.hostId);const caller=r.turnId;act(r,caller,'call');act(r,r.turnId,'allin');act(r,r.turnId,'allin');act(r,r.turnId,'call');assert.equal(r.turnId,caller);assert.equal(r.currentBet,40);assert.equal(legalActions(r,caller).canRaise,true);act(r,caller,'raise',60);assert.equal(sum(r),4070);
});
test('a short call spends only the remaining stack and never creates a negative balance',()=>{
 const r=table([2000,25,2000]);startHand(r,r.hostId);act(r,r.turnId,'raise',100);const id=r.turnId,l=legalActions(r,id);assert.equal(l.call,15);act(r,id,'call');const p=r.players.find(p=>p.id===id);assert.equal(p.chips,0);assert.equal(p.total,25);finishByCalling(r);assert.equal(sum(r),4025);
});
test('invalid raises and out-of-turn actions preserve the entire engine snapshot',()=>{
 const r=table([2000,2000,2000]);startHand(r,r.hostId);for(const amount of [-1,0,21,39,40.5,2001,Infinity,NaN,'40',null]){const before=JSON.stringify(r);assert.throws(()=>act(r,r.turnId,'raise',amount));assert.equal(JSON.stringify(r),before);}
 const other=r.players.find(p=>p.id!==r.turnId),before=JSON.stringify(r);assert.throws(()=>act(r,other.id,'call'));assert.equal(JSON.stringify(r),before);
});
test('exact timeout boundary folds when facing a bet and is idempotent after settlement',()=>{
 const r=table([2000,2000]);startHand(r,r.hostId,100);const at=r.deadline;assert.equal(tick(r,at-1),false);assert.equal(tick(r,at),true);const stored=JSON.stringify(r);assert.equal(tick(r,at+100000),false);assert.equal(JSON.stringify(r),stored);assert.equal(sum(r),4000);
});
test('timeout checks rather than folds when checking is legal',()=>{
 const r=table([2000,2000]);startHand(r,r.hostId,0);act(r,r.turnId,'call',undefined,0);act(r,r.turnId,'check',undefined,0);const id=r.turnId;assert.equal(r.stage,'flop');assert.equal(tick(r,r.deadline),true);assert.equal(r.players.find(p=>p.id===id).folded,false);assert.equal(r.players.find(p=>p.id===id).lastAction,'Check');assert.equal(sum(r),4000);
});
test('BTN rotates across occupied seats and skips a busted seat',()=>{
 const r=table([2000,2000,2000,2000]);startHand(r,r.hostId);assert.equal(r.dealer,0);act(r,r.turnId,'fold');while(r.stage!=='showdown')act(r,r.turnId,'fold');r.players[1].chips=0;startHand(r,r.hostId);assert.equal(r.players[r.dealer].id,r.players[2].id);assert.equal(r.players[1].cards.length,0);assert.notEqual(r.turnId,r.players[1].id);
});
test('physical seat moves preserve player identity and do not grant a second stack',()=>{
 const r=table([2000,2000]);const id=r.players[0].id;moveSeat(r,id,5);assert.equal(r.players[0].id,id);assert.equal(r.players[0].seat,5);assert.equal(sum(r),4000);assert.throws(()=>moveSeat(r,r.players[1].id,5));startHand(r,r.hostId);assert.throws(()=>moveSeat(r,id,3));
});
test('three-way play becomes correct heads-up action order after a departure',()=>{
 const r=table([2000,2000,2000]);startHand(r,r.hostId);finishByCalling(r);leaveRoom(r,r.players[2].id);startHand(r,r.hostId);assert.equal(r.players.length,2);assert.equal(r.turnId,r.players[r.dealer].id);act(r,r.turnId,'call');act(r,r.turnId,'check');assert.notEqual(r.turnId,r.players[r.dealer].id);
});
test('main pot and successive side pots pay only eligible players',()=>{
 const r=table([0,0,0,0]);r.stage='river';r.board='2s 3d 7h 8c 9s'.split(' ');const cards=['As Ah','Ks Kh','Qs Qh','Js Jh'],amounts=[50,100,200,300];r.players.forEach((p,i)=>{p.cards=cards[i].split(' ');p.total=amounts[i];});settle(r,true);assert.deepEqual(r.players.map(p=>p.chips),[200,150,200,100]);assert.equal(sum(r),650);
});
test('folded best cards cannot win, and observers cannot see folded cards at showdown',()=>{
 const r=table([0,0,0]);r.stage='river';r.board='2s 3d 7h 8c 9s'.split(' ');r.players.forEach((p,i)=>{p.total=100;p.cards=['As Ah','Ks Kh','Qs Qh'][i].split(' ');});r.players[0].folded=true;settle(r,true);assert.deepEqual(r.players.map(p=>p.chips),[0,300,0]);const observer=viewRoom(r,null,1);assert.deepEqual(observer.players[0].cards,['??','??']);assert.deepEqual(observer.players[1].cards,['Ks','Kh']);assert.ok(!('deck' in observer));assert.ok(observer.players.every(p=>!('token' in p)));
});
test('three-way board tie splits the pot and returns unmatched contributions',()=>{
 const r=table([0,0,0]);r.stage='river';r.dealer=0;r.board='As Ks Qs Js Ts'.split(' ');r.players.forEach((p,i)=>{p.cards=['2h 3h','4h 5h','6h 7h'][i].split(' ');p.total=[5,5,8][i];});settle(r,true);assert.deepEqual(r.players.map(p=>p.chips),[5,5,8]);assert.equal(sum(r),18);
});

test('seven-card selection and detailed tie breakers',async t=>{
 const cases=[
  ['two triplets','As Ah Ad Ks Kh Kd 2c',[6,14,13]],
  ['three pairs','As Ah Ks Kh Qs Qh 2c',[2,14,13,12]],
  ['seven flush cards','As Ks Qs 9s 7s 3s 2s',[5,14,13,12,9,7]],
  ['several possible straights','As 2h 3d 4c 5s 6h 7d',[4,7]],
  ['quads choose highest kicker','9s 9h 9d 9c As Kh 2d',[7,9,14]],
  ['pair takes three highest kickers','As Ah Kd Qc 9s 7h 2d',[1,14,13,12,9]],
  ['full house chooses highest trips','Ks Kh Kd As Ah 2s 3d',[6,13,14]],
 ];
 for(const [name,cards,expected] of cases)await t.test(name,()=>assert.deepEqual(evaluate(cards.split(' ')),expected));
 assert.equal(compare(evaluate('As Kd 9h 6c 3s'.split(' ')),evaluate('Ah Kc 9d 6s 3h'.split(' '))),0,'suit never breaks a tie');
 assert.ok(compare(evaluate('Ah Jh 9h 7h 4h 2s 3c'.split(' ')),evaluate('Ad Jd 9d 7d 3d 2h 4c'.split(' ')))>0,'compare flush through fifth kicker');
});
