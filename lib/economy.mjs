export const MODES=['regular','tournament'];
export const REGULAR_STACK=2000;
// One-way migration. Retired wallet balances are discarded, never converted.
export function migrateEconomy(c,now){
 if(c.economyVersion===3)return false;
 if(c.economyVersion===2){for(const m of Object.values(c.members)){delete m.wallet;delete m.legacyWallet;}c.economyVersion=3;return true;}
 for(const m of Object.values(c.members)){
  delete m.wallet;delete m.legacyWallet;
  m.tickets={regular:0,tournament:0};m.points={regular:0,tournament:0};
 }
 for(const r of Object.values(c.tables))if(!r.practice&&!r.tournamentId){
  r.startingStack=REGULAR_STACK;r.chipsRetired=0;
  r.chipsIssued=r.players.reduce((n,p)=>n+p.chips+(!['waiting','showdown'].includes(r.stage)?p.total:0),0);
 }
 for(const t of Object.values(c.tournaments||{})){t.pointsPerEntry=t.buyIn||1000;delete t.buyIn;}
 c.economyVersion=3;c.economyMigratedAt=now;return true;
}
export function resource(c,id,mode,type,delta,kind,reason,entries,actor,table=null,tableDelta=0,stack=null){
 const m=Object.hasOwn(c.members,id)&&c.members[id];
 if(!m)throw Object.assign(new Error('Member not found.'),{name:'PokerRuleError'});
 const balance=m[type]?.[mode]+delta;
 if(!MODES.includes(mode)||!['tickets','points'].includes(type)||!Number.isSafeInteger(delta)||!Number.isSafeInteger(balance)||balance<0)throw Object.assign(new Error(type==='tickets'?'Not enough matching tickets, or ticket limit reached.':'Point limit reached.'),{name:'PokerRuleError'});
 m[type][mode]=balance;
 entries.push({id:crypto.randomUUID(),member:id,actor,mode,resource:type,resourceDelta:delta,balance,kind,reason,table,tableDelta,stack,at:Date.now()});
}
export function assertEconomy(c,need){
 for(const m of Object.values(c.members))for(const mode of MODES)for(const type of ['tickets','points'])need(Number.isSafeInteger(m[type]?.[mode])&&m[type][mode]>=0,'Invalid ticket or point balance.',503);
 for(const r of Object.values(c.tables))if(!r.practice&&!r.tournamentId){
  const held=r.players.reduce((n,p)=>{need(Number.isSafeInteger(p.chips)&&p.chips>=0&&Number.isSafeInteger(p.total)&&p.total>=0,'Invalid table chips.',503);return n+p.chips+(!['waiting','showdown'].includes(r.stage)?p.total:0);},0);
  need(Number.isSafeInteger(r.chipsIssued)&&Number.isSafeInteger(r.chipsRetired)&&held+r.chipsRetired===r.chipsIssued,'Regular table chip accounting failed.',503);
 }
}
export const publicMember=({wallet,legacyWallet,...m})=>m;
