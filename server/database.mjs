import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';

export function openDatabase(filename){
 if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
 const sql=new DatabaseSync(filename);sql.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 sql.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
  const source=readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'),hash=createHash('sha256').update(source).digest('hex');
  sql.exec('BEGIN IMMEDIATE');try{const previous=sql.prepare('SELECT hash FROM local_migrations WHERE name=?').get(name);if(previous&&previous.hash!==hash)throw new Error(`Applied migration changed: ${name}`);if(!previous){sql.exec(source);sql.prepare('INSERT INTO local_migrations VALUES (?,?)').run(name,hash);}sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');sql.close();throw e;}
 }
 sql.exec(`CREATE TABLE IF NOT EXISTS local_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS local_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS local_session_user ON local_sessions(user_id);
 CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
 const db={sql,prepare(query){return{bind(...args){return{query,args,async first(){return sql.prepare(query).get(...args)??null;},async all(){return{results:sql.prepare(query).all(...args)};}};}};},async batch(statements){
  sql.exec('SAVEPOINT club_batch');try{const result=statements.map(s=>({meta:{changes:Number(sql.prepare(s.query).run(...s.args).changes)}}));sql.exec('RELEASE club_batch');return result;}catch(e){sql.exec('ROLLBACK TO club_batch; RELEASE club_batch');throw e;}
 }};return db;
}
