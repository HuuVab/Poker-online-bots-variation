// Independent combinatorial distribution oracle for all C(52,5) hands.
import assert from 'node:assert/strict';
import {rankFive} from '../../lib/poker.mjs';
const choose=(n,k)=>{let result=1;for(let i=1;i<=k;i++)result=result*(n-i+1)/i;return Math.round(result);};
const deck=[...'shdc'].flatMap(s=>[...'23456789TJQKA'].map(r=>r+s));
const counts=Array(9).fill(0),started=performance.now();
for(let a=0;a<48;a++)for(let b=a+1;b<49;b++)for(let c=b+1;c<50;c++)for(let d=c+1;d<51;d++)for(let e=d+1;e<52;e++)counts[rankFive([deck[a],deck[b],deck[c],deck[d],deck[e]])[0]]++;
const expected=[];expected[8]=4*10;expected[7]=13*12*4;expected[6]=13*choose(4,3)*12*choose(4,2);expected[5]=4*choose(13,5)-expected[8];expected[4]=10*4**5-expected[8];expected[3]=13*choose(4,3)*choose(12,2)*4**2;expected[2]=choose(13,2)*choose(4,2)**2*11*4;expected[1]=13*choose(4,2)*choose(12,3)*4**3;expected[0]=choose(52,5)-expected.slice(1).reduce((a,b)=>a+b,0);
assert.deepEqual(counts,expected);assert.equal(counts.reduce((a,b)=>a+b),2598960);
console.log(JSON.stringify({hands:2598960,categories:counts,seconds:Math.round((performance.now()-started)/100)/10,result:'passed'},null,2));
