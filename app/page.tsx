"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Copy, DoorOpen, Flag, Layers3, Link2, LoaderCircle, Menu, MessageSquare, Plus, Radio, RefreshCw, ShieldCheck, Spade, Users, Volume2, VolumeX, X } from "lucide-react";

type Player = { id: string; name: string; chips: number; bet: number; total: number; cards: string[]; folded: boolean; waiting: boolean; left: boolean; bot: boolean; lastAction: string; emote?: string; emoteUntil?: number };
type Room = { code: string; version: number; you: string; hostId: string; practice: boolean; stage: string; hand: number; dealer: number; players: Player[]; board: string[]; currentBet: number; deadline: number | null; turnId: string | null; settledPot: number; results: {id: string; amount: number; hand: string}[]; log: {id: string; message: string; at: number}[]; legal: null | {call: number; check: boolean; min: number; max: number; canRaise: boolean; allIn: boolean} };
type Session = { code: string; token: string };
const chips = (n: number) => n.toLocaleString("en-US");
const suitSymbols: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const stageNames: Record<string, string> = { waiting: "Waiting for players", preflop: "Pre-flop", flop: "The flop", turn: "The turn", river: "The river", showdown: "Hand complete" };

function Card({ value, small = false }: {value?: string; small?: boolean}) {
  if (!value) return <div className={`playing-card empty ${small ? "small" : ""}`}><span>♠</span></div>;
  if (value === "??") return <div className={`playing-card card-back ${small ? "small" : ""}`}><span>♠</span></div>;
  return <div className={`playing-card ${"hd".includes(value[1]) ? "red" : ""} ${small ? "small" : ""}`} aria-label={`${value[0] === "T" ? "10" : value[0]} ${suitSymbols[value[1]]}`}><span className="card-rank">{value[0] === "T" ? "10" : value[0]}<small>{suitSymbols[value[1]]}</small></span><span className="card-suit">{suitSymbols[value[1]]}</span><span className="card-corner">{value[0] === "T" ? "10" : value[0]}</span></div>;
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<Session | null>(null);
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
      const { response, data } = await request({ action: practice || mode === "create" ? "create" : "join", name, code: code.trim().toUpperCase(), practice });
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
        setSession(null); setRoom(null); setConnection("Ready to play");
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

  const me = room?.players.find(p => p.id === room.you);
  const seated: (Player | undefined)[] = Array(6).fill(undefined);
  if (room && me) {
    const myIndex = room.players.findIndex(p => p.id === room.you);
    const others = [...room.players.slice(myIndex + 1), ...room.players.slice(0, myIndex)].filter(p => !p.left);
    const positions: Record<number, number[]> = {1: [], 2: [3], 3: [2,4], 4: [1,3,5], 5: [1,2,4,5], 6: [1,2,3,4,5]};
    seated[0] = me;
    others.forEach((p,i) => {seated[(positions[others.length + 1] || [1,2,3,4,5])[i]] = p;});
  }
  const pot = room ? room.stage === "showdown" ? room.settledPot : room.players.reduce((n, p) => n + p.total, 0) : 0;
  const host = room?.hostId === room?.you;
  const betweenHands = !room || ["waiting", "showdown"].includes(room.stage);
  const winnerText = room?.results.map(r => `${room.players.find(p => p.id === r.id)?.name} +${chips(r.amount)}`).join(" · ");
  const seconds = room?.deadline ? Math.min(45, Math.max(0, Math.ceil((room.deadline - now) / 1000))) : 0;

  return <div className={`app-shell room-environment ${room ? "playing" : "in-lobby"} ${logOpen ? "log-open" : ""}`} onClickCapture={event => { if (!sound || !(event.target as HTMLElement).closest("button")) return; const ctx = audioRef.current; if (!ctx) return; const o = ctx.createOscillator(); const g = ctx.createGain(); o.type="sine"; o.frequency.setValueAtTime(280,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(90,ctx.currentTime+.07); g.gain.setValueAtTime(.035,ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.08); o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.08); }}>
    <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
      <a className="brand" href="/" aria-label="River Room home"><span className="brand-mark"><Spade size={24} fill="currentColor" /></span><span>river<span className="brand-light">room</span><small>POKER, IN GOOD COMPANY.</small></span></a>
      <div className="sidebar-label">YOUR LITTLE POKER CLUB</div>
      <button className="nav-item active" onClick={() => setMobileMenu(false)}><Layers3 size={19} />The lounge<span className="nav-dot" /></button>
      <button className="nav-item" onClick={() => { setRules(true); setMobileMenu(false); }}><CircleHelp size={19} />How to play<ArrowUpRight size={15} className="nav-arrow" /></button>
      <div className="sidebar-card"><div className="mini-cards"><span>♠</span><span>♥</span></div><h3>A good hand.<br />A great time.</h3><p>Pull up a chair. There’s always room for your people.</p><span className="script-line">See you at the table.</span></div>
      <div className="sidebar-bottom"><ShieldCheck size={17} /><span>All the fun. Always play money.</span><small>MADE FOR FRIENDS, NOT FORTUNES.</small></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><button className="floating-menu icon-btn" aria-label="Open game menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22}/></button><a className="hud-brand" href="/">♠ <strong>RIVER ROOM</strong></a><div className="hud-room">{room ? `${room.practice ? "PRACTICE" : room.code} · HAND #${room.hand}` : "PRIVATE TABLES"}<small>NO-LIMIT HOLD’EM · 10 / 20</small></div><div className="topbar-right"><span className="connection"><i className={connection === "Reconnecting…" ? "offline" : ""}/>{connection}</span><button className="icon-btn" aria-label={sound ? "Mute sounds" : "Enable sounds"} onClick={() => { if (!audioRef.current) audioRef.current = new AudioContext(); audioRef.current.resume(); setSound(!sound); }}>{sound ? <Volume2 size={21}/> : <VolumeX size={21}/>}</button><button className="icon-btn" aria-label="How to play" onClick={() => setRules(true)}><CircleHelp size={21}/></button>{room && <button className="icon-btn" aria-label="Toggle game log" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}><MessageSquare size={21}/></button>}</div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span/> THE EVENING IS YOURS</div><h1>{room ? "You’re in good company." : "Your next great hand."}</h1><p>{room ? "Settle in. The best part of poker is who’s at the table." : "A little friendly competition. A lot of good company."}</p></div><span className="play-money-badge"><span className="chip-icon">◉</span> PLAY MONEY ONLY</span></div>
        <div className="game-grid">
          <section className="table-panel" aria-label="Poker table">
            <div className="table-top"><div><h2>The lounge <span className="table-number">01</span></h2><p>No-limit Texas Hold’em <span>•</span> 10 / 20 blinds</p></div>{room ? <button className="room-code" onClick={copyInvite} disabled={room.practice} title="Copy invitation"><span>{room.practice ? "PRACTICE TABLE" : "ROOM"}</span>{!room.practice && <><strong>{room.code}</strong><Copy size={13}/></>}</button> : <span className="private-tag"><ShieldCheck size={13}/>Invite-only tables</span>}</div>
            <div className={`table-scene ${room ? "in-game" : ""}`}>
              <div className="table-shadow"/>
              <div className="poker-table"><div className="felt-inner"/><div className="felt-brand"><Spade size={18} fill="currentColor"/><span>RIVER ROOM</span><small>GOOD HANDS. GREAT COMPANY.</small></div>
                <div className="community"><span className="street-label">{room ? stageNames[room.stage] : "A NEW GAME. A GOOD NIGHT."}</span><div className="board">{Array.from({length: 5}, (_, i) => <Card value={room?.board[i]} key={`${room?.hand}-${i}-${room?.board[i] || "empty"}`}/>)}</div><div className="pot" key={`pot-${pot}`}><div className="physical-pot" aria-hidden="true">{Array.from({length: Math.min(5, Math.max(1, Math.ceil(pot/120)))}, (_, stack) => <span className={`chip-tower tower-${stack}`} key={stack}>{Array.from({length: Math.min(7, Math.max(2, Math.ceil(pot/30)))}, (_, chip) => <i key={chip} style={{bottom:chip*4}}/>)}</span>)}</div><span>{room?.stage === "showdown" ? "LAST POT" : "TOTAL POT"}<strong>{chips(pot)}</strong></span></div></div>
              </div>
              {Array.from({length: 6}, (_, i) => {
                const p = seated[i]; const turn = p && room?.turnId === p.id;
                const dealer = p && room?.players[room.dealer]?.id === p.id;
                const won = p && room?.results.some(r => r.id === p.id);
                return <div key={p?.id || `empty-${i}`} className={`seat seat-${i} ${p ? "occupied" : "vacant"} ${p?.folded ? "folded" : ""} ${turn ? "on-turn" : ""} ${won ? "winner" : ""}`}>
                  {p ? <>{((emote && p.id === room?.you) || (p.emote && (p.emoteUntil || 0) > now)) && <span className="emote-bubble">{p.id === room?.you && emote ? emote : p.emote}</span>}<div className="seat-cards">{p.cards.map((c, n) => <Card key={`${room?.hand}-${n}-${c}`} value={c} small/>)}</div><div className="seat-person"><div className={`seat-avatar color-${i}`}><svg viewBox="0 0 80 80" className="illustrated-avatar" aria-hidden="true"><path d="M5 80Q8 49 40 49T75 80" fill={['#cca66b','#7c9ea2','#b1785b','#829265','#9b7fa2','#b99662'][i]}/><ellipse cx="40" cy="32" rx="20" ry="24" fill="#e7b58e"/><path d="M19 28Q10 3 39 5Q69 2 62 32L54 20Q36 31 25 19Z" fill={i%2 ? '#442f2b' : '#303c3b'}/><circle cx="33" cy="33" r="2" fill="#302c29"/><circle cx="48" cy="33" r="2" fill="#302c29"/><path d="M34 44Q40 49 47 43" stroke="#985a49" strokeWidth="2" fill="none"/></svg>{dealer && <span className="dealer-button" title="Dealer">D</span>}</div><div className="seat-info"><strong>{p.name}{p.id === room?.you && <small>YOU</small>}</strong><span>{chips(p.chips)}<i> ◉</i></span></div>{turn && <span className="turn-timer">{seconds}</span>}</div><span className={`seat-action ${won ? "won" : ""}`}>{won ? "WINNER" : p.waiting ? "Next hand" : p.lastAction || (turn ? "Thinking…" : "")}</span>{p.bet > 0 && room?.stage !== "showdown" && <span className="seat-bet" key={`bet-${p.bet}`}><i className="bet-chip"/><i className="flying-chip"/> {chips(p.bet)}</span>}</> : <><div className="empty-seat"><Plus size={17}/></div><span>Open seat</span></>}
                </div>;
              })}
              {!room && <span className="table-note">Your people. Your table. Your rules.*</span>}
            </div>
            <div className="table-bottom"><span><Users size={15}/>{room ? `${room.players.filter(p => !p.left).length} / 6 seated` : "2–6 players"}</span><span><span className="tiny-chip">◉</span>2,000 starting chips</span><span><Radio size={15}/>{room?.practice ? "Practice mode" : "Live multiplayer"}</span></div>
          </section>
          <aside className="right-panel">{room && <button className="log-close icon-btn" onClick={() => setLogOpen(false)} aria-label="Close game log"><X size={20}/></button>}
            {!room ? <div className="lobby-card"><span className="panel-overline">LET’S MAKE A NIGHT OF IT</span><h2>Take your seat.</h2><p>Round up your friends.<br/>We’ll deal with the cards.</p><div className="mode-tabs"><button className={mode === "create" ? "selected" : ""} onClick={() => {setMode("create");setError("");}}>Create a table</button><button className={mode === "join" ? "selected" : ""} onClick={() => {setMode("join");setError("");}}>Join friends</button></div><form onSubmit={e => { e.preventDefault(); enter(); }}><label htmlFor="player-name">Your table name</label><input id="player-name" maxLength={18} placeholder="What should we call you?" value={name} autoComplete="nickname" onChange={e => setName(e.target.value)}/>{mode === "join" && <><label htmlFor="room-code">Room code</label><input id="room-code" className="code-input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} maxLength={6} placeholder="e.g. RIVER7" autoComplete="off"/></>}{error && <p className="error" role="alert">{error}</p>}<button className="primary-btn create-btn" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <>{mode === "create" ? "Create a table" : "Join the table"}<ArrowRight size={18}/></>}</button></form><div className="private-hint"><Link2 size={15}/><span>{mode === "create" ? "Get a room code. Share it. You’re in." : "One room code. Everyone at the same table."}</span></div><div className="practice-divider"><span>just getting warmed up?</span></div><button className="practice-btn" disabled={busy} onClick={() => enter(true)}><Spade size={15}/>Try a practice hand<ArrowUpRight size={15}/></button><span className="practice-note">Play against three friendly bots.</span></div>
            : <><div className="room-info"><div className="room-info-title"><span className="panel-overline">{room.practice ? "A LITTLE WARM-UP" : "THE GANG’S ALL HERE"}</span><span className="live-pill">LIVE</span></div><h2>{room.practice ? "Practice makes poker." : "Your table. Your people."}</h2><p>{room.practice ? "Three bots. Real rules. Zero pressure." : "Share your invite and let the good times roll."}</p>{!room.practice && <button className="invite-btn" onClick={copyInvite}><Link2 size={17}/>Invite friends<Copy size={15}/></button>}<div className="hand-meta"><span>Hand <strong>#{room.hand.toString().padStart(2, "0")}</strong></span><span>Blinds <strong>10 / 20</strong></span></div></div><div className="feed-card"><h3><MessageSquare size={16}/>Around the table<span>ACTIVITY</span></h3><div className="feed" ref={feedRef} role="log" aria-label="Table activity">{room.log.map((entry, i) => <div key={entry.id} className={`feed-entry ${i === room.log.length - 1 ? "latest" : ""}`}><i/><p>{entry.message}</p></div>)}</div></div><button className="leave-btn" disabled={busy} onClick={() => command("leave")}><DoorOpen size={15}/>Leave table</button></>}
          </aside>
        </div>
        {room && <div className="emote-controls" aria-label="Table reactions">{["👋", "😎", "👏", "🍀"].map(emoji => <button key={emoji} disabled={busy} onClick={() => { setEmote(emoji); command("emote", {emoji}); }} aria-label={`Send ${emoji} reaction`}>{emoji}</button>)}</div>}
        {room && <section className="action-panel" aria-label="Game actions"><div className="action-status"><span className={`status-orb ${room.legal ? "your-turn" : ""}`}><Spade size={19}/></span><div><strong>{room.legal ? "Your move. Make it a good one." : room.stage === "showdown" ? winnerText : room.stage === "waiting" ? "A good night starts with a full table." : me?.waiting ? "Your seat is saved for the next hand." : `${room.players.find(p => p.id === room.turnId)?.name || "The table"} is thinking…`}</strong><span>{room.legal ? `You have ${seconds}s to act. ${room.legal.call ? `${chips(room.legal.call)} to call.` : "You can check for free."}` : room.stage === "showdown" ? room.results.map(r => r.hand).filter((v,i,a) => a.indexOf(v) === i).join(" · ") : "Sit back, settle in, and enjoy the game."}</span></div></div>
          {betweenHands ? <div className="between-actions">{me?.chips === 0 && <button className="secondary-btn" disabled={busy} onClick={() => command("rebuy")}><RefreshCw size={15}/>Rebuy 2,000</button>}{host ? <button className="primary-btn" disabled={busy || room.players.filter(p => !p.left && p.chips > 0).length < 2} onClick={() => command("deal")}>{busy ? <LoaderCircle className="spin" size={17}/> : <><Layers3 size={17}/>{room.hand ? "Deal next hand" : "Deal the first hand"}</>}</button> : <span className="waiting-host">Waiting for the host to deal</span>}</div>
          : room.legal ? <div className="betting-controls"><div className="quick-actions"><button className="fold-btn" disabled={busy} onClick={() => command("act", {move: "fold"})}><Flag size={15}/>Fold</button><button className="secondary-btn" disabled={busy} onClick={() => command("act", {move: room.legal!.check ? "check" : "call"})}>{room.legal.check ? <Check size={17}/> : <ArrowDownLeft size={17}/>} {room.legal.check ? "Check" : `Call ${chips(room.legal.call)}`}</button>{room.legal.allIn && <button className="allin-btn" disabled={busy} onClick={() => command("act", {move: "allin"})}>All-in</button>}</div>{room.legal.canRaise && room.legal.max >= room.legal.min && <div className="raise-controls"><label htmlFor="raise-amount" className="sr-only">Raise to amount</label><input id="raise-amount" type="number" min={room.legal.min} max={room.legal.max} step="1" value={raise} onChange={e => setRaise(Number(e.target.value))}/><button className="primary-btn" disabled={busy || !Number.isInteger(raise) || raise < room.legal.min || raise > room.legal.max} onClick={() => command("act", {move: "raise", amount: raise})}>{room.currentBet === 0 ? "Bet" : "Raise to"} {chips(raise)}<ArrowUpRight size={16}/></button></div>}</div> : null}
          {error && <p className="error action-error" role="alert">{error}</p>}</section>}
        {!room && <div className="welcome-footer"><div><span className="footer-suits">♠ <i>♥</i> ♣ <i>♦</i></span><span>The cards are virtual.<br/><strong>The good times are real.</strong></span></div><p>No downloads. No buy-ins. Just one more hand.</p><button onClick={() => setRules(true)}>New to poker? We’ve got you<ArrowRight size={15}/></button></div>}
        <footer className="fineprint"><span>RIVER ROOM <span>© 2026</span></span><p>{room ? "Cards shuffled securely. Play chips have no cash value." : "*The rules are Texas Hold’em. The house rules are good company."}</p><button onClick={() => setRules(true)}>Table etiquette <ArrowUpRight size={12}/></button></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {rules && <div className="modal-backdrop" onClick={() => setRules(false)}><section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-btn" onClick={() => setRules(false)} aria-label="Close rules" autoFocus><X size={20}/></button><span className="panel-overline">A SEAT AT THE TABLE</span><h2 id="rules-title">A little poker primer.</h2><p>Make the best five-card hand from your two private cards and the five community cards. Or win by being the last player who hasn’t folded.</p><ol><li><strong>Settle in.</strong> Everyone starts with 2,000 play chips. The host deals when at least two players are seated.</li><li><strong>Follow the cards.</strong> Bet before the flop, after the three-card flop, after the turn, and after the river.</li><li><strong>Make your move.</strong> Check when there’s nothing to call, match the bet, raise the total, or fold. All-in puts your remaining chips in; side pots are handled automatically.</li><li><strong>Show your hand.</strong> Best hand wins. Ties split the pot. The dealer button moves each hand. A 45-second timer checks or folds an absent player.</li></ol><div className="hand-rankings"><strong>STRONGEST → WEAKEST</strong><p>Straight flush · Four of a kind · Full house · Flush · Straight · Three of a kind · Two pair · One pair · High card</p></div><p className="etiquette"><ShieldCheck size={17}/>Be kind. Play for fun. These chips have no cash value.</p><button className="primary-btn" onClick={() => setRules(false)}>Got it. Let’s play.<ArrowRight size={17}/></button></section></div>}
  </div>;
}
