import {createRemoteJWKSet,jwtVerify} from 'jose';
import {isIP} from 'node:net';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export function deploymentConfig(env=process.env){
 const mode=env.RIVERROOM_MODE||'local';if(!['local','public'].includes(mode))throw new Error('RIVERROOM_MODE must be local or public.');
 if(mode==='local')return{mode};
 let origin,team;try{origin=new URL(env.RIVERROOM_PUBLIC_ORIGIN);team=new URL(env.RIVERROOM_ACCESS_TEAM);}catch{throw new Error('Public mode requires PUBLIC_ORIGIN and ACCESS_TEAM HTTPS URLs.');}
 if(origin.protocol!=='https:'||origin.origin!==env.RIVERROOM_PUBLIC_ORIGIN||isIP(origin.hostname.replace(/^\[|\]$/g,''))||!origin.hostname.includes('.')||origin.hostname.endsWith('.localhost'))throw new Error('PUBLIC_ORIGIN must be an exact HTTPS domain origin with no trailing slash.');
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team.origin)||team.origin!==env.RIVERROOM_ACCESS_TEAM)throw new Error('ACCESS_TEAM must be an exact Cloudflare Access team origin.');
 if(!/^[a-f0-9]{64}$/.test(env.RIVERROOM_ACCESS_AUD||''))throw new Error('Public mode requires the Access application AUD tag.');
 return{mode,origin:origin.origin,team:team.origin,audience:env.RIVERROOM_ACCESS_AUD};
}
export function gateway(config,{keySet}={}){
 if(config.mode!=='public')return null;
 const keys=keySet||createRemoteJWKSet(new URL(config.team+'/cdn-cgi/access/certs'),{timeoutDuration:2000,cooldownDuration:30000,cacheMaxAge:600000});
 return async(request,now)=>{
  const deny=()=>{throw Object.assign(new Error('Verified private-club access is required.'),{status:403});};
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress))deny();
  if(request.headers.host!==new URL(config.origin).host||request.headers['x-forwarded-proto']!=='https')deny();
  const token=request.headers['cf-access-jwt-assertion'];if(typeof token!=='string'||token.length>16384)deny();
  let payload;try{({payload}=await jwtVerify(token,keys,{issuer:config.team,audience:config.audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email'],currentDate:new Date(now),clockTolerance:5,maxTokenAge:'24h'}));}catch{deny();}
  if(typeof payload.email!=='string'||payload.email.length>254||!/^\S+@\S+\.\S+$/.test(payload.email)||typeof payload.sub!=='string'||!payload.sub||payload.type!=='app')deny();
  const ip=request.headers['cf-connecting-ip'];if(typeof ip!=='string'||!isIP(ip))deny();
  return{email:payload.email.toLowerCase(),ip,binding:createHash('sha256').update(config.team+'\0'+payload.sub+'\0'+payload.email.toLowerCase()).digest('hex')};
 };
}
export function loadSecurityKey(filename){
 mkdirSync(dirname(filename),{recursive:true});try{writeFileSync(filename,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 const key=readFileSync(filename);if(key.length!==32)throw new Error('Invalid security key. Restore the original 32-byte key file.');return key;
}
export function seal(value,key,purpose='mfa'){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('riverroom:'+purpose));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
export function unseal(value,key,purpose='mfa'){
 const data=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAAD(Buffer.from('riverroom:'+purpose));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
}
