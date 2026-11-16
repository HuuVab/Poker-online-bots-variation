"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TournamentHUD, TournamentBetweenHands } from "../components/tournament-table";
import { TournamentRules, type Tournament } from "../components/tournament-lobby";
import { useTableMotion } from "../components/use-table-motion";
import { ClubHub } from "../components/club-hub";
import { PokerCard as Card } from "../components/poker-card";
import { ArrowRight, Check, CircleHelp, Copy, DoorOpen, Link2, LoaderCircle, Menu, MessageSquare, RefreshCw, ShieldCheck, Volume2, VolumeX, X } from "lucide-react";

type Player = { id: string; name: string; chips: number; seat: number; departing?: boolean; bet: number; total: number; cards: string[]; folded: boolean; waiting: boolean; left: boolean; bot: boolean; lastAction: string; emote?: string; emoteUntil?: number };
type Room = { tournament?: Tournament; handLevel?: number; canUseTimeCard?: boolean; maxSeats?: number; serverNow?: number; turnMs?: number; turnSerial?: number; smallBlind?: number; bigBlind?: number; ante?: number; antePot?: number; buttonSeat?: number; smallBlindId?: string | null; bigBlindId?: string | null; canManage: boolean; paused: boolean; closed: boolean; closing: boolean; locked: boolean; tickets: {regular:number;tournament:number}; points:{regular:number;tournament:number}; minBuyIn: number; maxBuyIn: number; code: string; version: number; you: string | null; hostId: string | null; practice: boolean; stage: string; hand: number; dealer: number; players: Player[]; board: string[]; currentBet: number; deadline: number | null; turnId: string | null; settledPot: number; results: {id: string; amount: number; hand: string}[]; log: {id: string; message: string; at: number}[]; legal: null | {call: number; check: boolean; min: number; max: number; canRaise: boolean; allIn: boolean} };
type Session = { code: string };
const chips = (n: number) => n.toLocaleString("en-US");
const stageNames: Record<string, string> = { waiting: "Waiting for players", preflop: "Pre-flop", flop: "The flop", turn: "The turn", river: "The river", showdown: "Hand complete" };

const EMOTES: Record<string, string> = {"👋": "Hello, table.", "😎": "Nice hand.", "👏": "Well played.", "🍀": "Good luck."};
function RiverMark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3 36 20 20 37 4 20Z" stroke="currentColor"/><path d="M10 19c7-8 13 8 20 0M10 23c7-8 13 8 20 0" stroke="currentColor" strokeWidth="1.5"/><path d="m20 8 4 5h-8Z" fill="currentColor"/></svg>;
}

function PlayerStation({ player, index, isYou, active, seconds, showBet=false }: { player: Player; index: number; isYou: boolean; active: boolean; seconds: number; showBet?: boolean }) {
  return <div className="seat-person"><div className={`seat-avatar color-${index}`}><svg viewBox="0 0 80 80" className="illustrated-avatar" aria-hidden="true"><path d="M5 80Q8 49 40 49T75 80" fill={['#b69b6d','#718980','#a87964','#8b9071','#8c7c71','#ad946c'][index % 6]}/><ellipse cx="40" cy="32" rx="20" ry="24" fill="#e7b58e"/><path d="M19 28Q10 3 39 5Q69 2 62 32L54 20Q36 31 25 19Z" fill={index%2 ? '#442f2b' : '#303c3b'}/><circle cx="33" cy="33" r="2" fill="#302c29"/><circle cx="48" cy="33" r="2" fill="#302c29"/><path d="M34 44Q40 49 47 43" stroke="#985a49" strokeWidth="2" fill="none"/></svg></div><div className="seat-info"><strong>{player.name}{isYou && <small>you</small>}</strong><span className="station-balance">{chips(player.chips)}</span>{showBet && <span className="station-wager wager-motion-source" title={player.bet ? `Current bet: ${chips(player.bet)}` : "No current bet"}>{player.bet ? `Bet ${chips(player.bet)}` : "\u00a0"}</span>}</div>{active && <span className="turn-timer" aria-label={`${seconds} seconds remaining`}>{seconds}</span>}</div>;
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const presenceRoom = useRef<string | null>(null);
  const [seated, setSeated] = useState<(Player | undefined)[]>(Array(6).fill(undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Ready to play");
  const [toast, setToast] = useState("");
  const [rules, setRules] = useState(false);
  const [sound, setSound] = useState(false);
  const [raise, setRaise] = useState(40);
  const [now, setNow] = useState(Date.now());
  const [mobileMenu, setMobileMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [emote, setEmote] = useState("");
  const [emoteOpen, setEmoteOpen] = useState(false);
  const emoteMenuRef = useRef<HTMLDivElement>(null);
  const previousRoom = useRef<Room | null>(null);
  const receivedAt = useRef(Date.now());
  const versionRef = useRef(-1);
  const generationRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const accept = useCallback((next: Room) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version; receivedAt.current=Date.now(); setRoom(next);
    setSession(current=>current&&current.code!==next.code?{code:next.code}:current);
  }, []);
  const request = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/table", { method: "POST", headers: { "Content-Type": "application/json"}, body: JSON.stringify({requestId: crypto.randomUUID(), ...payload}), signal: AbortSignal.timeout(12000) });
    const data = await response.json() as { room?: Room; error?: string };
    return { response, data };
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("river-seat");
      if (saved) {const parsed=JSON.parse(saved);if(parsed.code&&!parsed.token)setSession({code:parsed.code});}
      const invite = new URLSearchParams(window.location.search).get("room");
      if (invite && /^[A-Z2-9]{6}$/.test(invite.toUpperCase())) setSession({code:invite.toUpperCase()});
    } catch { /* A live session also works when browser storage is disabled. */ }
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const generation = generationRef.current;
    async function poll() {
      try {
        const {response, data} = await request({ action: "state", code: session!.code });
        if (cancelled || generation !== generationRef.current) return;
        if (response.ok && data.room) { accept(data.room); setConnection("Table is live"); }
        else if ([401, 403, 404].includes(response.status)) {
          setError(data.error || "Your seat has expired."); setSession(null); setRoom(null);
          try { sessionStorage.removeItem("river-seat"); } catch {} return;
        } else setConnection("Reconnecting…");
      } catch { if (!cancelled) setConnection("Reconnecting…"); }
      if (!cancelled) timer = setTimeout(poll, 1200);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, request, accept]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 3000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [room?.log.length, room?.log.at(-1)?.id]);
  useEffect(() => { if (room?.legal) setRaise(Math.min(room.legal.max, room.legal.min)); }, [room?.currentBet, room?.turnId, room?.legal?.min, room?.legal?.max]);
  useEffect(() => {
    if (sound && room?.turnId === room?.you && room?.turnId) {
      const ctx = audioRef.current;
      if (ctx) { const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.connect(gain); gain.connect(ctx.destination); oscillator.frequency.value = 660; gain.gain.setValueAtTime(0.07, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); oscillator.start(); oscillator.stop(ctx.currentTime + 0.3); }
    }
  }, [room?.turnId, room?.you, sound]);

  function returnToClub() {
    generationRef.current++; versionRef.current=-1; setRoom(null);setSession(null);setConnection("Club is open");if(room?.tournament){try{sessionStorage.setItem("river-club-section","tournaments");}catch{}}setMobileMenu(false);setLogOpen(false);setError("");
    try{sessionStorage.removeItem("river-seat");window.history.replaceState({}, "", "/");}catch{}
  }
  function openTable(code: string) {
    generationRef.current++;versionRef.current=-1;setRoom(null);const next={code};setSession(next);setError("");
    try{sessionStorage.setItem("river-seat",JSON.stringify(next));}catch{}
  }
  async function command(action: string, extra: Record<string, unknown> = {}) {
    if (busy || !room || !session) return;
    setBusy(true); setError("");
    const generation = generationRef.current;
    try {
      const { response, data } = await request({ action, code: session.code, version: room.version, hand: room.hand, turnSerial: room.turnSerial, ...extra });
      if (generation !== generationRef.current) return;
      if (data.room) accept(data.room);
      if (!response.ok) throw new Error(data.error);
      if (action === "leave") {
        generationRef.current++; versionRef.current = -1;
        setSession(null); setRoom(null); setConnection("Ready to play"); setMobileMenu(false); setLogOpen(false); setEmoteOpen(false);
        try { sessionStorage.removeItem("river-seat"); window.history.replaceState({}, "", "/"); } catch {}
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Connection interrupted. Try again."); }
    finally { setBusy(false); }
  }
  async function copyInvite() {
    if (!room) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/?room=${room.code}`); setToast("Table link copied. Only approved club members can join."); }
    catch { setToast(`Your room code is ${room.code}`); }
  }

  useEffect(() => {
    const previous = previousRoom.current;
    previousRoom.current = room;
    if (!sound || !room || !previous) return;
    const ctx = audioRef.current;
    if (!ctx) return;
    const dealt = room.hand !== previous.hand || room.board.length !== previous.board.length;
    const bet = room.players.some(p => p.total > (previous.players.find(q => q.id === p.id)?.total || 0));
    if (!dealt && !bet) return;
    const length = Math.floor(ctx.sampleRate * (dealt ? .25 : .16));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length / 5)) * .12;
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = dealt ? 1800 : 3200;
    source.connect(filter); filter.connect(ctx.destination); source.start();
  }, [room, sound]);
  useEffect(() => { if (!emote) return; const timer = setTimeout(() => setEmote(""), 2200); return () => clearTimeout(timer); }, [emote]);

  useEffect(() => {
    if (!emoteOpen) return;
    const closeOutside = (e: PointerEvent) => { if (!emoteMenuRef.current?.contains(e.target as Node)) setEmoteOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setEmoteOpen(false); emoteMenuRef.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", closeOutside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, [emoteOpen]);

  const me = room?.players.find(p => p.id === room.you);
  const capacity=room?.maxSeats||6;
  const nextSeats: (Player | undefined)[] = Array(capacity).fill(undefined);
  room?.players.filter(p => !p.left).forEach((p, index) => {nextSeats[p.seat ?? index] = p;});
  useLayoutEffect(() => {
    if (!room || presenceRoom.current !== room.code) {
      presenceRoom.current = room?.code || null; setSeated(nextSeats); return;
    }
    setSeated(previous => nextSeats.map((player,index) => player || (previous[index] ? {...previous[index],departing:true} : undefined)));
    const timer = setTimeout(() => setSeated(previous => previous.map(player => player?.departing ? undefined : player)), 180);
    return () => clearTimeout(timer);
  }, [room?.code, room?.players]);
  const blindSeats = room ? [...room.players.slice(room.dealer), ...room.players.slice(0, room.dealer)].filter(p => p.cards.length > 0) : [];
  const smallBlindId = room?.tournament ? room.smallBlindId : blindSeats[blindSeats.length === 2 ? 0 : 1]?.id;
  const bigBlindId = room?.tournament ? room.bigBlindId : blindSeats[blindSeats.length === 2 ? 1 : 2]?.id;
  const pot = room ? room.stage === "showdown" ? room.settledPot : room.players.reduce((n, p) => n + p.total, 0) + (room.antePot || 0) : 0;
  const host = room?.canManage;
  const betweenHands = !room || ["waiting", "showdown"].includes(room.stage);
  const winnerText = room?.results.map(r => `${room.players.find(p => p.id === r.id)?.name} +${chips(r.amount)}`).join(" · ");
  const elapsed=Math.max(0,now-receivedAt.current);
  const seconds = room?.deadline ? Math.max(0, Math.ceil((room.deadline - (room.serverNow ?? now) - (room.serverNow ? elapsed : 0)) / 1000)) : 0;

  const {dealing} = useTableMotion(sceneRef, room);

  return <div className={`app-shell room-environment ${room ? "playing" : "in-lobby"} ${room?.tournament ? "tournament-playing" : ""} ${logOpen ? "log-open" : ""}`} onClickCapture={event => { if (!sound || !(event.target as HTMLElement).closest("button")) return; const ctx = audioRef.current; if (!ctx) return; const o = ctx.createOscillator(); const g = ctx.createGain(); o.type="sine"; o.frequency.setValueAtTime(280,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(90,ctx.currentTime+.07); g.gain.setValueAtTime(.035,ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.08); o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.08); }}>
    <aside id="club-menu" aria-label="Game menu" className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
      <a className="brand" href="/" aria-label="Riverroom home"><RiverMark/><span>Riverroom</span></a>
      <button className="nav-item" onClick={() => { setRules(true); setMobileMenu(false); }}><CircleHelp size={18}/>Table rules</button>
      {room && <button className="nav-item" onClick={() => {setLogOpen(true);setMobileMenu(false);}}><MessageSquare size={18}/>Hand history</button>}
      {room && !room.practice && <button className="nav-item" onClick={copyInvite}><Link2 size={18}/>Copy invitation</button>}
      {room && <button className="nav-item" onClick={returnToClub}><DoorOpen size={18}/>Club & tickets</button>}
      {room && me && !room.tournament && <button className="nav-item" disabled={busy} onClick={() => command("leave")}><DoorOpen size={18}/>Leave table</button>}
    </aside>
    <div className="main-shell">
      <header className="topbar"><button className="floating-menu icon-btn" aria-label="Open game menu" aria-expanded={mobileMenu} aria-controls="club-menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22}/></button><a className="hud-brand" href="/" aria-label="Riverroom home"><RiverMark/><strong>Riverroom<span>POKER CLUB</span></strong></a><div className="hud-room">{room ? <><span className="room-identity">{room.practice ? "House table" : <button className="copy-room-code" onClick={async () => {try {await navigator.clipboard.writeText(room.code);setToast("Room code copied.");}catch{setToast(`Room code: ${room.code}`);}}} aria-label={`Copy room code ${room.code}`}><span>{room.code}</span><Copy size={12}/></button>}<span className="hud-divider">/</span>{room.hand ? `Hand ${room.hand}` : "Waiting"}</span></> : "PRIVATE TABLES"}<small>{room?.tournament ? `L${room.handLevel} · ${room.smallBlind} / ${room.bigBlind} / ${room.ante}` : room?.practice ? "PRACTICE · ISOLATED CHIPS" : "PRIVATE CLUB · 10 / 20"}</small></div><div className="topbar-right">{room && <button className="club-hub-link" onClick={returnToClub}>Club & tickets</button>}<span className="connection"><i className={connection === "Reconnecting…" ? "offline" : ""}/>{connection}</span><button className="icon-btn" aria-label={sound ? "Mute sounds" : "Enable sounds"} onClick={() => { if (!audioRef.current) audioRef.current = new AudioContext(); audioRef.current.resume(); setSound(!sound); }}>{sound ? <Volume2 size={21}/> : <VolumeX size={21}/>}</button><button className="icon-btn" aria-label="How to play" onClick={() => setRules(true)}><CircleHelp size={21}/></button>{room && <button className="icon-btn" aria-label="Toggle game log" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}><MessageSquare size={21}/></button>}</div></header>
      <main>
        {room?.tournament && <TournamentHUD tournament={room.tournament} elapsed={elapsed}/>}
        <div className="game-grid">
          <section className="table-panel" aria-label="Poker table">
            <div ref={sceneRef} className={`table-scene ${room ? "in-game" : ""} ${dealing ? "is-dealing" : ""} ${room?.tournament ? "nine-seat-table" : ""}`}>
              
              <div className="poker-table"><div className="felt-inner"/>
                <div className="community">{room?.stage === "showdown" && room.results.length > 0 ? <div className="hand-result" key={`${room.code}-${room.hand}`} role="status" aria-atomic="true"><span className="result-heading">{room.results.length === 1 ? `${room.players.find(p=>p.id===room.results[0].id)?.name || "Player"} wins` : `${room.results.length} players paid`}</span><span className="result-summary">{room.results.length === 1 ? `${room.results[0].hand} · +${chips(room.results[0].amount)}` : "Payouts recorded in hand history"}</span><span className="sr-only">{winnerText}</span></div> : <span className={`street-label ${dealing ? "dealing-label" : ""}`} role="status">{dealing ? `Dealing · ${room?.players[room.dealer]?.name || "dealer"}` : room ? stageNames[room.stage] : "Texas Hold’em"}</span>}<div className="board">{Array.from({length: 5}, (_, i) => <Card value={room?.board[i]} key={`${room?.hand}-${i}`}/>)}</div><div className="pot" key={`pot-${pot}`}><div className="physical-pot" aria-hidden="true">{Array.from({length: Math.min(5, Math.max(1, Math.ceil(pot/120)))}, (_, stack) => <span className={`chip-tower tower-${stack}`} key={stack}>{Array.from({length: Math.min(7, Math.max(2, Math.ceil(pot/30)))}, (_, chip) => <i key={chip} style={{bottom:chip*4}}/>)}</span>)}</div><span>{room?.stage === "showdown" ? "LAST POT" : "POT"}<strong>{chips(pot)}</strong></span></div></div>
              </div>
              {Array.from({length: capacity}, (_, i) => {
                const p = nextSeats[i] || seated[i]; const turn = p && !p.departing && room?.turnId === p.id;
                const dealer = p && (room?.tournament ? p.seat===room.buttonSeat : room?.players[room.dealer]?.id === p.id);
                const won = p && !p.departing && room?.results.some(r => r.id === p.id);
                return <div key={`seat-${i}`} data-player-id={p?.id} data-seat={i} className={`seat seat-${i} ${p ? "occupied" : "vacant"} ${p?.departing ? "departing" : ""} ${p?.folded ? "folded" : ""} ${turn ? "on-turn" : ""} ${won ? "winner" : ""}`}>
                  {p ? <>{((emote && p.id === room?.you) || (p.emote && (p.emoteUntil || 0) > now)) && <span className="emote-bubble">{EMOTES[(p.id === room?.you && emote ? emote : p.emote) || ""] || "Hello, table."}</span>}<div className="seat-cards" aria-hidden={p.folded || p.departing}>{p.cards.map((c, n) => <Card key={`${room?.hand}-${n}`} value={c} small/>)}</div><PlayerStation player={p} index={i} isYou={p.id === room?.you} active={!!turn} seconds={seconds} showBet={!!room?.tournament && room.stage!=="showdown"}/><div className="seat-markers">{dealer && <span key={`dealer-${room?.hand}`} className="dealer-button" role="img" title={`BTN — Dealer: ${p.name}`} aria-label={`BTN — Dealer: ${p.name}`}>BTN</span>}{(p.id === smallBlindId || p.id === bigBlindId) && <span className="blind-marker">{p.id === smallBlindId ? "SB" : "BB"}</span>}</div><span className={`seat-action ${won ? "won" : ""}`}>{won ? "WINNER" : p.waiting ? "Next hand" : (turn ? (p.id === room?.you ? "Your turn" : "Thinking…") : (["Small blind", "Big blind"].includes(p.lastAction) ? "" : p.lastAction))}</span>{p.bet > 0 && room?.stage !== "showdown" && <span className="seat-bet" key={`bet-${p.bet}`}><i className="bet-chip"/> {chips(p.bet)}</span>}</> : <><button className="empty-seat" disabled={!!room?.tournament || busy || (!!room && !betweenHands)} aria-label={room?.tournament ? `Unoccupied tournament seat ${i+1}` : `Sit in seat ${i+1}`} title={room && !betweenHands ? "Change seats between hands" : "Sit here"} onClick={() => {if(room && me) command("seat", {seat:i});else if(room) {returnToClub();}else {returnToClub();}}}><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><path d="M11 24V14q7-5 14 0v10M10 24h16M13 24v4m10-4v4"/></svg><span className="sit-label">{room?.tournament ? "Reserved seating" : "Sit here"}</span></button>{room?.tournament && room.buttonSeat===i && <span className="dealer-button dead-button" role="img" aria-label="BTN — unoccupied dealer position" title="Dead button">BTN</span>}</>}
                </div>;
              })}

            </div>

          </section>
          <aside className="right-panel">{room && <button className="log-close icon-btn" onClick={() => setLogOpen(false)} aria-label="Close game log"><X size={20}/></button>}
            {!room ? <ClubHub onOpen={openTable}/>
            : <><div className="room-info"><div className="room-info-title"><span className="panel-overline">{room.practice ? "PRACTICE TABLE" : "PRIVATE TABLE"}</span></div><h2>{room.practice ? "House table" : "Table ledger"}</h2><p>{room.practice ? "Three bots · play chips" : `Room ${room.code}`}</p>{!room.practice && <button className="invite-btn" onClick={copyInvite}><Link2 size={17}/>Invite friends<Copy size={15}/></button>}<div className="hand-meta"><span>Hand <strong>#{room.hand.toString().padStart(2, "0")}</strong></span><span>Blinds <strong>{room.smallBlind||10} / {room.bigBlind||20}{room.ante ? ` / ${room.ante} ante` : ""}</strong></span></div></div><div className="feed-card"><h3><MessageSquare size={16}/>Hand history<span>ACTIVITY</span></h3><div className="feed" ref={feedRef} role="log" aria-label="Table activity">{room.log.map((entry, i) => <div key={entry.id} className={`feed-entry ${i === room.log.length - 1 ? "latest" : ""}`}><i/><p>{entry.message}</p></div>)}</div></div><button className="leave-btn" onClick={returnToClub}><DoorOpen size={15}/>Club & tickets</button>{me && !room.closed && !room.tournament && <button className="leave-btn" disabled={busy} onClick={() => command("leave")}><DoorOpen size={15}/>Leave table</button>}{host && !room.practice && <div className="club-row-actions">{room.players.filter(p=>!p.left&&p.id!==room.you).map(p=><button key={p.id} disabled={busy} onClick={()=>command("kick",{playerId:p.id})}>Remove {p.name} after hand</button>)}</div>}</>}
          </aside>
        </div>

        {room && <section className="action-panel" aria-label="Game actions"><div className="emote-controls" ref={emoteMenuRef}><button className="emote-trigger" disabled={!me || busy || room.closed || !!room.tournament && (room.tournament.self?.state!=="playing" || !["running","closing_rebuys"].includes(room.tournament.state))} aria-label="Open emote menu" aria-expanded={emoteOpen} aria-controls="emote-options" onClick={() => setEmoteOpen(!emoteOpen)}><MessageSquare size={16}/><span>Emote</span></button>{emoteOpen && <div id="emote-options" className="emote-options" role="group" aria-label="Table reactions">{Object.entries(EMOTES).map(([emoji, label]) => <button key={emoji} disabled={busy} onClick={() => {setEmote(emoji);command("emote", {emoji});setEmoteOpen(false);emoteMenuRef.current?.querySelector("button")?.focus();}}>{label}</button>)}</div>}</div><div className="action-status"><div><strong>{room.legal ? "Your turn" : room.stage === "showdown" ? winnerText : room.stage === "waiting" ? "Waiting for players" : me?.waiting ? "Seated for the next hand" : `${room.players.find(p => p.id === room.turnId)?.name || "The table"} is thinking…`}</strong><span>{room.legal ? `You have ${seconds}s to act. ${room.legal.call ? `${chips(room.legal.call)} to call.` : "You can check for free."}` : room.stage === "showdown" ? room.results.map(r => r.hand).filter((v,i,a) => a.indexOf(v) === i).join(" · ") : room.closed ? "Table closed — return to the club" : room.closing ? "Closing after this hand; remaining chips will be retired" : room.tournament ? `${room.smallBlind} / ${room.bigBlind} blinds · ${room.ante} ante · ${room.tournament.self?.timeCards ?? 0} time cards` : "Play chips · 10 / 20 blinds"}</span></div></div>
          {room.tournament && (betweenHands || !["running","closing_rebuys"].includes(room.tournament.state) || ["rebuy","eliminated"].includes(room.tournament.self?.state||"")) ? <TournamentBetweenHands tournament={room.tournament} elapsed={elapsed} busy={busy} command={command}/> : betweenHands ? <div className="between-actions" aria-label="Room management">{me?.chips === 0 && !room.tournament && <button className="secondary-btn" disabled={busy || !room.practice && room.tickets.regular<1} onClick={() => command("rebuy")}><RefreshCw size={15}/>{room.practice ? "Rebuy 2,000" : "Rebuy · 1 Regular ticket"}</button>}{host ? <div className="deal-control"><button className="primary-btn deal-button" aria-describedby="deal-requirement" disabled={busy || room.paused || room.closing || room.closed || room.players.filter(p => !p.left && p.chips > 0).length < 2} onClick={() => command("deal")}>{busy ? <LoaderCircle className="spin" size={17}/> : <>{room.hand ? "Deal next hand" : "Deal the first hand"}</>}</button><span id="deal-requirement" className="deal-requirement">{room.players.filter(p => !p.left && p.chips > 0).length < 2 ? "At least 2 players with chips are needed." : room.paused ? "Table paused — resume in the club." : room.closing ? "Closing after settlement." : room.closed ? "Table closed." : "Table ready"}</span></div> : <span className="waiting-host">Waiting for the host to deal</span>}</div>
          : room.legal ? <div className="betting-controls">{room.tournament && <button className="timecard-btn" disabled={busy || seconds<=0 || !room.canUseTimeCard} onClick={()=>command("timecard")}>Time card +20s ({room.tournament.self?.timeCards||0})</button>}<div className="quick-actions"><button className="fold-btn" disabled={busy || seconds<=0} onClick={() => command("act", {move: "fold"})}>Fold</button><button className="secondary-btn" disabled={busy || seconds<=0} onClick={() => command("act", {move: room.legal!.check ? "check" : "call"})}>{room.legal.check ? "Check" : `Call ${chips(room.legal.call)}`}</button>{room.legal.allIn && <button className="allin-btn" disabled={busy || seconds<=0} onClick={() => command("act", {move: "allin"})}>All-in</button>}</div>{room.legal.canRaise && room.legal.max >= room.legal.min && <div className="raise-controls"><label htmlFor="raise-amount" className="raise-label">{room.currentBet === 0 ? "Bet amount" : "Raise to amount"}</label><input id="raise-amount" type="number" min={room.legal.min} max={room.legal.max} step="1" value={raise} onChange={e => setRaise(Number(e.target.value))}/><button className="primary-btn" disabled={busy || seconds<=0 || !Number.isInteger(raise) || raise < room.legal.min || raise > room.legal.max} onClick={() => command("act", {move: "raise", amount: raise})}>{room.currentBet === 0 ? "Bet" : "Raise to"} {chips(raise)}</button></div>}</div> : null}
          {error && <p className="error action-error" role="alert">{error}</p>}</section>}

      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {rules && <div className="modal-backdrop" onClick={() => setRules(false)}><section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-btn" onClick={() => setRules(false)} aria-label="Close rules" autoFocus><X size={20}/></button><span className="panel-overline">A SEAT AT THE TABLE</span><h2 id="rules-title">A little poker primer.</h2><p>Make the best five-card hand from your two private cards and the five community cards. Or win by being the last player who hasn’t folded.</p><ol><li><strong>Settle in.</strong> {room?.tournament ? "Each tournament entry or rebuy starts with 5,000 tournament chips. Hands deal automatically." : "One Regular ticket starts a seat with 2,000 table chips. Zero-stack rebuys use one ticket. Positive net hand winnings award Regular points. Leaving retires your chips. Practice is free and awards no points. The host deals when at least two players are seated."}</li><li><strong>Follow the cards.</strong> Bet before the flop, after the three-card flop, after the turn, and after the river.</li><li><strong>Make your move.</strong> Check when there’s nothing to call, match the bet, raise the total, or fold. All-in puts your remaining chips in; side pots are handled automatically.</li><li><strong>Show your hand.</strong> Best hand wins. Ties split the pot. The dealer button moves each hand. {room?.tournament ? "A 20-second timer checks or folds an absent player; a time card adds 20 seconds." : "A 45-second timer checks or folds an absent player."}</li></ol>{room?.tournament && <TournamentRules/>}<div className="hand-rankings"><strong>STRONGEST → WEAKEST</strong><p>Straight flush · Four of a kind · Full house · Flush · Straight · Three of a kind · Two pair · One pair · High card</p></div><p className="etiquette"><ShieldCheck size={17}/>Be kind. Play for fun. These chips have no cash value.</p><button className="primary-btn" onClick={() => setRules(false)}>Got it. Let’s play.<ArrowRight size={17}/></button></section></div>}
  </div>;
}
