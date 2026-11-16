export const DEFAULT_SETTINGS={regularStack:2000,smallBlind:10,bigBlind:20,turnSeconds:45,tournamentPoints:1000};
export const gameSettings=c=>({...DEFAULT_SETTINGS,...c.gameSettings});
export function validateSettings(value,need){
 need(value&&typeof value==='object'&&!Array.isArray(value),'Choose game settings.');
 need(Object.keys(value).every(k=>Object.hasOwn(DEFAULT_SETTINGS,k)),'Unknown game setting.');
 const result={...DEFAULT_SETTINGS,...value};
 const limits={regularStack:[100,1000000],smallBlind:[1,50000],bigBlind:[2,100000],turnSeconds:[10,120],tournamentPoints:[1,1000000]};
 for(const [key,[min,max]] of Object.entries(limits))need(Number.isSafeInteger(result[key])&&result[key]>=min&&result[key]<=max,`${key} must be a whole number between ${min} and ${max}.`);
 need(result.bigBlind>=result.smallBlind*2,'Big blind must be at least twice the small blind.');need(result.regularStack>=result.bigBlind*10,'Starting stack must contain at least 10 big blinds.');return result;
}
