import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleTable} from '../../lib/table-api.mjs';
export const alice={userId:'alice',email:'alice@example.com',displayName:'Alice'},bob={userId:'bob',email:'bob@example.com',displayName:'Bob'},eve={userId:'eve',email:'eve@example.com',displayName:'Eve'};
export function database(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../../drizzle/'+f,import.meta.url),'utf8'));
 const db={sql,fail:false,prepare(query){return{bind(...args){return{query,args,async first(){return sql.prepare(query).get(...args);},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>{if(db.fail&&s.query.includes('INSERT INTO club_ledger'))throw new Error('injected failure');return{meta:{changes:Number(sql.prepare(s.query).run(...s.args).changes)}};});sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return db;
}
export async function send(db,b,user=alice){const response=await handleTable(new Request('https://club.test/api/table',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...b})}),db,user,{ownerEmail:alice.email});return{status:response.status,...await response.json()};}
export async function setup(){const db=database();assert.equal((await send(db,{action:'setup',name:'The Club'})).status,200);await send(db,{action:'invite',email:bob.email,role:'member'});await send(db,{action:'accept'},bob);for(const memberId of ['alice','bob'])await send(db,{action:'adjust',memberId,amount:5000,reason:'Initial club chips'});return db;}
export async function table(db){const a=await send(db,{action:'create',title:'Friends',minBuyIn:400,maxBuyIn:10000});assert.equal(a.status,200);return a.code;}
export const state=(db,code,user=alice)=>send(db,{action:'state',code},user);
export const resetRate=db=>db.sql.exec('DELETE FROM club_rate_limits');

