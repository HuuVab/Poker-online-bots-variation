"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PokerCard as Card } from "../components/poker-card";
import { ArrowRight, ArrowUpRight, Check, CircleHelp, Copy, DoorOpen, Link2, LoaderCircle, Menu, MessageSquare, RefreshCw, ShieldCheck, Spade, Volume2, VolumeX, X } from "lucide-react";

type Player = { id: string; name: string; chips: number; seat: number; departing?: boolean; bet: number; total: number; cards: string[]; folded: boolean; waiting: boolean; left: boolean; bot: boolean; lastAction: string; emote?: string; emoteUntil?: number };
type Room = { code: string; version: number; you: string; hostId: string; practice: boolean; stage: string; hand: number; dealer: number; players: Player[]; board: string[]; currentBet: number; deadline: number | null; turnId: string | null; settledPot: number; results: {id: string; amount: number; hand: string}[]; log: {id: string; message: string; at: number}[]; legal: null | {call: number; check: boolean; min: number; max: number; canRaise: boolean; allIn: boolean} };
type Session = { code: string; token: string };
const chips = (n: number) => n.toLocaleString("en-US");
const stageNames: Record<string, string> = { waiting: "Waiting for players", preflop: "Pre-flop", flop: "The flop", turn: "The turn", river: "The river", showdown: "Hand complete" };

const EMOTES: Record<string, string> = {"👋": "Hello, table.", "😎": "Nice hand.", "👏": "Well played.", "🍀": "Good luck."};
function RiverMark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3 36 20 20 37 4 20Z" stroke="currentColor"/><path d="M10 19c7-8 13 8 20 0M10 23c7-8 13 8 20 0" stroke="currentColor" strokeWidth="1.5"/><path d="m20 8 4 5h-8Z" fill="currentColor"/></svg>;
}

function PlayerStation({ player, index, isYou, active, seconds }: { player: Player; index: number; isYou: boolean; active: boolean; seconds: number }) {
  return <div className="seat-person"><div className={`seat-avatar color-${index}`}><svg viewBox="0 0 80 80" className="illustrated-avatar" aria-hidden="true"><path d="M5 80Q8 49 40 49T75 80" fill={['#b69b6d','#718980','#a87964','#8b9071','#8c7c71','#ad946c'][index]}/><ellipse cx="40" cy="32" rx="20" ry="24" fill="#e7b58e"/><path d="M19 28Q10 3 39 5Q69 2 62 32L54 20Q36 31 25 19Z" fill={index%2 ? '#442f2b' : '#303c3b'}/><circle cx="33" cy="33" r="2" fill="#302c29"/><circle cx="48" cy="33" r="2" fill="#302c29"/><path d="M34 44Q40 49 47 43" stroke="#985a49" strokeWidth="2" fill="none"/></svg></div><div className="seat-info"><strong>{player.name}{isYou && <small>you</small>}</strong><span className="station-balance">{chips(player.chips)}</span></div>{active && <span className="turn-timer" aria-label={`${seconds} seconds remaining`}>{seconds}</span>}</div>;
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | undefined>();
  const sceneRef = useRef<HTMLDivElement>(null);
  const presenceRoom = useRef<string | null>(null);
  const [seated, setSeated] = useState<(Player | undefined)[]>(Array(6).fill(undefined));
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState("create");
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
  const versionRef = useRef(-1);
  const generationRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const accept = useCallback((next: Room) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version; setRoom(next);
  }, []);
  const request = useCallback(async (payload: Record<string, unknown>, auth?: Session | null) => {
    const response = await fetch("/api/table", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
    const data = await response.json() as { room?: Room; token?: string; error?: string };
    return { response, data };
  }, []);

  useEffect(() => {
    try {
      setName(localStorage.getItem("river-name") || "");
      const saved = sessionStorage.getItem("river-seat");
      if (saved) setSession(JSON.parse(saved));
      const invite = new URLSearchParams(window.location.search).get("room");
      if (invite) { setCode(invite.toUpperCase().slice(0, 6)); setMode("join"); }
    } catch { /* A live session also works when browser storage is disabled. */ }
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const generation = generationRef.current;
    async function poll() {
      try {
        const {response, data} = await request({ action: "state", code: session!.code }, session);
        if (cancelled || generation !== generationRef.current) return;
        if (response.ok && data.room) { accept(data.room); setConnection("Table is live"); }
        else if ([401, 404].includes(response.status)) {
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

  async function enter(practice = false) {
    if (busy) return;
    if (!name.trim()) { setError("Give yourself a name first."); return; }
    setBusy(true); setError("");
    try {
      const { response, data } = await request({ action: practice || mode === "create" ? "create" : "join", name, code: code.trim().toUpperCase(), practice, seat: selectedSeat });
      if (!response.ok || !data.room || !data.token) throw new Error(data.error || "Could not take a seat.");
      generationRef.current++; versionRef.current = -1;
      const nextSession = { code: data.room.code, token: data.token };
      setSession(nextSession); accept(data.room); setConnection("Table is live");
      try { sessionStorage.setItem("river-seat", JSON.stringify(nextSession)); localStorage.setItem("river-name", name); } catch {}
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  async function command(action: string, extra: Record<string, unknown> = {}) {
    if (busy || !room || !session) return;
    setBusy(true); setError("");
    const generation = generationRef.current;
    try {
      const { response, data } = await request({ action, code: session.code, version: room.version, ...extra }, session);
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
    try { await navigator.clipboard.writeText(`${window.location.origin}/?room=${room.code}`); setToast("Invite link copied. Save a seat for a friend."); }
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
  const nextSeats: (Player | undefined)[] = Array(6).fill(undefined);
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
  const smallBlindId = blindSeats[blindSeats.length === 2 ? 0 : 1]?.id;
  const bigBlindId = blindSeats[blindSeats.length === 2 ? 1 : 2]?.id;
  const pot = room ? room.stage === "showdown" ? room.settledPot : room.players.reduce((n, p) => n + p.total, 0) : 0;
  const host = room?.hostId === room?.you;
  const betweenHands = !room || ["waiting", "showdown"].includes(room.stage);
  const winnerText = room?.results.map(r => `${room.players.find(p => p.id === r.id)?.name} +${chips(r.amount)}`).join(" · ");
  const seconds = room?.deadline ? Math.min(45, Math.max(0, Math.ceil((room.deadline - now) / 1000))) : 0;

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !room) return;
    const measure = () => {
      const potElement = scene.querySelector<HTMLElement>(".pot");
      const dealer = scene.querySelector<HTMLElement>(".seat:has(.dealer-button) .seat-cards");
      if (!potElement) return;
      const potRect = potElement.getBoundingClientRect(), dealerRect = dealer?.getBoundingClientRect() || potRect;
      scene.querySelectorAll<HTMLElement>(".seat").forEach(seat => {
        const cards = seat.querySelector<HTMLElement>(".seat-cards");
        if (!cards) return;
        const rect = cards.getBoundingClientRect();
        seat.style.setProperty("--deal-x", `${dealerRect.left + dealerRect.width/2 - rect.left - rect.width/2}px`);
        seat.style.setProperty("--deal-y", `${dealerRect.top + dealerRect.height/2 - rect.top - rect.height/2}px`);
        seat.style.setProperty("--pot-x", `${potRect.left + potRect.width/2 - rect.left - rect.width/2}px`);
        seat.style.setProperty("--pot-y", `${potRect.top + potRect.height/2 - rect.top - rect.height/2}px`);
        const payout = seat.querySelector<HTMLElement>(".payout-chips");
        if (payout) {const payoutRect = payout.getBoundingClientRect();seat.style.setProperty("--payout-x", `${potRect.left+potRect.width/2-payoutRect.left}px`);seat.style.setProperty("--payout-y", `${potRect.top+potRect.height/2-payoutRect.top}px`);}
        const bet = seat.querySelector<HTMLElement>(".seat-bet");
        if (bet) {const betRect = bet.getBoundingClientRect();seat.style.setProperty("--bet-x", `${potRect.left+potRect.width/2-betRect.left}px`);seat.style.setProperty("--bet-y", `${potRect.top+potRect.height/2-betRect.top}px`);}
      });
    };
    measure(); let frame = 0;
    const observer = new ResizeObserver(() => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);}); observer.observe(scene);
    return () => {observer.disconnect(); cancelAnimationFrame(frame);};
  }, [room?.hand, room?.stage, room?.version, seated]);

  return <div className={`app-shell room-environment ${room ? "playing" : "in-lobby"} ${logOpen ? "log-open" : ""}`} onClickCapture={event => { if (!sound || !(event.target as HTMLElement).closest("button")) return; const ctx = audioRef.current; if (!ctx) return; const o = ctx.createOscillator(); const g = ctx.createGain(); o.type="sine"; o.frequency.setValueAtTime(280,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(90,ctx.currentTime+.07); g.gain.setValueAtTime(.035,ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.08); o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.08); }}>
    <aside id="club-menu" aria-label="Game menu" className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
      <a className="brand" href="/" aria-label="Riverroom home"><RiverMark/><span>Riverroom</span></a>
      <button className="nav-item" onClick={() => { setRules(true); setMobileMenu(false); }}><CircleHelp size={18}/>Table rules</button>
      {room && <button className="nav-item" onClick={() => {setLogOpen(true);setMobileMenu(false);}}><MessageSquare size={18}/>Hand history</button>}
      {room && !room.practice && <button className="nav-item" onClick={copyInvite}><Link2 size={18}/>Copy invitation</button>}
      {room && <button className="nav-item" disabled={busy} onClick={() => command("leave")}><DoorOpen size={18}/>Leave table</button>}
    </aside>
    <div className="main-shell">
      <header className="topbar"><button className="floating-menu icon-btn" aria-label="Open game menu" aria-expanded={mobileMenu} aria-controls="club-menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22}/></button><a className="hud-brand" href="/" aria-label="Riverroom home"><RiverMark/><strong>Riverroom<span>POKER CLUB</span></strong></a><div className="hud-room">{room ? <><span className="room-identity">{room.practice ? "House table" : <button className="copy-room-code" onClick={async () => {try {await navigator.clipboard.writeText(room.code);setToast("Room code copied.");}catch{setToast(`Room code: ${room.code}`);}}} aria-label={`Copy room code ${room.code}`}><span>{room.code}</span><Copy size={12}/></button>}<span className="hud-divider">/</span>{room.hand ? `Hand ${room.hand}` : "Waiting"}</span></> : "PRIVATE TABLES"}<small>NO-LIMIT HOLD’EM · 10 / 20</small></div><div className="topbar-right"><span className="connection"><i className={connection === "Reconnecting…" ? "offline" : ""}/>{connection}</span><button className="icon-btn" aria-label={sound ? "Mute sounds" : "Enable sounds"} onClick={() => { if (!audioRef.current) audioRef.current = new AudioContext(); audioRef.current.resume(); setSound(!sound); }}>{sound ? <Volume2 size={21}/> : <VolumeX size={21}/>}</button><button className="icon-btn" aria-label="How to play" onClick={() => setRules(true)}><CircleHelp size={21}/></button>{room && <button className="icon-btn" aria-label="Toggle game log" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}><MessageSquare size={21}/></button>}</div></header>
      <main>
        <div className="game-grid">
          <section className="table-panel" aria-label="Poker table">
            <div ref={sceneRef} className={`table-scene ${room ? "in-game" : ""}`}>
              
              <div className="poker-table"><div className="felt-inner"/>
                <div className="community"><span className="street-label">{room ? stageNames[room.stage] : "Texas Hold’em"}</span><div className="board">{Array.from({length: 5}, (_, i) => <Card value={room?.board[i]} key={`${room?.hand}-${i}-${room?.board[i] || "empty"}`}/>)}</div><div className="pot" key={`pot-${pot}`}><div className="physical-pot" aria-hidden="true">{Array.from({length: Math.min(5, Math.max(1, Math.ceil(pot/120)))}, (_, stack) => <span className={`chip-tower tower-${stack}`} key={stack}>{Array.from({length: Math.min(7, Math.max(2, Math.ceil(pot/30)))}, (_, chip) => <i key={chip} style={{bottom:chip*4}}/>)}</span>)}</div><span>{room?.stage === "showdown" ? "LAST POT" : "POT"}<strong>{chips(pot)}</strong></span></div></div>
              </div>
              {Array.from({length: 6}, (_, i) => {
                const p = seated[i]; const turn = p && !p.departing && room?.turnId === p.id;
                const dealer = p && room?.players[room.dealer]?.id === p.id;
                const won = p && !p.departing && room?.results.some(r => r.id === p.id);
                return <div key={`seat-${i}`} className={`seat seat-${i} ${p ? "occupied" : "vacant"} ${p?.departing ? "departing" : ""} ${p?.folded ? "folded" : ""} ${turn ? "on-turn" : ""} ${won ? "winner" : ""}`}>
                  {p ? <>{((emote && p.id === room?.you) || (p.emote && (p.emoteUntil || 0) > now)) && <span className="emote-bubble">{EMOTES[(p.id === room?.you && emote ? emote : p.emote) || ""] || "Hello, table."}</span>}<div className="seat-cards" aria-hidden={p.folded || p.departing}>{p.cards.map((c, n) => <Card key={`${room?.hand}-${n}-${c}`} value={c} small/>)}</div><PlayerStation player={p} index={i} isYou={p.id === room?.you} active={!!turn} seconds={seconds}/><div className="seat-markers">{dealer && <span className="dealer-button" title="Dealer" aria-label="Dealer">D</span>}{(p.id === smallBlindId || p.id === bigBlindId) && <span className="blind-marker">{p.id === smallBlindId ? "SB" : "BB"}</span>}</div><span className={`seat-action ${won ? "won" : ""}`}>{won ? "WINNER" : p.waiting ? "Next hand" : (turn ? (p.id === room?.you ? "Your turn" : "Thinking…") : (["Small blind", "Big blind"].includes(p.lastAction) ? "" : p.lastAction))}</span>{p.bet > 0 && room?.stage !== "showdown" && <span className="seat-bet" key={`bet-${p.bet}`}><i className="bet-chip"/><i className="flying-chip" aria-hidden="true"/> {chips(p.bet)}</span>}{won && <span className="payout-chips" aria-hidden="true" key={`payout-${room?.hand}`}><i/><i/><i/></span>}</> : <><button className="empty-seat" disabled={busy || (!!room && !betweenHands)} aria-label={`Sit in seat ${i+1}`} title={room && !betweenHands ? "Change seats between hands" : "Sit here"} onClick={() => {if(room) command("seat", {seat:i});else {setSelectedSeat(i);document.getElementById("player-name")?.focus();}}}><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><path d="M11 24V14q7-5 14 0v10M10 24h16M13 24v4m10-4v4"/></svg><span className="sit-label">Sit here</span></button></>}
                </div>;
              })}

            </div>

          </section>
          <aside className="right-panel">{room && <button className="log-close icon-btn" onClick={() => setLogOpen(false)} aria-label="Close game log"><X size={20}/></button>}
            {!room ? <div className="lobby-card"><span className="panel-overline">RIVERROOM / TABLE RESERVATION</span><h2>A seat at the club.</h2><p>Texas Hold’em. 2–6 friends. Play chips.</p>{selectedSeat !== undefined && <p className="seat-reservation">Seat {selectedSeat+1} selected</p>}<div className="mode-tabs"><button className={mode === "create" ? "selected" : ""} onClick={() => {setMode("create");setError("");}}>Create a table</button><button className={mode === "join" ? "selected" : ""} onClick={() => {setMode("join");setError("");}}>Join friends</button></div><form onSubmit={e => { e.preventDefault(); enter(); }}><label htmlFor="player-name">Your table name</label><input id="player-name" maxLength={18} placeholder="What should we call you?" value={name} autoComplete="nickname" onChange={e => setName(e.target.value)}/>{mode === "join" && <><label htmlFor="room-code">Room code</label><input id="room-code" className="code-input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} maxLength={6} placeholder="e.g. RIVER7" autoComplete="off"/></>}{error && <p className="error" role="alert">{error}</p>}<button className="primary-btn create-btn" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <>{mode === "create" ? "Create a table" : "Join the table"}<ArrowRight size={18}/></>}</button></form><div className="private-hint"><Link2 size={15}/><span>{mode === "create" ? "Get a room code. Share it. You’re in." : "One room code. Everyone at the same table."}</span></div><div className="practice-divider"><span>Practice</span></div><button className="practice-btn" disabled={busy} onClick={() => enter(true)}><Spade size={15}/>Play with the house<ArrowUpRight size={15}/></button><span className="practice-note">Three bots. The same table rules.</span></div>
            : <><div className="room-info"><div className="room-info-title"><span className="panel-overline">{room.practice ? "PRACTICE TABLE" : "PRIVATE TABLE"}</span></div><h2>{room.practice ? "House table" : "Table ledger"}</h2><p>{room.practice ? "Three bots · play chips" : `Room ${room.code}`}</p>{!room.practice && <button className="invite-btn" onClick={copyInvite}><Link2 size={17}/>Invite friends<Copy size={15}/></button>}<div className="hand-meta"><span>Hand <strong>#{room.hand.toString().padStart(2, "0")}</strong></span><span>Blinds <strong>10 / 20</strong></span></div></div><div className="feed-card"><h3><MessageSquare size={16}/>Hand history<span>ACTIVITY</span></h3><div className="feed" ref={feedRef} role="log" aria-label="Table activity">{room.log.map((entry, i) => <div key={entry.id} className={`feed-entry ${i === room.log.length - 1 ? "latest" : ""}`}><i/><p>{entry.message}</p></div>)}</div></div><button className="leave-btn" disabled={busy} onClick={() => command("leave")}><DoorOpen size={15}/>Leave table</button></>}
          </aside>
        </div>

        {room && <section className="action-panel" aria-label="Game actions"><div className="emote-controls" ref={emoteMenuRef}><button className="emote-trigger" aria-label="Open emote menu" aria-expanded={emoteOpen} aria-controls="emote-options" onClick={() => setEmoteOpen(!emoteOpen)}><MessageSquare size={16}/><span>Emote</span></button>{emoteOpen && <div id="emote-options" className="emote-options" role="group" aria-label="Table reactions">{Object.entries(EMOTES).map(([emoji, label]) => <button key={emoji} disabled={busy} onClick={() => {setEmote(emoji);command("emote", {emoji});setEmoteOpen(false);emoteMenuRef.current?.querySelector("button")?.focus();}}>{label}</button>)}</div>}</div><div className="action-status"><div><strong>{room.legal ? "Your turn" : room.stage === "showdown" ? winnerText : room.stage === "waiting" ? "Waiting for players" : me?.waiting ? "Seated for the next hand" : `${room.players.find(p => p.id === room.turnId)?.name || "The table"} is thinking…`}</strong><span>{room.legal ? `You have ${seconds}s to act. ${room.legal.call ? `${chips(room.legal.call)} to call.` : "You can check for free."}` : room.stage === "showdown" ? room.results.map(r => r.hand).filter((v,i,a) => a.indexOf(v) === i).join(" · ") : "Play chips · 10 / 20 blinds"}</span></div></div>
          {betweenHands ? <div className="between-actions" aria-label="Room management">{me?.chips === 0 && <button className="secondary-btn" disabled={busy} onClick={() => command("rebuy")}><RefreshCw size={15}/>Rebuy 2,000</button>}{host ? <div className="deal-control"><button className="primary-btn deal-button" aria-describedby="deal-requirement" disabled={busy || room.players.filter(p => !p.left && p.chips > 0).length < 2} onClick={() => command("deal")}>{busy ? <LoaderCircle className="spin" size={17}/> : <>{room.hand ? "Deal next hand" : "Deal the first hand"}</>}</button><span id="deal-requirement" className="deal-requirement">{room.players.filter(p => !p.left && p.chips > 0).length < 2 ? "At least 2 players with chips are needed." : "Table ready"}</span></div> : <span className="waiting-host">Waiting for the host to deal</span>}</div>
          : room.legal ? <div className="betting-controls"><div className="quick-actions"><button className="fold-btn" disabled={busy} onClick={() => command("act", {move: "fold"})}>Fold</button><button className="secondary-btn" disabled={busy} onClick={() => command("act", {move: room.legal!.check ? "check" : "call"})}>{room.legal.check ? "Check" : `Call ${chips(room.legal.call)}`}</button>{room.legal.allIn && <button className="allin-btn" disabled={busy} onClick={() => command("act", {move: "allin"})}>All-in</button>}</div>{room.legal.canRaise && room.legal.max >= room.legal.min && <div className="raise-controls"><label htmlFor="raise-amount" className="raise-label">{room.currentBet === 0 ? "Bet amount" : "Raise to amount"}</label><input id="raise-amount" type="number" min={room.legal.min} max={room.legal.max} step="1" value={raise} onChange={e => setRaise(Number(e.target.value))}/><button className="primary-btn" disabled={busy || !Number.isInteger(raise) || raise < room.legal.min || raise > room.legal.max} onClick={() => command("act", {move: "raise", amount: raise})}>{room.currentBet === 0 ? "Bet" : "Raise to"} {chips(raise)}</button></div>}</div> : null}
          {error && <p className="error action-error" role="alert">{error}</p>}</section>}

      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {rules && <div className="modal-backdrop" onClick={() => setRules(false)}><section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-btn" onClick={() => setRules(false)} aria-label="Close rules" autoFocus><X size={20}/></button><span className="panel-overline">A SEAT AT THE TABLE</span><h2 id="rules-title">A little poker primer.</h2><p>Make the best five-card hand from your two private cards and the five community cards. Or win by being the last player who hasn’t folded.</p><ol><li><strong>Settle in.</strong> Everyone starts with 2,000 play chips. The host deals when at least two players are seated.</li><li><strong>Follow the cards.</strong> Bet before the flop, after the three-card flop, after the turn, and after the river.</li><li><strong>Make your move.</strong> Check when there’s nothing to call, match the bet, raise the total, or fold. All-in puts your remaining chips in; side pots are handled automatically.</li><li><strong>Show your hand.</strong> Best hand wins. Ties split the pot. The dealer button moves each hand. A 45-second timer checks or folds an absent player.</li></ol><div className="hand-rankings"><strong>STRONGEST → WEAKEST</strong><p>Straight flush · Four of a kind · Full house · Flush · Straight · Three of a kind · Two pair · One pair · High card</p></div><p className="etiquette"><ShieldCheck size={17}/>Be kind. Play for fun. These chips have no cash value.</p><button className="primary-btn" onClick={() => setRules(false)}>Got it. Let’s play.<ArrowRight size={17}/></button></section></div>}
  </div>;
}
