import { useId } from "react";
import "./poker-card.css";

type Suit = "s" | "h" | "d" | "c";
const SUIT_NAMES = {s:"spades",h:"hearts",d:"diamonds",c:"clubs"};
const RANK_NAMES: Record<string,string> = {A:"Ace",K:"King",Q:"Queen",J:"Jack",T:"10"};
function SuitMark({suit,x=0,y=0,size=16,flip=false}:{suit:Suit;x?:number;y?:number;size?:number;flip?:boolean}) {
  return <g transform={`translate(${x} ${y}) rotate(${flip?180:0}) scale(${size/24})`} fill="currentColor">
    {suit === "s" && <path d="M0-12C-3-7-11-3-11 3c0 7 8 9 11 3 3 6 11 4 11-3C11-3 3-7 0-12ZM-1 5c0 5-2 8-5 10H6C3 13 1 10 1 5Z"/>}
    {suit === "h" && <path d="M0 12C-4 7-11 2-11-4c0-8 9-10 11-3 2-7 11-5 11 3 0 6-7 11-11 16Z"/>}
    {suit === "d" && <path d="M0-13 9 0 0 13-9 0Z"/>}
    {suit === "c" && <path d="M-1 5c0 5-2 8-5 10H6C3 13 1 10 1 5Z"/>}
    {suit === "c" && <><circle cy="-6" r="6.5"/><circle cx="-6.5" cy="3" r="6.5"/><circle cx="6.5" cy="3" r="6.5"/></>}
  </g>;
}

export function PokerCard({value,small=false}:{value?:string;small?:boolean}) {
  const patternId = `deck-${useId().replace(/:/g,"")}`;
  if (!value) return <div className={`playing-card empty ${small?"small":""}`} aria-hidden="true"/>;
  const back = value === "??";
  const rank = value[0];
  const suit = value[1] as Suit;
  const red = !back && (suit === "h" || suit === "d");
  const label = back ? "Face-down card" : `${RANK_NAMES[rank]||rank} of ${SUIT_NAMES[suit]}`;
  return <div className={`playing-card professional-card ${back?"card-back":"card-face"} ${red?"red":""} ${small?"small":""}`} role="img" aria-label={label}>
    <svg viewBox="0 0 100 140" className="deck-art" aria-hidden="true">
      {back ? <>
        <defs><pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse"><path d="m0 4 4-4 4 4-4 4Z" fill="none" stroke="#e2d5b1" strokeWidth=".7" opacity=".7"/></pattern></defs>
        <rect x="1" y="1" width="98" height="138" rx="5" fill="#f1eddf"/>
        <rect x="6" y="6" width="88" height="128" rx="2" fill="#24483f"/>
        <rect x="10" y="10" width="80" height="120" fill={`url(#${patternId})`} stroke="#b9ad85" strokeWidth=".8"/>
        <path d="m50 28 26 42-26 42-26-42Z" fill="#24483f" stroke="#d2c5a0" strokeWidth="1"/>
        <path d="m50 36 20 34-20 34-20-34Z" fill="none" stroke="#b9ad85" strokeWidth=".65"/>
        <g stroke="#d7cba8" fill="none" strokeWidth="1.3"><path d="M37 65c9-9 17 9 26 0M37 71c9-9 17 9 26 0M37 77c9-9 17 9 26 0"/></g>
        <path d="m50 46 4 7h-8ZM50 94l4-7h-8Z" fill="#d7cba8"/>
      </> : <>
        <rect x=".6" y=".6" width="98.8" height="138.8" rx="5" fill="#f6f3e9" stroke="#ded7c6" strokeWidth="1.2"/>
        <text x="50" y="62" textAnchor="middle" className={`face-rank ${rank === "T" ? "face-rank-ten" : ""}`}>{rank === "T" ? "10" : rank}</text>
        <SuitMark suit={suit} x={50} y={101} size={42}/>
      </>}
    </svg>
  </div>;
}
