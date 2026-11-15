import { useId } from "react";
import "./poker-card.css";

type Suit = "s" | "h" | "d" | "c";
const SUIT_NAMES = {s:"spades",h:"hearts",d:"diamonds",c:"clubs"};
const RANK_NAMES: Record<string,string> = {A:"Ace",K:"King",Q:"Queen",J:"Jack",T:"10"};
const PIPS: Record<string, [number,number][]> = {
  "2":[[50,38],[50,102]],
  "3":[[50,36],[50,70],[50,104]],
  "4":[[33,38],[67,38],[33,102],[67,102]],
  "5":[[33,38],[67,38],[50,70],[33,102],[67,102]],
  "6":[[33,36],[67,36],[33,70],[67,70],[33,104],[67,104]],
  "7":[[33,36],[67,36],[50,52],[33,70],[67,70],[33,104],[67,104]],
  "8":[[33,36],[67,36],[50,52],[33,70],[67,70],[50,88],[33,104],[67,104]],
  "9":[[33,34],[67,34],[33,58],[67,58],[50,70],[33,82],[67,82],[33,106],[67,106]],
  T:[[33,34],[67,34],[50,46],[33,58],[67,58],[33,82],[67,82],[50,94],[33,106],[67,106]],
};

function SuitMark({suit,x=0,y=0,size=16,flip=false}:{suit:Suit;x?:number;y?:number;size?:number;flip?:boolean}) {
  return <g transform={`translate(${x} ${y}) rotate(${flip?180:0}) scale(${size/24})`} fill="currentColor">
    {suit === "s" && <path d="M0-12C-3-7-11-3-11 3c0 7 8 9 11 3 3 6 11 4 11-3C11-3 3-7 0-12ZM-1 5c0 5-2 8-5 10H6C3 13 1 10 1 5Z"/>}
    {suit === "h" && <path d="M0 12C-4 7-11 2-11-4c0-8 9-10 11-3 2-7 11-5 11 3 0 6-7 11-11 16Z"/>}
    {suit === "d" && <path d="M0-13 9 0 0 13-9 0Z"/>}
    {suit === "c" && <path d="M-1 5c0 5-2 8-5 10H6C3 13 1 10 1 5Z"/>}
    {suit === "c" && <><circle cy="-6" r="6.5"/><circle cx="-6.5" cy="3" r="6.5"/><circle cx="6.5" cy="3" r="6.5"/></>}
  </g>;
}

function Court({rank,suit}:{rank:string;suit:Suit}) {
  const half = <>
    <path d="M28 70V56l14-8h15l15 13v9" fill="currentColor"/>
    <path className="court-finework" d="m36 54 10 16h11l-7-19M60 54l8 16" stroke="#c2ae79" strokeWidth="3" fill="none"/>
    <path d="m45 39 1 10 11 4 6-7-2-17-9-3-9 5Z" fill="#efe9d7" stroke="currentColor" strokeWidth="1.4"/>
    {rank === "Q" ? <path d="M42 48q-8-9-3-19 3-11 17-9 11 2 9 13l-6-4-8 6-1 14-8 3Z" fill="currentColor"/> : <path d="M43 36q-6-12 8-13 14-1 13 12l-5-4-7 3-3 10-6-3Z" fill="currentColor"/>}
    <path d="m59 35 4 7-5 1M55 46h4" stroke="currentColor" strokeWidth="1.1" fill="none"/>
    <circle cx="57.5" cy="36" r="1" fill="currentColor"/>
    {rank === "K" && <path d="m49 42 4 4 7-2-3 9-6 3-5-8Z" fill="currentColor"/>}
    {rank === "Q" && <><circle cx="49" cy="42" r="1.6" fill="#c2ae79"/><path d="m48 49 6 5-8 5-5-6Z" fill="#c2ae79"/></>}
    {rank === "J" && <path d="M60 18q0-10 9-10-2 9-9 10Z" fill="#efe9d7" stroke="currentColor" strokeWidth=".8"/>}
    {rank === "K" ? <path d="m39 24-2-10 9 6 5-9 5 9 10-6-3 10Z" fill="#c2ae79" stroke="currentColor" strokeWidth="1"/>
      : rank === "Q" ? <><path d="m40 24 1-8 5 4 5-8 5 8 7-4-2 8Z" fill="#c2ae79" stroke="currentColor" strokeWidth="1"/><circle cx="51" cy="12" r="2" fill="currentColor"/></>
      : <path d="M39 24q3-15 19-9l8 7-12 3Z" fill="#c2ae79" stroke="currentColor" strokeWidth="1"/>}
    <g className="court-finework"><path d="m30 56 3-24 2 24M68 55l2-23" stroke="currentColor" strokeWidth="1.5"/>
    <SuitMark suit={suit} x={32} y={28} size={8}/>
    <path d="m44 62 4 4-4 4-4-4Z" fill="#efe9d7"/></g>
  </>;
  return <g className="deck-court"><rect x="26" y="12" width="48" height="116" rx="1" fill="#e8dfc6" stroke="currentColor" strokeWidth=".8"/>{half}<g transform="rotate(180 50 70)">{half}</g><path d="m27 68 46 4M27 72l46-4" stroke="#c2ae79" strokeWidth="1"/></g>;
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
        <g className="deck-index"><text x="8" y={small?29:24} className="index-rank">{rank === "T"?"10":rank}</text><SuitMark suit={suit} x={15} y={35} size={12}/></g>
        <g className="deck-index" transform="rotate(180 50 70)"><text x="8" y={small?29:24} className="index-rank">{rank === "T"?"10":rank}</text><SuitMark suit={suit} x={15} y={35} size={12}/></g>
        {rank === "A" ? <g className="deck-pips"><SuitMark suit={suit} x={50} y={70} size={36}/>{suit === "s" && <path d="M34 96h32M40 99h20" stroke="currentColor" strokeWidth=".7"/>}</g>
          : "KQJ".includes(rank) ? <Court rank={rank} suit={suit}/>
          : <g className="deck-pips">{PIPS[rank]?.map(([x,y],i)=><SuitMark key={i} suit={suit} x={x} y={y} size={14} flip={y>70}/>)}</g>}
        <g className="deck-compact-suit"><SuitMark suit={suit} x={50} y={76} size={32}/></g>
      </>}
    </svg>
  </div>;
}
