import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createLocalServer} from '../server/app.mjs';

test('27 independent HTTP sessions can play three tables and poll concurrently without leaking cards',async t=>{
 const app=createLocalServer({filename:':memory:',timerMs:0});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`,password='Load-fixture-password-123';
 const client=()=>{let cookie='';return{async call(path,body){const r=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.ok,true,data.error);return data;},game(body){return this.call('/api/table',{requestId:crypto.randomUUID(),...body});}};};
 const owner=client(),clients=[owner];await owner.call('/api/local/setup',{email:'owner@load.test',name:'Owner',password,clubName:'Isolated load test'});
 for(let i=1;i<27;i++){await owner.call('/api/local/accounts',{email:`player${i}@load.test`,name:`Player ${i}`,password,role:'member'});const p=client();await p.call('/api/local/login',{email:`player${i}@load.test`,password});clients.push(p);}
 const members=(await owner.game({action:'status'})).club.members;for(const m of members)await owner.game({action:'grant-tickets',memberId:m.id,mode:'tournament',amount:1,reason:'Isolated load test'});
 const tournamentId=(await owner.game({action:'tournament-create',title:'27-player HTTP load'})).tournamentId;for(const c of clients)await c.game({action:'tournament-register',tournamentId});await owner.game({action:'tournament-start',tournamentId});
 const states=await Promise.all(clients.map(c=>c.game({action:'status'})));assert.deepEqual(states[0].club.tournaments[0].tables.map(r=>r.players),[9,9,9]);const samples=[];
 await Promise.all(clients.flatMap((c,i)=>Array.from({length:2},async()=>{const start=performance.now(),r=await c.game({action:'state',code:states[i].club.tournaments[0].self.tableCode});samples.push(performance.now()-start);assert.equal(r.room.players.length,9);assert.equal(r.room.players.filter(p=>p.id!==r.room.you).every(p=>p.cards.every(card=>card==='??')),true);assert.ok(!('deck' in r.room));})));
 samples.sort((a,b)=>a-b);t.diagnostic(`27 sessions / 3 tables / 54 concurrent polls: median ${samples[Math.floor(samples.length/2)].toFixed(1)} ms, p95 ${samples[Math.floor(samples.length*.95)].toFixed(1)} ms (local machine only).`);assert.ok(samples.at(-1)<10000,'Local poll backlog exceeded 10 seconds.');await app.tick();
});
