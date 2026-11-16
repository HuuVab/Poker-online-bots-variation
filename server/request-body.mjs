// Read untrusted network input before entering the serialized database queue.
export function readJsonBody(request,{timeoutMs=3000,maxBytes=8192}={}){
 const error=(message,status)=>Object.assign(new Error(message),{status,closeConnection:true});
 if(request.headers['content-type']?.split(';')[0]!=='application/json')return Promise.reject(error('Send JSON.',415));
 const length=request.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes))return Promise.reject(error('Request too large.',413));
 return new Promise((resolve,reject)=>{
  let size=0,chunks=[];
  const cleanup=()=>{clearTimeout(timer);request.off('data',data);request.off('end',end);request.off('aborted',aborted);request.off('error',aborted);};
  const stop=e=>{cleanup();request.once('error',()=>{});request.pause();chunks=[];reject(e);};
  const data=chunk=>{size+=chunk.length;if(size>maxBytes)stop(error('Request too large.',413));else chunks.push(chunk);};
  const end=()=>{cleanup();let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reject(error('Invalid JSON.',400));return;}if(!value||typeof value!=='object'||Array.isArray(value)){reject(error('Invalid request.',400));return;}resolve(value);};
  const aborted=()=>stop(error('Incomplete request.',400));
  const timer=setTimeout(()=>stop(error('Request body timed out.',408)),timeoutMs);timer.unref();
  request.on('data',data);request.once('end',end);request.once('aborted',aborted);request.once('error',aborted);
 });
}
