import {TOTP,Secret} from 'otpauth';
import {randomBytes,createHash} from 'node:crypto';
import {seal,unseal} from './security.mjs';
const digest=code=>createHash('sha256').update(code).digest('hex');
const instance=(secret,email)=>new TOTP({issuer:'Riverroom',label:email,algorithm:'SHA1',digits:6,period:30,secret});
export const mfaEnabled=(db,id)=>!!db.sql.prepare('SELECT user_id FROM local_mfa WHERE user_id=?').get(id);
export function beginMfa(db,user,key,now){
 if(mfaEnabled(db,user.id))throw Object.assign(new Error('MFA is already enabled. Use an existing authenticator or recovery code.'),{status:409});
 const secret=new Secret({size:20}),otp=instance(secret,user.email);
 db.sql.prepare('INSERT INTO local_mfa_pending VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at').run(user.id,seal(secret.base32,key),now+10*60*1000);
 return{secret:secret.base32,uri:otp.toString(),expiresAt:now+10*60*1000};
}
export function confirmMfa(db,user,key,code,now){
 const pending=db.sql.prepare('SELECT * FROM local_mfa_pending WHERE user_id=? AND expires_at>?').get(user.id,now);if(!pending||typeof code!=='string')return null;
 const otp=instance(unseal(pending.secret,key),user.email),delta=otp.validate({token:code,window:1,timestamp:now});if(delta===null)return null;
 const recovery=Array.from({length:10},()=>randomBytes(10).toString('hex'));
 db.sql.prepare('INSERT INTO local_mfa VALUES (?,?,?,?)').run(user.id,pending.secret,Math.floor(now/30000)+delta,JSON.stringify(recovery.map(digest)));db.sql.prepare('DELETE FROM local_mfa_pending WHERE user_id=?').run(user.id);return recovery;
}
export function consumeMfa(db,user,key,{code,recoveryCode},now){
 const row=db.sql.prepare('SELECT * FROM local_mfa WHERE user_id=?').get(user.id);if(!row)return false;
 if(typeof recoveryCode==='string'&&/^[a-f0-9]{20}$/i.test(recoveryCode.trim())){
  const hash=digest(recoveryCode.trim().toLowerCase()),codes=JSON.parse(row.recovery);if(!codes.includes(hash))return false;
  db.sql.prepare('UPDATE local_mfa SET recovery=? WHERE user_id=?').run(JSON.stringify(codes.filter(c=>c!==hash)),user.id);return true;
 }
 if(typeof code!=='string'||!/^\d{6}$/.test(code))return false;
 const otp=instance(unseal(row.secret,key),user.email),delta=otp.validate({token:code,window:1,timestamp:now,afterCounter:row.last_counter});if(delta===null)return false;
 const counter=Math.floor(now/30000)+delta;return db.sql.prepare('UPDATE local_mfa SET last_counter=? WHERE user_id=? AND last_counter<?').run(counter,user.id,counter).changes===1;
}
