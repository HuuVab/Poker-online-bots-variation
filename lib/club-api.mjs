import {advanceTournaments,tournamentAction,tournamentTableAction,tournamentView,assertTournaments} from './tournament.mjs';
import {makePlayer,makeRoom,joinRoom,startHand,act,leaveRoom,rebuy,tick,viewRoom,moveSeat,isPlaying} from './poker.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
class Denied extends Error{constructor(message,status=400){super(message);this.status=status;}}
const need=(v,m,s=400)=>{if(!v)throw new Denied(m,s);};
const int=(v,min=1,max=1000000000)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const email=v=>typeof v==='string'?v.trim().toLowerCase():'';
const clean=(v,max)=>typeof v==='string'?v.trim().replace(/[\u0000-\u001f]/g,'').slice(0,max):'';
const own=(object,key)=>typeof key==='string'&&Object.hasOwn(object,key)?object[key]:undefined;
const active=(c,id)=>own(c.members,id)?.status==='active';
const owner=(c,id)=>c.ownerId===id;
const manage=(c,t,id)=>owner(c,id)||(c.members[id]?.role==='host'&&t.managerId===id);
const readActions=new Set(['status','state','history']);
const tableActions=new Set(['state','join','deal','act','seat','leave','rebuy','emote','lock','pause','close','kick','timecard']);
const actions=new Set([...readActions,...tableActions,'setup','accept','invite','revoke','member','adjust','create','tournament-create','tournament-register','tournament-unregister','tournament-start','tournament-cancel','tournament-rebuy','tournament-decline','tournament-pause-vote','tournament-resume']);
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.keys(b).sort().filter(k=>k!=='requestId').map(k=>[k,b[k]]))))))).map(v=>v.toString(16).padStart(2,'0')).join('');
function wallet(c,id,delta,kind,reason,entries,actor,table=null,tableDelta=0,stack=null){
 const m=own(c.members,id);need(m,'Member not found.',404);need(int(m.wallet+delta,0,Number.MAX_SAFE_INTEGER),'Insufficient wallet balance or wallet limit exceeded.');
 if(kind==='owner_adjustment'&&delta>0)need(m.wallet+delta<=1000000000000,'Wallet grant limit exceeded.');m.wallet+=delta;
 entries.push({id:crypto.randomUUID(),member:id,actor,delta,kind,reason,table,tableDelta,stack,wallet:m.wallet,at:Date.now()});
}
function supply(c){
 let total=Object.values(c.members).reduce((n,m)=>{need(int(m.wallet,0,Number.MAX_SAFE_INTEGER),'Invalid wallet state.',503);return n+m.wallet;},0);
 for(const t of Object.values(c.tables))if(!t.practice&&!t.tournamentId)for(const p of t.players){need(int(p.chips,0,1000000000000)&&int(p.total,0,1000000000000),'Invalid stack state.',503);total+=p.chips+(isPlaying(t)?p.total:0);}
 total+=Object.values(c.tournaments||{}).reduce((n,t)=>n+t.escrow,0);
 need(Number.isSafeInteger(total),'Club chip limit reached.',503);return total;
}
function finish(c,t,entries,hands,actor){
 if(t.practice||t.tournamentId)return;
 if(t.stage==='showdown'&&t.accountedHand!==t.hand){
  for(const p of t.players)if(p.accountId&&Object.hasOwn(t.opening||{},p.id))wallet(c,p.accountId,0,'hand_result',`Hand ${t.hand}`,entries,actor,t.code,p.chips-t.opening[p.id],p.chips);
  hands.push({id:`${t.code}:${t.hand}`,table:t.code,hand:t.hand,data:JSON.stringify({board:t.board,results:t.results,players:t.players.map(p=>({id:p.id,name:p.name,net:Object.hasOwn(t.opening||{},p.id)?p.chips-t.opening[p.id]:0,cards:t.showCards&&!p.folded?p.cards:[]}))})});
  t.accountedHand=t.hand;delete t.opening;
 }
 if(!isPlaying(t)){
  for(const p of t.players)if(p.accountId&&!p.cashedOut&&(p.exitAfterHand||t.closing||!active(c,p.accountId))){wallet(c,p.accountId,p.chips,'cash_out','Table cash-out',entries,actor,t.code,-p.chips,0);p.chips=0;p.left=true;p.cashedOut=true;}
  if(t.closing)t.closed=true;
 }
}
function tableView(c,t,id,version,now=Date.now()){
 if(t.tournamentId){const entrant=c.tournaments[t.tournamentId]?.entrants[id];if(entrant?.tableCode&&['playing','rebuy'].includes(entrant.state)&&entrant.tableCode!==t.code&&c.tables[entrant.tableCode])t=c.tables[entrant.tableCode];else if(t.closed){const next=c.tournaments[t.tournamentId]?.tableCodes.map(code=>c.tables[code]).find(r=>!r.closed);if(next)t=next;}}
 const me=t.players.find(p=>p.accountId===id&&!p.cashedOut),v=viewRoom(t,me?.id||null,version);
 for(const k of ['opening','managerId','banned','accountedHand','handOpening','tournamentRecordedHand','initialButtonSeat','bubbleRound'])delete v[k];
 v.players=v.players.map(({accountId,exitAfterHand,cashedOut,...p})=>p);v.canManage=!t.tournamentId&&manage(c,t,id);v.wallet=c.members[id]?.wallet||0;v.serverNow=now;
 if(t.tournamentId){const tour=c.tournaments[t.tournamentId],entry=tour.entrants[id];v.tournament=tournamentView(c,tour,id,now);if(!['running','closing_rebuys'].includes(tour.state)){v.legal=null;v.turnId=null;v.deadline=null;}v.canUseTimeCard=!!entry&&entry.timeCards>0&&t.turnId===pId(t,id)&&entry.timeCardTurn!==`${t.code}:${t.hand}:${t.turnSerial}`;}
 return v;
}
function pId(t,id){return t.players.find(p=>p.accountId===id)?.id;}
function clubView(c,id,version,now=Date.now()){
 const m=c.members[id];return {initialized:true,name:c.name,version,member:{id,...m},tables:Object.values(c.tables).filter(t=>!t.closed&&!t.tournamentId&&(!t.practice||t.managerId===id)).map(t=>({code:t.code,title:t.title,practice:t.practice,stage:t.stage,players:t.players.filter(p=>!p.left).length,locked:t.locked,paused:t.paused,closing:t.closing,minBuyIn:t.minBuyIn,maxBuyIn:t.maxBuyIn,canManage:manage(c,t,id),seated:t.players.some(p=>p.accountId===id&&!p.cashedOut),banned:t.banned.includes(id)})),tournaments:Object.values(c.tournaments||{}).map(t=>tournamentView(c,t,id,now)),members:owner(c,id)?Object.entries(c.members).map(([id,m])=>({id,...m})):[],invites:owner(c,id)?Object.values(c.invites):[]};
}
async function bodyOf(r){
 const reader=r.body?.getReader();need(reader,'Invalid request.');let chunks=[],size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new Denied('Request too large.',413);}chunks.push(...value);}
 let b;try{b=JSON.parse(new TextDecoder().decode(new Uint8Array(chunks)));}catch{throw new Denied('Invalid JSON.');}need(b&&typeof b==='object'&&!Array.isArray(b),'Invalid request.');return b;
}
// The route supplies verified identity. No identity, role or balance from the browser is trusted.
export async function handleClub(request,db,identity,config={}){
 try{
  need(request.method==='POST','Use POST.',405);need(identity?.userId&&identity?.email,'Sign in to enter the club.',401);
  const origin=request.headers.get('Origin');need(!origin||origin===new URL(request.url).origin,'Cross-site request refused.',403);need(db,'The club service is unavailable.',503);
  const b=await bodyOf(request),id=identity.userId,now=config.now??Date.now(),read=readActions.has(b.action);
  need(typeof b.action==='string'&&actions.has(b.action),'Unknown action.');
  if(tableActions.has(b.action))need(typeof b.code==='string'&&/^[A-Z2-9]{6}$/.test(b.code),'Enter a six-character table code.');
  if(['lock','pause'].includes(b.action))need(typeof b.value==='boolean','Choose true or false.');
  const rate=await db.prepare('INSERT INTO club_rate_limits (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count').bind(`${id}:${read?'read':'write'}`,Math.floor(now/60000)).first();
  need(rate.count<=(read?150:60),'Too many requests. Please wait a moment.',429);
  if(!read)need(typeof b.requestId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId),'A unique request ID is required.');const fingerprint=read?null:await hash(b);
  for(let attempt=0;attempt<8;attempt++){
   const row=await db.prepare('SELECT state, version FROM clubs WHERE id = ?').bind('main').first();let c=row?JSON.parse(row.state):null;
   const canSetup=!!config.ownerEmail&&email(identity.email)===email(config.ownerEmail);
   if(!c&&b.action!=='setup')return json({club:{initialized:false,canSetup,member:null}});
   if(!c){need(canSetup,'Only the configured owner can open this club.',403);const name=clean(b.name,50);need(name,'Give the club a name.');c={name,ownerId:id,members:{[id]:{name:clean(identity.displayName||identity.fullName||'Club owner',18),email:email(identity.email),role:'owner',status:'active',wallet:0}},invites:{},tables:{}};}
   const previous=read?null:await db.prepare('SELECT fingerprint, result FROM club_operations WHERE actor_id = ? AND request_id = ?').bind(id,b.requestId).first();
   if(previous){need(previous.fingerprint===fingerprint,'This request ID was used for another action.',409);need(active(c,id),'Membership is inactive.',403);const r=JSON.parse(previous.result);return json({...r,club:clubView(c,id,row.version,now),...(r.code?{room:tableView(c,c.tables[r.code],id,row.version,now)}:{})});}
   if(b.action==='status'&&!active(c,id)){const invite=c.invites[email(identity.email)];return json({club:{initialized:true,name:c.name,member:null,invited:!!invite&&invite.expires>now,status:c.members[id]?.status}});}
   const entries=[],hands=[];let result={},changed=!row;
   const context={actor:id,now,need,wallet,entries,hands};
   if(b.action==='accept'){
    const invite=c.invites[email(identity.email)];need(invite&&invite.expires>now,'No active invitation matches your signed-in email.',403);need(!active(c,id),'Already a member.');need(Object.keys(c.members).length<250||c.members[id],'This club is full.');
    c.members[id]={name:clean(identity.displayName||identity.fullName||'Player',18),email:email(identity.email),role:invite.role,status:'active',wallet:c.members[id]?.wallet||0};delete c.invites[email(identity.email)];changed=true;
   }else{
    need(active(c,id),'An active club membership is required.',403);
    for(const t of Object.values(c.tables)){if(t.closed||t.tournamentId||(t.practice&&t.managerId!==id))continue;const before=JSON.stringify(t);tick(t,now);finish(c,t,entries,hands,id);if(before!==JSON.stringify(t))changed=true;}
    if(advanceTournaments(c,context))changed=true;
    if(b.action.startsWith('tournament-')){result=tournamentAction(c,b,context);advanceTournaments(c,context);changed=true;}else if(['invite','revoke','member','adjust'].includes(b.action)){
     need(owner(c,id),'Only the owner can manage members or issue chips.',403);
     if(b.action==='invite'){const address=email(b.email);need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),'Enter a valid email.');need(['host','member'].includes(b.role),'Choose member or host.');need(Object.keys(c.invites).length<250||c.invites[address],'Too many invitations.');c.invites[address]={email:address,role:b.role,expires:now+7*86400000};}
     else if(b.action==='revoke')delete c.invites[email(b.email)];
     else if(b.action==='member'){const m=own(c.members,b.memberId);need(m&&b.memberId!==c.ownerId,'The owner account cannot be changed.');need(['active','suspended','removed'].includes(b.status)&&['member','host'].includes(b.role),'Invalid membership settings.');m.status=b.status;m.role=b.role;for(const t of Object.values(c.tables)){if(t.tournamentId)continue;for(const p of t.players)if(p.accountId===b.memberId&&m.status!=='active')p.exitAfterHand=true;if(t.practice&&t.managerId===b.memberId&&m.status!=='active')t.closed=true;finish(c,t,entries,hands,id);}advanceTournaments(c,context);}
     else{need(int(b.amount,-1000000000,1000000000)&&b.amount!==0,'Enter a non-zero whole-chip adjustment.');const reason=clean(b.reason,160);need(reason.length>=3,'An audit reason is required.');wallet(c,b.memberId,b.amount,'owner_adjustment',reason,entries,id);}changed=true;
    }else if(b.action==='create'){
     const practice=b.practice===true;need(practice||['owner','host'].includes(c.members[id].role),'Only hosts can create club tables.',403);
     // Closed tables contain no funds; immutable SQL history remains available.
     // Keep closed table identities for idempotent retries and immutable hand references.
     need(Object.values(c.tables).filter(t=>!t.closed).length<30,'Close an existing table first.');if(practice)need(!Object.values(c.tables).some(t=>t.practice&&t.managerId===id&&!t.closed),'You already have a practice table.');
     const min=practice?2000:b.minBuyIn??400,max=practice?2000:b.maxBuyIn??10000;need(int(min,20)&&int(max,min),'Invalid buy-in limits.');
     let code;do{code=Array.from(crypto.getRandomValues(new Uint8Array(6)),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');}while(c.tables[code]);
     const p=makePlayer(c.members[id].name,'');p.accountId=id;const t=makeRoom(code,p,practice);Object.assign(t,{title:clean(b.title,40)||(practice?'House practice':'Club table'),managerId:id,minBuyIn:min,maxBuyIn:max,locked:false,paused:false,banned:[]});
     if(practice){t.players.push(...['Milo','Jules','Cleo'].map(n=>makePlayer(n,'',true)));startHand(t,p.id);}else{t.players=[];t.hostId=null;}c.tables[code]=t;result={code};changed=true;
    }else if(b.action==='history'){
     need(!b.memberId||b.memberId===id||owner(c,id),'Only your own chip history is available.',403);const rows=await db.prepare('SELECT * FROM club_ledger WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').bind(b.memberId||id).all();result={entries:rows.results};
    }else if(!['status','setup'].includes(b.action)){
     const t=own(c.tables,b.code);need(t,'Table not found.',404);need(!t.practice||t.managerId===id,'This practice table is private.',403);result={code:t.code};let p=t.players.find(p=>p.accountId===id&&!p.cashedOut);
     if(b.action!=='state'&&t.tournamentId){tournamentTableAction(c,t,b,context);advanceTournaments(c,context);changed=true;}else if(b.action!=='state'){
      need(!t.closed,'This table is closed. Return to the club.');
      if(b.action==='join'){need(!t.locked&&!t.closing&&!t.banned.includes(id),'This table is not accepting you at the moment.',403);need(!p,'You already have a seat.');need(!t.practice,'Practice chips cannot enter the club wallet.');need(int(b.amount,t.minBuyIn,t.maxBuyIn),'Choose a buy-in within the table limits.');p=makePlayer(c.members[id].name,'');p.accountId=id;p.chips=b.amount;joinRoom(t,p,b.seat);wallet(c,id,-b.amount,'buy_in','Table buy-in',entries,id,t.code,b.amount,p.chips);}
      else if(['lock','pause','close','kick'].includes(b.action)){
       need(manage(c,t,id),'Only this table manager or the owner can do that.',403);if(b.action==='lock')t.locked=b.value===true;if(b.action==='pause')t.paused=b.value===true;if(b.action==='close'){t.closing=true;t.locked=true;t.paused=true;}
       if(b.action==='kick'){const q=t.players.find(p=>p.id===b.playerId&&!p.cashedOut);need(q&&!q.bot,'Player not found.');need(q.accountId!==c.ownerId,'The owner cannot be removed.');q.exitAfterHand=true;if(!t.banned.includes(q.accountId))t.banned.push(q.accountId);}
      }else if(b.action==='deal'){
       need(manage(c,t,id),'Only the table manager can deal.',403);need(!t.paused&&!t.closing,'This table is paused.');need(!isPlaying(t),'Finish this hand first.');t.opening=Object.fromEntries(t.players.filter(p=>!p.left).map(p=>[p.id,p.chips]));startHand(t,t.hostId=t.players.find(p=>!p.left)?.id);
      }else{
       need(p&&!p.left,'Take a seat before playing.',403);
       if(b.action==='act'){need(b.version===row.version,'The table changed. Try your action again.',409);act(t,p.id,b.move,b.amount,now);}
       else if(b.action==='seat')moveSeat(t,p.id,b.seat);
       else if(b.action==='leave'){if(t.practice){t.closed=true;p.left=true;}else{p.exitAfterHand=true;if(isPlaying(t)&&p.chips>0&&!p.waiting)leaveRoom(t,p.id,now);}}
       else if(b.action==='rebuy'){if(t.practice)rebuy(t,p.id);else{need(!isPlaying(t),'Top up between hands.');need(int(b.amount,1,t.maxBuyIn)&&p.chips+b.amount<=t.maxBuyIn,'Top-up exceeds the table limit.');wallet(c,id,-b.amount,'buy_in','Table top-up',entries,id,t.code,b.amount,p.chips+b.amount);p.chips+=b.amount;}}
       else if(b.action==='emote'){need(['👋','😎','👏','🍀'].includes(b.emoji),'Unknown emote.');p.emote=b.emoji;p.emoteUntil=now+2200;}
       else throw new Denied('Unknown action.');
      }finish(c,t,entries,hands,id);changed=true;
     }
    }
   }
   if(!read)changed=true;let version=row?.version??0;
   if(changed){
    assertTournaments(c,need);const marker=crypto.randomUUID();version=(row?.version??-1)+1;const expected=row?supply(JSON.parse(row.state)):0;need(supply(c)===expected+entries.filter(e=>e.kind==='owner_adjustment').reduce((n,e)=>n+e.delta,0),'Chip accounting check failed.',503);const state=JSON.stringify(c);need(state.length<1500000,'Club storage limit reached.',503);
    const guard=' WHERE EXISTS (SELECT 1 FROM clubs WHERE id=? AND version=? AND last_commit=?)',args=['main',version,marker];
    const statements=[row?db.prepare('UPDATE clubs SET state=?,version=?,last_commit=?,updated_at=? WHERE id=? AND version=?').bind(state,version,marker,now,'main',row.version):db.prepare('INSERT OR IGNORE INTO clubs (id,state,version,last_commit,updated_at) VALUES (?,?,?,?,?)').bind('main',state,version,marker,now)];
    for(const e of entries)statements.push(db.prepare('INSERT INTO club_ledger (id,member_id,actor_id,kind,table_code,wallet_delta,table_delta,wallet_after,stack_after,reason,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?'+guard).bind(e.id,e.member,e.actor,e.kind,e.table,e.delta,e.tableDelta,e.wallet,e.stack,e.reason,e.at,...args));
    for(const h of hands)statements.push(db.prepare('INSERT INTO club_hands (id,table_code,hand,data,created_at) SELECT ?,?,?,?,?'+guard).bind(h.id,h.table,h.hand,h.data,now,...args));
    if(!read)statements.push(db.prepare('INSERT INTO club_operations (actor_id,request_id,fingerprint,result,created_at) SELECT ?,?,?,?,?'+guard).bind(id,b.requestId,fingerprint,JSON.stringify(result),now,...args));
    const committed=await db.batch(statements);if(!committed[0].meta.changes)continue;
   }
   return json({...result,club:clubView(c,id,version,now),...(result.code?{room:tableView(c,c.tables[result.code],id,version,now)}:{})});
  }throw new Denied('The club is busy. Retry your request.',409);
 }catch(e){if(e instanceof Denied)return json({error:e.message},e.status);if(e?.name==='PokerRuleError')return json({error:e.message},400);console.error('Club request failed',e?.name);return json({error:'The request could not be completed. Please retry.'},503);}
}
