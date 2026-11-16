import {makePlayer,makeRoom,startHand,act,tick,isPlaying} from './poker.mjs';

import {LEVEL_MS,BREAK_MS,REBUY_MS,RESULT_MS,START_STACK,BLINDS} from './tournament-rules.mjs';
export {LEVEL_MS,BREAK_MS,REBUY_MS,RESULT_MS,START_STACK,BLINDS};
const has=(o,k)=>typeof k==='string'&&Object.hasOwn(o,k);
const activeEntries=t=>Object.values(t.entrants).filter(e=>e.state==='playing'||e.state==='rebuy');
const canManage=(c,t,id)=>c.ownerId===id||(c.members[id]?.role==='host'&&t.managerId===id);
const log=(r,message,now)=>{r.log.push({id:crypto.randomUUID(),message,at:now});r.log=r.log.slice(-45);};
const shuffle=items=>{const a=[...items];for(let i=a.length-1;i>0;i--){const v=new Uint32Array(1),limit=Math.floor(4294967296/(i+1))*(i+1);do{crypto.getRandomValues(v);}while(v[0]>=limit);const j=v[0]%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
export const blindLevel=level=>{
 if(level<=BLINDS.length)return BLINDS[Math.max(1,level)-1];
 const steps=level-BLINDS.length,factor=2**Math.floor(steps/2)*(steps%2?1.5:1),sb=Math.min(2**50,BLINDS.at(-1)[0]*factor);return[sb,sb*2];
};
const weights=n=>n<=3?[100]:n<=9?[70,30]:n<=18?[50,30,20]:[40,30,20,10];
const prizeAmounts=t=>{const w=weights(t.originalPlayers||Object.keys(t.entrants).length),p=w.map(v=>Number(BigInt(t.prizePool)*BigInt(v)/100n));p[0]+=t.prizePool-p.reduce((a,b)=>a+b,0);return p;};
const rooms=(c,t)=>t.tableCodes.map(code=>c.tables[code]).filter(r=>r&&!r.closed);
const player=(c,e)=>c.tables[e.tableCode]?.players.find(p=>p.id===e.playerId);
function code(c){let v;do{v=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');}while(c.tables[v]||c.tournaments[v]);return v;}
function eliminate(t,e){
 if(e.state==='eliminated')return;
 e.state='eliminated';delete e.rebuyUntil;
 const key=e.bustGroup;
 if(!t.eliminations.some(g=>g.key===key))t.eliminations.push({key,order:e.bustOrder});
}
function recordHand(c,t,r,ctx){
 if(r.stage!=='showdown'||r.tournamentRecordedHand===r.hand)return;
 r.tournamentRecordedHand=r.hand;r.nextHandAt=ctx.now+RESULT_MS;
 ctx.hands.push({id:`${r.code}:${r.hand}`,table:r.code,hand:r.hand,data:JSON.stringify({tournament:t.id,level:r.handLevel,board:r.board,results:r.results,players:r.players.map(p=>({id:p.id,name:p.name,net:p.chips-(r.handOpening?.[p.id]||0),cards:r.showCards&&!p.folded?p.cards:[]}))})});
 const busted=r.players.filter(p=>p.chips===0&&!p.left);
 if(busted.length){
  const group=r.bubbleRound?`bubble:${r.bubbleRound}`:`${r.code}:${r.hand}`;
  if(!t.groupOrders[group])t.groupOrders[group]=++t.eliminationSequence;
  for(const p of busted){const e=t.entrants[p.accountId];if(!e||e.state!=='playing')continue;
   e.stack=0;e.bustGroup=group;e.bustOrder=t.groupOrders[group];e.eliminationStack=r.handOpening[p.id];
   if(r.handLevel<=6&&!t.rebuyClosed){e.state='rebuy';e.rebuyUntil=ctx.now+REBUY_MS;}else eliminate(t,e);
  }
  t.needsBarrier=true;
 }
}
function shiftTimers(c,t,delta){
 if(t.nextLevelAt)t.nextLevelAt+=delta;if(t.breakUntil)t.breakUntil+=delta;
 for(const e of Object.values(t.entrants))if(e.rebuyUntil)e.rebuyUntil+=delta;
 for(const r of rooms(c,t)){if(r.deadline)r.deadline+=delta;if(r.nextHandAt)r.nextHandAt+=delta;}
}
function complete(c,t,ctx){
 const remaining=activeEntries(t);if(remaining.length!==1||remaining[0].state!=='playing')return false;
 const champion=remaining[0];
 const groups=[[champion]];
 for(const g of [...t.eliminations].sort((a,b)=>b.order-a.order)){
  const out=Object.values(t.entrants).filter(e=>e.state==='eliminated'&&e.bustGroup===g.key).sort((a,b)=>b.eliminationStack-a.eliminationStack||a.order-b.order);
  for(const e of out){const last=groups.at(-1);if(last[0]!==champion&&last[0].bustGroup===e.bustGroup&&last[0].eliminationStack===e.eliminationStack)last.push(e);else groups.push([e]);}
 }
 const prizes=prizeAmounts(t);let position=1;t.results=[];
 for(const group of groups){const award=prizes.slice(position-1,position-1+group.length).reduce((a,b)=>a+b,0);group.sort((a,b)=>a.order-b.order);
  group.forEach((e,i)=>{const amount=Number(BigInt(award)/BigInt(group.length))+(i<Number(BigInt(award)%BigInt(group.length))?1:0);e.place=position;e.prize=amount;t.results.push({id:e.playerId,name:e.name,place:position,amount});if(amount){ctx.wallet(c,e.memberId,amount,'tournament_prize',`${t.title}: place ${position}`,ctx.entries,ctx.actor,t.id);t.escrow-=amount;}});position+=group.length;
 }
 ctx.need(t.escrow===0,'Tournament payout accounting failed.',503);champion.state='winner';t.state='completed';t.completedAt=ctx.now;
 for(const r of rooms(c,t))r.tournamentComplete=true;
 return true;
}
function movePlayer(c,t,source,destination,e){
 const p=source.players.find(p=>p.id===e.playerId);if(!p)return;
 const free=Array.from({length:9},(_,i)=>(i+1+(destination.bigBlindSeat??8))%9).find(n=>!destination.players.some(q=>!q.left&&q.seat===n));
 source.players=source.players.filter(q=>q.id!==p.id);
 Object.assign(p,{seat:free,cards:[],bet:0,total:0,antePaid:0,folded:false,waiting:false,left:false,lastAction:'Moved table'});
 destination.players.push(p);e.tableCode=destination.code;
 log(destination,`${e.name} moved from table ${source.tableNumber}.`,Date.now());
}
function rebalance(c,t){
 let rs=rooms(c,t);
 for(const r of rs)r.players=r.players.filter(p=>t.entrants[p.accountId]?.state==='playing');
 const remaining=activeEntries(t).length,target=Math.max(1,Math.ceil(remaining/9));
 while(rs.length>target){
  const source=[...rs].sort((a,b)=>a.players.length-b.players.length||b.tableNumber-a.tableNumber)[0];
  for(const p of [...source.players]){const destination=rs.filter(r=>r!==source).sort((a,b)=>a.players.length-b.players.length)[0];movePlayer(c,t,source,destination,t.entrants[p.accountId]);}
  source.closed=true;rs=rs.filter(r=>r!==source);
 }
 while(rs.length>1){
  const sorted=[...rs].sort((a,b)=>a.players.length-b.players.length),small=sorted[0],large=sorted.at(-1);if(large.players.length-small.players.length<=1)break;
  const next=[...large.players].sort((a,b)=>((a.seat-(large.bigBlindSeat??8)+9)%9||9)-((b.seat-(large.bigBlindSeat??8)+9)%9||9))[0];movePlayer(c,t,large,small,t.entrants[next.accountId]);
 }
 t.needsBarrier=false;
}
function deal(c,t,r,ctx,bubbleRound=null){
 const [sb,bb]=blindLevel(t.level);Object.assign(r,{smallBlind:sb,bigBlind:bb,ante:bb,turnMs:20000,handLevel:t.level,bubbleRound,handOpening:Object.fromEntries(r.players.filter(p=>!p.left).map(p=>[p.id,p.chips]))});
 for(const p of r.players)p.timeCardUsedTurn=null;
 startHand(r,r.hostId=r.players.find(p=>!p.left&&p.chips>0)?.id,ctx.now);
 r.nextHandAt=null;for(const p of r.players){const e=t.entrants[p.accountId];if(e)e.stack=p.chips;}recordHand(c,t,r,ctx);
}
function advance(c,t,ctx){
 if(['registration','completed','cancelled'].includes(t.state))return;
 const inactive=activeEntries(t).some(e=>c.members[e.memberId]?.status!=='active');
 if(inactive&&t.state!=='paused'){t.previousState=t.state;t.state='paused';t.pauseAt=ctx.now;t.pauseReason='Membership review';}
 if(t.state==='paused')return;
 if(t.state==='break'){
  if(ctx.now<t.breakUntil)return;
  t.state='running';t.level=7;t.nextLevelAt=t.breakUntil+LEVEL_MS;t.breakUntil=null;
 }
 if(t.state==='running'){
  while(ctx.now>=t.nextLevelAt){
   if(t.level===6){t.state='closing_rebuys';t.needsBarrier=true;break;}
   t.level++;t.nextLevelAt+=LEVEL_MS;
  }
 }
 for(const r of rooms(c,t)){
  tick(r,ctx.now);recordHand(c,t,r,ctx);
  for(const p of r.players){const e=t.entrants[p.accountId];if(e)e.stack=p.chips;}
 }
 for(const e of activeEntries(t))if(e.state==='rebuy'&&ctx.now>=e.rebuyUntil)eliminate(t,e);
 const rs=rooms(c,t),noLive=rs.every(r=>!isPlaying(r)),noPending=!activeEntries(t).some(e=>e.state==='rebuy');
 if(noLive&&noPending&&complete(c,t,ctx))return;
 if(t.state==='closing_rebuys'){
  if(noLive&&noPending){rebalance(c,t);t.rebuyClosed=true;t.state='break';t.breakUntil=ctx.now+BREAK_MS;t.nextLevelAt=null;}
  return;
 }
 const everyoneVoted=activeEntries(t).length>0&&activeEntries(t).every(e=>t.pauseVotes[e.memberId]);
 if(everyoneVoted){t.needsBarrier=true;if(noLive&&noPending){t.previousState='running';t.state='paused';t.pauseAt=ctx.now;t.pauseReason='Players requested a pause';}return;}
 const counts=rs.map(r=>r.players.filter(p=>t.entrants[p.accountId]?.state==='playing').length);
 if(Math.max(...counts)-Math.min(...counts)>1||counts.some(n=>n<2)||rs.length>Math.ceil(activeEntries(t).length/9))t.needsBarrier=true;
 const bubble=t.rebuyClosed&&activeEntries(t).length===weights(t.originalPlayers).length+1&&rs.length>1;
 if(bubble||t.needsBarrier||!noPending){
  if(!noLive||!noPending||rs.some(r=>(r.nextHandAt||0)>ctx.now))return;
  rebalance(c,t);
  const round=bubble?++t.bubbleSequence:null;
  for(const r of rooms(c,t))if(r.players.filter(p=>p.chips>0).length>=2)deal(c,t,r,ctx,round);
 }else{
  for(const r of rs)if(!isPlaying(r)&&(!r.nextHandAt||r.nextHandAt<=ctx.now)&&r.players.filter(p=>p.chips>0&&!p.left).length>=2)deal(c,t,r,ctx);
 }
}
export function advanceTournaments(c,ctx){
 if(!c.tournaments)return false;
 const before=JSON.stringify([c.tournaments,Object.values(c.tables).filter(r=>r.tournamentId)]);
 for(const t of Object.values(c.tournaments))advance(c,t,ctx);
 return before!==JSON.stringify([c.tournaments,Object.values(c.tables).filter(r=>r.tournamentId)]);
}
export function tournamentAction(c,b,ctx){
 c.tournaments??={};const {actor:id,now,need}=ctx;
 if(b.action==='tournament-create'){
  need(['host','owner'].includes(c.members[id].role),'Only hosts can create tournaments.',403);
  need(Object.values(c.tournaments).filter(t=>!['completed','cancelled'].includes(t.state)).length<5,'Finish an existing tournament first.');
  const buyIn=b.buyIn??1000;need(Number.isSafeInteger(buyIn)&&buyIn>=1&&buyIn<=1000000,'Entry must be 1–1,000,000 whole chips.');
  const title=typeof b.title==='string'?b.title.trim().replace(/[\u0000-\u001f]/g,'').slice(0,40):'';need(title,'Give the tournament a name.');const idTour=code(c);
  c.tournaments[idTour]={id:idTour,title,managerId:id,state:'registration',buyIn,startingStack:START_STACK,entrants:{},originalPlayers:0,totalEntries:0,totalRebuys:0,prizePool:0,escrow:0,chipsIssued:0,level:1,tableCodes:[],eliminations:[],eliminationSequence:0,groupOrders:{},bubbleSequence:0,pauseVotes:{},createdAt:now,registrationSequence:0,results:[]};return {tournamentId:idTour};
 }
 need(typeof b.tournamentId==='string'&&has(c.tournaments,b.tournamentId),'Tournament not found.',404);const t=c.tournaments[b.tournamentId],e=t.entrants[id];
 if(b.action==='tournament-register'){
  need(t.state==='registration','Registration is closed.');need(!e,'You already registered.');need(Object.keys(t.entrants).length<27,'This tournament is full.');
  ctx.wallet(c,id,-t.buyIn,'tournament_entry',`${t.title}: entry`,ctx.entries,id,t.id);
  t.entrants[id]={memberId:id,playerId:crypto.randomUUID(),name:c.members[id].name,state:'registered',stack:START_STACK,rebuys:0,timeCards:2,order:t.registrationSequence++};t.totalEntries++;t.prizePool+=t.buyIn;t.escrow+=t.buyIn;
 }else if(b.action==='tournament-unregister'){
  need(t.state==='registration'&&e,'You can unregister only before the start.');ctx.wallet(c,id,t.buyIn,'tournament_refund',`${t.title}: unregistered`,ctx.entries,id,t.id);delete t.entrants[id];t.totalEntries--;t.prizePool-=t.buyIn;t.escrow-=t.buyIn;
 }else if(b.action==='tournament-cancel'){
  need(canManage(c,t,id),'Only this tournament manager can cancel.',403);need(t.state==='registration','A running tournament cannot be cancelled.');
  for(const entry of Object.values(t.entrants)){ctx.wallet(c,entry.memberId,t.buyIn,'tournament_refund',`${t.title}: cancelled`,ctx.entries,id,t.id);t.escrow-=t.buyIn;entry.state='refunded';}t.state='cancelled';
 }else if(b.action==='tournament-start'){
  need(canManage(c,t,id),'Only this tournament manager can start.',403);need(t.state==='registration','This tournament already started.');const entrants=shuffle(Object.values(t.entrants));need(entrants.length>=2,'At least two registered players are needed.');need(entrants.every(e=>c.members[e.memberId]?.status==='active'),'Restore or unregister inactive entrants first.');
  const count=Math.ceil(entrants.length/9);need(Object.values(c.tables).filter(r=>!r.closed).length+count<=30,'Too many open club tables.');t.originalPlayers=entrants.length;t.chipsIssued=entrants.length*START_STACK;t.state='running';t.startedAt=now;t.nextLevelAt=now+LEVEL_MS;
  for(let i=0;i<count;i++){
   const first=makePlayer('Tournament','');const r=makeRoom(code(c),first);Object.assign(r,{players:[],hostId:null,maxSeats:9,tournamentId:t.id,tableNumber:i+1,title:`${t.title} / Table ${i+1}`,managerId:t.managerId,turnMs:20000,locked:true,paused:false,banned:[]});c.tables[r.code]=r;t.tableCodes.push(r.code);
  }
  entrants.forEach((entry,index)=>{const r=c.tables[t.tableCodes[index%count]],p=makePlayer(entry.name,'');Object.assign(p,{id:entry.playerId,accountId:entry.memberId,chips:START_STACK,seat:r.players.length});r.players.push(p);entry.state='playing';entry.tableCode=r.code;});
  for(const r of rooms(c,t)){r.initialButtonSeat=shuffle(r.players)[0].seat;deal(c,t,r,ctx);}
 }else if(b.action==='tournament-rebuy'){
  need(e&&e.state==='rebuy'&&now<e.rebuyUntil&&!t.rebuyClosed&&['running','closing_rebuys'].includes(t.state),'Rebuy is unavailable or has expired.');const p=player(c,e);need(p&&p.chips===0,'Only a busted player can rebuy.');
  ctx.wallet(c,id,-t.buyIn,'tournament_rebuy',`${t.title}: rebuy ${e.rebuys+1}`,ctx.entries,id,t.id);Object.assign(p,{chips:START_STACK,left:false,folded:false,waiting:false,lastAction:'Rebuy'});e.state='playing';e.stack=START_STACK;e.rebuys++;delete e.rebuyUntil;delete e.bustGroup;t.totalEntries++;t.totalRebuys++;t.prizePool+=t.buyIn;t.escrow+=t.buyIn;t.chipsIssued+=START_STACK;
 }else if(b.action==='tournament-decline'){
  need(e?.state==='rebuy','No rebuy decision is pending.');eliminate(t,e);
 }else if(b.action==='tournament-pause-vote'){
  need(e&&['playing','rebuy'].includes(e.state)&&t.state==='running','You cannot request a pause now.');need(typeof b.value==='boolean','Choose true or false.');t.pauseVotes[id]=b.value;
 }else if(b.action==='tournament-resume'){
  need(t.state==='paused','This tournament is not paused.');need(canManage(c,t,id)||e&&['playing','rebuy'].includes(e.state),'Only a participant or manager can resume.',403);need(activeEntries(t).every(e=>c.members[e.memberId]?.status==='active'),'Resolve the membership review before resuming.');
  shiftTimers(c,t,now-t.pauseAt);t.state=t.previousState;t.pauseVotes={};delete t.pauseAt;delete t.pauseReason;
 }else throw Object.assign(new Error('Unknown tournament action.'),{name:'PokerRuleError'});
 return {tournamentId:t.id};
}
export function tournamentTableAction(c,r,b,ctx){
 const t=c.tournaments[r.tournamentId],e=t.entrants[ctx.actor];ctx.need(t&&t.state==='running'||t?.state==='closing_rebuys','Tournament play is paused.');
 const p=r.players.find(p=>p.accountId===ctx.actor);ctx.need(e?.state==='playing'&&p&&!p.left,'You do not have an active seat at this table.',403);
 if(b.action==='act'||b.action==='timecard'){
  ctx.need(b.hand===r.hand&&b.turnSerial===r.turnSerial,'The action changed. Please try again.',409);ctx.need(r.turnId===p.id&&r.deadline>ctx.now,'Your turn has expired.',409);
  if(b.action==='act')act(r,p.id,b.move,b.amount,ctx.now);
  else{const key=`${r.code}:${r.hand}:${r.turnSerial}`;ctx.need(e.timeCards>0&&e.timeCardTurn!==key,'One time card is allowed per action.');e.timeCards--;e.timeCardTurn=key;r.deadline+=20000;log(r,`${e.name} used a time card (+20s).`,ctx.now);}
 }else if(b.action==='emote'){
  ctx.need(['👋','😎','👏','🍀'].includes(b.emoji),'Unknown emote.');p.emote=b.emoji;p.emoteUntil=ctx.now+2200;
 }else ctx.need(false,'Tournament stacks cannot be cashed out, topped up, moved or managed as cash tables.');
 recordHand(c,t,r,ctx);for(const p of r.players){const entry=t.entrants[p.accountId];if(entry)entry.stack=p.chips;}
}
export function assertTournaments(c,need){
 for(const t of Object.values(c.tournaments||{})){
  need(Number.isSafeInteger(t.chipsIssued),'Tournament stack limit reached.',503);
  need(Number.isSafeInteger(t.prizePool)&&Number.isSafeInteger(t.escrow)&&t.escrow>=0&&t.escrow<=t.prizePool,'Invalid tournament reserve.',503);
  need(t.state==='cancelled'?t.escrow===0:t.escrow+t.results.reduce((n,r)=>n+r.amount,0)===t.prizePool,'Tournament prize accounting failed.',503);
  for(const r of Object.values(c.tables).filter(r=>r.tournamentId===t.id)){need(Number.isSafeInteger(r.antePot||0)&&(r.antePot||0)>=0,'Invalid tournament ante.',503);for(const p of r.players)need(Number.isSafeInteger(p.chips)&&p.chips>=0&&Number.isSafeInteger(p.total)&&p.total>=0,'Invalid tournament stack.',503);}
  if(['registration','cancelled'].includes(t.state))continue;
  const held=Object.values(c.tables).filter(r=>r.tournamentId===t.id).reduce((sum,r)=>sum+r.players.reduce((n,p)=>n+p.chips+(isPlaying(r)?p.total:0),0)+(isPlaying(r)?r.antePot||0:0),0);
  need(held===t.chipsIssued,'Tournament chip accounting failed.',503);
 }
}
export function tournamentView(c,t,id,now){
 const e=t.entrants[id],live=activeEntries(t),[sb,bb]=blindLevel(t.level);
 return {id:t.id,title:t.title,state:t.state,buyIn:t.buyIn,startingStack:START_STACK,players:t.originalPlayers||Object.keys(t.entrants).length,remaining:t.state==='registration'?Object.keys(t.entrants).length:t.state==='completed'?1:live.length,totalEntries:t.totalEntries,totalRebuys:t.totalRebuys,prizePool:t.prizePool,escrow:t.escrow,level:t.level,smallBlind:sb,bigBlind:bb,ante:bb,nextLevelAt:t.nextLevelAt||null,breakUntil:t.breakUntil||null,rebuyClosed:!!t.rebuyClosed,serverNow:now,pauseReason:t.pauseReason||null,canManage:canManage(c,t,id),payouts:prizeAmounts(t),tables:rooms(c,t).map(r=>({code:r.code,number:r.tableNumber,players:r.players.filter(p=>t.entrants[p.accountId]?.state==='playing').length,stage:r.stage})),self:e?{state:e.state,tableCode:e.tableCode||null,playerId:e.playerId,rebuyUntil:e.rebuyUntil||null,timeCards:e.timeCards,rebuys:e.rebuys,place:e.place||null,prize:e.prize||0,pauseVoted:!!t.pauseVotes[id]}:null,leaderboard:Object.values(t.entrants).map(e=>({id:e.playerId,name:e.name,stack:e.stack,state:e.state,rebuys:e.rebuys,place:e.place||null,prize:e.prize||0})).sort((a,b)=>(a.place||99)-(b.place||99)||b.stack-a.stack),results:t.results};
}
