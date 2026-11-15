import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, compare, shuffledDeck, makePlayer, makeRoom, joinRoom, startHand, act, legalActions, tick, leaveRoom, settle, viewRoom } from "../lib/poker.mjs";

function table(n = 3, stacks) {
  const players = Array.from({length:n}, (_,i) => makePlayer(`Player ${i+1}`, `secret-${i}`));
  if (stacks) players.forEach((p,i) => p.chips = stacks[i]);
  const room = makeRoom("ABCDEF", players[0]); players.slice(1).forEach(p => joinRoom(room,p));
  return room;
}
const total = room => room.players.reduce((s,p) => s+p.chips+(room.stage === "showdown" ? 0 : p.total),0);

test("all hand classes, wheel, seven-card best hand and kickers", () => {
  const hands = ["As Jd 9h 5c 2s", "As Ad 9h 5c 2s", "As Ad 9h 9c 2s", "As Ad Ah 5c 2s", "As 2d 3h 4c 5s", "As Js 9s 5s 2s", "As Ad Ah 5c 5s", "As Ad Ah Ac 2s", "As Ks Qs Js Ts"];
  hands.forEach((h,i) => assert.equal(evaluate(h.split(" "))[0],i));
  assert.deepEqual(evaluate("As 2d 3h 4c 5s".split(" ")), [4,5]);
  assert.equal(evaluate("As Ks Qs Js Ts 2d 2c".split(" "))[0],8);
  assert.ok(compare(evaluate("As Ad Kh 5c 2s".split(" ")),evaluate("Ac Ah Qh 5d 2c".split(" "))) > 0);
});
test("shuffle contains 52 unique cards", () => assert.equal(new Set(shuffledDeck()).size,52));
test("heads up dealer acts first preflop, big blind acts first postflop", () => {
  const r=table(2); startHand(r,r.hostId);
  assert.equal(r.turnId,r.players[r.dealer].id);
  act(r,r.turnId,"call"); act(r,r.turnId,"check");
  assert.equal(r.stage,"flop"); assert.equal(r.board.length,3);
  assert.notEqual(r.turnId,r.players[r.dealer].id);
  assert.equal(total(r),4000);
});
test("big blind retains option after callers and illegal actions do not mutate", () => {
  const r=table(); startHand(r,r.hostId);
  assert.throws(()=>act(r,r.players[1].id,"check"),/turn/);
  assert.throws(()=>act(r,r.turnId,"check"),/call/);
  assert.throws(()=>act(r,r.turnId,"raise",21),/at least/);
  act(r,r.turnId,"call"); act(r,r.turnId,"call");
  assert.equal(r.stage,"preflop"); assert.equal(legalActions(r,r.turnId).check,true);
  act(r,r.turnId,"check"); assert.equal(r.stage,"flop");
});
test("short all-in does not reopen a prior caller's raise", () => {
  const r=table(3,[2000,30,2000]); startHand(r,r.hostId);
  const first=r.turnId; act(r,first,"call");
  act(r,r.turnId,"allin"); act(r,r.turnId,"call");
  assert.equal(r.turnId,first); assert.equal(legalActions(r,first).canRaise,false);
  assert.throws(()=>act(r,first,"allin"),/reopened/);
  act(r,first,"call"); assert.equal(r.stage,"flop");
});
test("side pots and uncalled bet returns", () => {
  const r=table(3,[0,0,0]);
  r.stage="river"; r.board="2s 3d 7h 8c 9s".split(" ");
  const hands=["As Ah","Ks Kh","Qs Qh"], contributions=[50,100,200];
  r.players.forEach((p,i)=>{p.cards=hands[i].split(" ");p.total=contributions[i];});
  settle(r,true);
  assert.deepEqual(r.players.map(p=>p.chips),[150,100,100]);
  assert.equal(total(r),350);
});
test("ties split pots and odd chip goes clockwise after dealer", () => {
  const r=table(3,[0,0,0]); r.stage="river";r.dealer=0;r.board="As Ks Qs Js Ts".split(" ");
  r.players.forEach((p,i)=>{p.cards=["2h","3h"];p.total=5;p.folded=i===2;});
  settle(r,true);assert.deepEqual(r.players.map(p=>p.chips),[7,8,0]);
});
test("a fold awards the pot while private cards stay hidden", () => {
  const r=table(2);startHand(r,r.hostId);act(r,r.turnId,"fold");
  assert.equal(r.stage,"showdown");assert.equal(total(r),4000);
  const v=viewRoom(r,r.players[0].id,2);
  assert.equal("deck" in v,false);assert.equal("pending" in v,false);
  assert.ok(v.players.every(p=>!("token" in p)));
  assert.deepEqual(v.players[1].cards,["??","??"]);
});
test("joining mid-hand waits until next deal", () => {
  const r=table(2);startHand(r,r.hostId);const p=makePlayer("Late","late-secret");joinRoom(r,p);
  assert.equal(p.waiting,true);assert.equal(p.cards.length,0);
  act(r,r.turnId,"fold");startHand(r,r.hostId);assert.equal(p.cards.length,2);assert.equal(p.waiting,false);
});
test("leaving out of turn preserves the turn and deadline; host transfers", () => {
  const r=table(4);startHand(r,r.hostId,1000);const turn=r.turnId, deadline=r.deadline;
  const leaver=r.players.find(p=>p.id!==turn&&p.id!==r.hostId);
  leaveRoom(r,leaver.id,2000);assert.equal(r.turnId,turn);assert.equal(r.deadline,deadline);
  leaveRoom(r,r.hostId,2000);assert.notEqual(r.hostId,r.players[0].id);
});
test("absent player checks or folds after timer",()=>{
  const r=table(2);startHand(r,r.hostId,0);assert.equal(tick(r,44000),false);assert.equal(tick(r,46000),true);assert.equal(r.stage,"showdown");
});
test("random legal games conserve chips and always finish", () => {
  for(let run=0;run<300;run++) {
    const r=table(2+run%5);const initial=total(r);startHand(r,r.hostId);let moves=0;
    while(r.stage!=="showdown"&&moves++<300) {
      const p=r.players.find(p=>p.id===r.turnId);assert.ok(p);
      const l=legalActions(r,p.id);const roll=Math.random();
      if(roll<.12)act(r,p.id,"fold");
      else if(roll<.25&&l.allIn)act(r,p.id,"allin");
      else if(roll<.42&&l.canRaise&&l.max>=l.min)act(r,p.id,"raise",l.min);
      else act(r,p.id,l.check?"check":"call");
      assert.equal(total(r),initial);assert.ok(r.players.every(p=>p.chips>=0&&Number.isInteger(p.chips)));
    }
    assert.equal(r.stage,"showdown"); assert.equal(total(r),initial);
  }
});
