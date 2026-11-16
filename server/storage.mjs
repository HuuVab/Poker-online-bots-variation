import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function privateStorage(directory){
 if(process.platform!=='win32')return false;
 // Do not inherit a PowerShell 7 module path into Windows PowerShell 5.
 // Keep the normal execution policy; load only the shell's standard modules.
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>name.toLowerCase()!=='psmodulepath'));
 const powershell=resolve(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const result=spawnSync(powershell,['-NoProfile','-File',fileURLToPath(new URL('./check-storage.ps1',import.meta.url)),'-DataDirectory',directory],{encoding:'utf8',windowsHide:true,env});
 try{return result.status===0&&JSON.parse(result.stdout.replace(/^\uFEFF/,'')).private===true;}catch{return false;}
}
