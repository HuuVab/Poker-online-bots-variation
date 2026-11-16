import {scrypt,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const SESSION_MS=6*60*60*1000;
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export function validPassword(password){return typeof password==='string'&&password.length>=12&&password.length<=256;}
export async function hashPassword(password){
 if(!validPassword(password))throw new Error('Use a password with 12–256 characters.');
 const salt=randomBytes(16).toString('hex'),key=await derive(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password,stored){
 if(!validPassword(password)||typeof stored!=='string')return false;
 const [salt,hex]=stored.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(hex||''))return false;
 const key=await derive(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(key,Buffer.from(hex,'hex'));
}
export function sessionCookie(token='',maxAge=SESSION_MS/1000,{secure=false}={}){return `${secure?'__Host-river_session':'river_session'}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;}
export function createSession(db,userId,now=Date.now(),{binding='',mfa=false,elevated=false}={}){
 const token=randomBytes(32).toString('hex');db.sql.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(now);
 db.sql.prepare('INSERT INTO local_sessions VALUES (?,?,?,?)').run(tokenHash(token),userId,now+SESSION_MS,now);
 db.sql.prepare('INSERT INTO local_session_security VALUES (?,?,?,?,?)').run(tokenHash(token),binding,mfa?1:0,elevated?now+10*60*1000:0,now);
 db.sql.prepare('DELETE FROM local_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM local_sessions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 5)').run(userId,userId);
 return token;
}
export function sessionUser(db,cookies='',now=Date.now(),{secure=false,binding='',idleMs=Infinity}={}){
 const name=secure?'__Host-river_session=':'river_session=',matches=cookies.split(';').map(c=>c.trim()).filter(c=>c.startsWith(name));if(matches.length!==1)return null;
 const token=matches[0].slice(name.length);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const user=db.sql.prepare('SELECT u.id,u.email,u.name,coalesce(x.binding,\'\') binding,coalesce(x.mfa,0) mfa,coalesce(x.elevated_until,0) elevatedUntil,coalesce(x.last_seen,s.created_at) lastSeen FROM local_sessions s JOIN local_users u ON u.id=s.user_id LEFT JOIN local_session_security x ON x.token_hash=s.token_hash WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(token),now);
 if(user&&(user.binding!==binding||now-user.lastSeen>idleMs))return null;
 if(user&&now-user.lastSeen>=60000)db.sql.prepare('UPDATE local_session_security SET last_seen=? WHERE token_hash=?').run(now,tokenHash(token));
 return user?{...user,tokenHash:tokenHash(token)}:null;
}
