import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleTable } from "../lib/table-api.mjs";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_past_secret_warriors.sql", import.meta.url),"utf8"));
  return { sqlite, prepare(sql) {
    const stmt=sqlite.prepare(sql);
    return { bind(...values) { return {
      async first() { return stmt.get(...values); },
      async run() { return { meta: { changes: Number(stmt.run(...values).changes) } }; }
    }; } };
  } };
}
async function send(db, body, token) {
  const response = await handleTable(new Request("http://localhost/api/table", {method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}),db);
  return {status:response.status,...await response.json()};
}

test("two independent clients join, deal, see only their cards and finish a hand",async()=>{
  const db=database(); const a=await send(db,{action:"create",name:"Alice"});assert.equal(a.status,200);
  const b=await send(db,{action:"join",code:a.room.code,name:"Bob"});assert.equal(b.status,200);
  const code=a.room.code; let state=(await send(db,{action:"state",code},a.token)).room;
  const deal=await send(db,{action:"deal",code,version:state.version},a.token);assert.equal(deal.status,200);
  assert.deepEqual(deal.room.players[1].cards,["??","??"]);
  const bob=(await send(db,{action:"state",code},b.token)).room;
  assert.deepEqual(bob.players[0].cards,["??","??"]);assert.ok(bob.players[1].cards.every(c=>c!=="??"));
  assert.ok(!JSON.stringify(bob).includes(a.token));assert.ok(!JSON.stringify(bob).includes(b.token));
  state=deal.room;let moves=0;
  while(state.stage!=="showdown"&&moves++<30){
    const token=state.turnId===a.room.you?a.token:b.token;
    const current=(await send(db,{action:"state",code},token)).room;
    const result=await send(db,{action:"act",code,version:current.version,move:current.legal.check?"check":"call"},token);
    assert.equal(result.status,200);state=result.room;
  }
  assert.equal(state.stage,"showdown");assert.equal(state.board.length,5);
  assert.equal(state.players.reduce((n,p)=>n+p.chips,0),4000);db.sqlite.close();
});
test("unauthorized and stale actions are rejected; concurrent actions commit once",async()=>{
  const db=database();const a=await send(db,{action:"create",name:"Alice"});const code=a.room.code;
  await send(db,{action:"join",code,name:"Bob"});
  assert.equal((await send(db,{action:"state",code},"wrong")).status,401);
  assert.equal((await send(db,{action:"state",code})).status,401);
  assert.equal((await send(db,{action:"deal",code,version:0},a.token)).status,409);
  let state=(await send(db,{action:"state",code},a.token)).room;
  state=(await send(db,{action:"deal",code,version:state.version},a.token)).room;
  const payload={action:"act",code,version:state.version,move:"raise",amount:40};
  const results=await Promise.all([send(db,payload,a.token),send(db,payload,a.token)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const stored=(await send(db,{action:"state",code},a.token)).room;
  assert.equal(stored.players[0].chips,1960);db.sqlite.close();
});
test("table capacity, practice isolation and invalid requests",async()=>{
  const db=database();const a=await send(db,{action:"create",name:"Alice"});
  for(let i=0;i<5;i++)assert.equal((await send(db,{action:"join",code:a.room.code,name:`Friend ${i}`})).status,200);
  assert.equal((await send(db,{action:"join",code:a.room.code,name:"Overflow"})).status,400);
  assert.equal((await send(db,{action:"create",name:" "})).status,400);
  assert.equal((await send(db,{action:"join",code:"' OR 1=1",name:"Oops"})).status,400);
  const p=await send(db,{action:"create",name:"Solo",practice:true});assert.equal(p.room.players.length,4);assert.equal(p.room.stage,"preflop");
  assert.equal((await send(db,{action:"join",code:p.room.code,name:"Visitor"})).status,400);
  db.sqlite.close();
});
