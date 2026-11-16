"use client";
import {useLayoutEffect,useRef,useState,type RefObject} from 'react';

type MotionPlayer={id:string;seat:number;cards:string[];folded:boolean;total:number;bet:number;left:boolean;waiting:boolean};
type MotionRoom={code:string;hand:number;stage:string;dealer:number;buttonSeat?:number;handStartedAt?:number;serverNow?:number;board:string[];turnId:string|null;players:MotionPlayer[];results:{id:string;amount:number}[]};

// Animate committed game events once; ordinary polling never replays a deal or payout.
export function useTableMotion(sceneRef:RefObject<HTMLDivElement|null>,room:MotionRoom|null){
 const previous=useRef<MotionRoom|null>(null);
 const animations=useRef(new Set<Animation>());
 const particles=useRef(new Set<HTMLElement>());
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [dealing,setDealing]=useState(false);
 useLayoutEffect(()=>{
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const stop=()=>{if(preference.matches){animations.current.forEach(a=>a.cancel());particles.current.forEach(e=>e.remove());setDealing(false);}};
  preference.addEventListener('change',stop);
  return()=>{
  preference.removeEventListener('change',stop);
  animations.current.forEach(a=>a.cancel());particles.current.forEach(e=>e.remove());
  if(timer.current)clearTimeout(timer.current);
  };
 },[]);
 useLayoutEffect(()=>{
  const scene=sceneRef.current,old=previous.current;previous.current=room;
  if(!scene||!room){setDealing(false);return;}
  const sameTable=old?.code===room.code,prior=sameTable?old:null;
  const newHand=room.hand>0&&(!prior||prior.hand!==room.hand);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate=(element:HTMLElement|null,frames:Keyframe[],options:KeyframeAnimationOptions={})=>{
   if(!element||reduce)return;
   const a=element.animate(frames,{duration:520,easing:'cubic-bezier(.2,.75,.25,1)',...options});
   animations.current.add(a);a.finished.then(()=>{animations.current.delete(a);},()=>{animations.current.delete(a);});return a;
  };
  const center=(e:HTMLElement)=>{const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};};
  const seat=(id:string)=>Array.from(scene.querySelectorAll<HTMLElement>('.seat[data-player-id]')).find(e=>e.dataset.playerId===id)||null;
  const pot=scene.querySelector<HTMLElement>('.pot');if(!pot)return;
  const dealer=scene.querySelector<HTMLElement>('.dealer-button');
  const origin=center(dealer||pot),potPoint=center(pot);
  const flyChips=(from:HTMLElement,to:HTMLElement,payout=false)=>{
   if(reduce)return;
   const start=center(from),end=center(to),bounds=scene.getBoundingClientRect();
   for(let i=0;i<4;i++){
    const chip=document.createElement('i');chip.className=`motion-chip ${payout?'payout':''}`;chip.setAttribute('aria-hidden','true');chip.style.left=`${start.x-bounds.left+i*3}px`;chip.style.top=`${start.y-bounds.top-i*3}px`;scene.appendChild(chip);particles.current.add(chip);
    const a=animate(chip,[{opacity:0,transform:'translate(0,0) scale(.8)'},{offset:.12,opacity:1},{offset:.8,opacity:1},{opacity:0,transform:`translate(${end.x-start.x}px,${end.y-start.y}px) scale(1.05)`}],{duration:payout?720:580,delay:(payout?450:0)+i*65,easing:'cubic-bezier(.4,0,.2,1)',fill:'both'});
    a?.finished.then(()=>{chip.remove();particles.current.delete(chip);},()=>{chip.remove();particles.current.delete(chip);});
   }
  };
  const freshDeal=newHand&&room.stage==='preflop'&&room.handStartedAt!==undefined&&(room.serverNow??Date.now())-room.handStartedAt<1800;
  if(freshDeal){
   if(timer.current)clearTimeout(timer.current);
   setDealing(!reduce&&room.stage!=='showdown');
   const dealerSeat=room.buttonSeat??room.players[room.dealer]?.seat??-1;
   const order=room.players.filter(p=>p.cards.length&&!p.waiting&&!p.left).sort((a,b)=>((a.seat-dealerSeat+9)%9||9)-((b.seat-dealerSeat+9)%9||9));
   order.forEach((p,index)=>{
    const station=seat(p.id);station?.querySelectorAll<HTMLElement>('.seat-cards .playing-card').forEach((card,n)=>{
     const target=center(card),delay=(n*order.length+index)*75;
     animate(card,[{opacity:0,transform:`translate(${origin.x-target.x}px,${origin.y-target.y}px) rotate(-14deg) scale(.72)`},{offset:.12,opacity:1},{offset:.85,opacity:1,transform:'translate(0,-5px) rotate(2deg) scale(1.05)'},{opacity:1,transform:'translate(0,0) rotate(0) scale(1)'}],{duration:540,delay,fill:'backwards'});
    });
   });
   timer.current=setTimeout(()=>setDealing(false),540+Math.max(0,order.length*2-1)*75);
   const former=prior?.players[prior.dealer];const oldDealer=former?seat(former.id)?.querySelector<HTMLElement>('.seat-person'):null;
   if(dealer){const end=center(dealer),start=oldDealer?center(oldDealer):end;animate(dealer,[{transform:`translate(${start.x-end.x}px,${start.y-end.y}px) scale(.65) rotate(-90deg)`,opacity:.5},{offset:.8,transform:'translate(0,0) scale(1.2) rotate(8deg)',opacity:1},{transform:'translate(0,0) scale(1) rotate(0)',opacity:1}],{duration:650,fill:'backwards'});}
  }
  const oldBoard=prior?(newHand?0:prior.board.length):room.board.length;
  if(room.board.length>oldBoard){
   scene.querySelectorAll<HTMLElement>('.board .playing-card').forEach((card,index)=>{
    if(index<oldBoard||index>=room.board.length)return;
    animate(card,[{opacity:0,transform:'perspective(600px) translateY(-24px) rotateY(85deg) scale(.9)'},{offset:.5,opacity:1},{offset:.85,transform:'perspective(600px) translateY(-4px) rotateY(-5deg) scale(1.04)'},{opacity:1,transform:'perspective(600px) translateY(0) rotateY(0) scale(1)'}],{duration:550,delay:(index-oldBoard)*120,fill:'backwards'});
   });
  }
  if(prior&&!newHand){
   for(const p of room.players){
    const before=prior.players.find(q=>q.id===p.id),station=seat(p.id);if(!before||!station)continue;
    if(p.folded&&!before.folded){const cards=station.querySelector<HTMLElement>('.seat-cards');if(cards){const start=center(cards);animate(cards,[{opacity:1,transform:'translate(0,0) rotate(0)'},{opacity:0,transform:`translate(${(potPoint.x-start.x)*.75}px,${(potPoint.y-start.y)*.75}px) rotate(14deg) scale(.65)`}],{duration:460,easing:'ease-in'});}}
    if(p.total>before.total)flyChips(station.querySelector<HTMLElement>('.wager-motion-source')||station.querySelector<HTMLElement>('.seat-bet')||station,pot);
    if(room.stage==='showdown'&&prior.stage!=='showdown'&&!p.folded&&before.cards.includes('??')&&!p.cards.includes('??'))station.querySelectorAll<HTMLElement>('.playing-card').forEach((card,index)=>animate(card,[{transform:'perspective(500px) rotateY(88deg)',opacity:.3},{transform:'perspective(500px) rotateY(0)',opacity:1}],{duration:450,delay:index*100}));
   }
  }
  if(room.stage==='showdown'&&(!prior||prior.stage!=='showdown'||newHand)){
   setDealing(false);
   for(const result of room.results){const station=seat(result.id);if(station){flyChips(pot,station.querySelector<HTMLElement>('.seat-person')||station,true);animate(station.querySelector<HTMLElement>('.seat-person'),[{boxShadow:'0 0 0 0 #d4bc7844'},{offset:.45,boxShadow:'0 0 0 7px #d4bc7855'},{boxShadow:'0 0 0 2px #d4bc78aa'}],{duration:900});}}
  }
  if(room.turnId&&room.turnId!==prior?.turnId)animate(seat(room.turnId)?.querySelector<HTMLElement>('.seat-person')||null,[{filter:'brightness(1)'},{offset:.45,filter:'brightness(1.45)'},{filter:'brightness(1)'}],{duration:650});
 },[room,sceneRef]);
 return {dealing};
}
