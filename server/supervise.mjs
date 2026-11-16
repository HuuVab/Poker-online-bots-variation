import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('./start.mjs',import.meta.url));let stopping=false,child,timer,healthTimer;const crashes=[];
function start(){
 child=spawn(process.execPath,[entry],{stdio:'inherit',windowsHide:true});const started=Date.now();const processChild=child;let failures=0,checking=false,restartRequested=false;
 healthTimer=setInterval(async()=>{if(stopping||checking||Date.now()-started<30000)return;checking=true;try{const response=await fetch(`http://127.0.0.1:${process.env.PORT||3000}/healthz`,{signal:AbortSignal.timeout(3000)});if(response.ok)failures=0;else failures++;}catch{failures++;}finally{checking=false;}if(failures>=3&&child===processChild){restartRequested=true;console.error(JSON.stringify({event:'server_unhealthy_restart'}));clearInterval(healthTimer);processChild.kill('SIGTERM');}},10000);
 child.on('error',e=>{clearInterval(healthTimer);console.error('Server could not launch:',e.code);process.exitCode=1;});
 child.on('exit',(code,signal)=>{clearInterval(healthTimer);if(stopping)return;if(code===0&&!signal&&!restartRequested)return;const now=Date.now();while(crashes.length&&now-crashes[0]>10*60*1000)crashes.shift();crashes.push(now);if(crashes.length>=5){console.error('Server stopped after repeated failures. Inspect logs before restarting.');process.exitCode=1;return;}const delay=now-started>60000?1000:Math.min(30000,1000*2**crashes.length);console.error(JSON.stringify({event:'server_restart',exitCode:code,retryMs:delay}));timer=setTimeout(start,delay);});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(timer);clearInterval(healthTimer);child?.kill(signal);});start();
