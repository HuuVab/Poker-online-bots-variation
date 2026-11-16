// Pure, server-authoritative no-limit Texas Hold'em engine. Chips are play money.
export const STARTING_CHIPS = 2000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const TURN_MS = 45000;
const ranks = "23456789TJQKA";
const suits = "shdc";
export const HAND_NAMES = ["High card", "One pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];

function fail(message) { const error = new Error(message); error.name = "PokerRuleError"; throw error; }
function randomInt(max) {
  const limit = Math.floor(4294967296 / max) * max;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}
export function shuffledDeck() {
  const deck = [...suits].flatMap(s => [...ranks].map(r => r + s));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}
export function rankFive(cards) {
  const values = cards.map(c => ranks.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(values)];
  const straight = unique.length === 5 && unique[0] - unique[4] === 4 ? unique[0]
    : unique.join() === "14,5,4,3,2" ? 5 : 0;
  const flush = cards.every(c => c[1] === cards[0][1]);
  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, ...groups.map(g => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...groups.map(g => g[0])];
  if (groups[0][1] === 2) return [1, ...groups.map(g => g[0])];
  return [0, ...values];
}
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) fail("A hand needs five to seven cards.");
  let best = [-1];
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const score = rankFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (compare(score, best) > 0) best = score;
          }
  return best;
}
function log(room, message) {
  room.log.push({ id: crypto.randomUUID(), message, at: Date.now() });
  room.log = room.log.slice(-45);
}
export function makePlayer(name, token, bot = false) {
  name = typeof name === "string" ? name.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 18) : "";
  if (!name) fail("Enter your name to take a seat.");
  return { id: crypto.randomUUID(), token, name, bot, chips: STARTING_CHIPS, cards: [], bet: 0, total: 0, folded: false, waiting: false, left: false, actedBet: null, lastAction: "Joined" };
}
export function ensureSeats(room) {
  const taken = new Set();
  room.players.forEach(p => {
    if (Number.isInteger(p.seat) && p.seat >= 0 && p.seat < 6 && !taken.has(p.seat)) taken.add(p.seat);
    else p.seat = null;
  });
  room.players.filter(p => p.seat === null).forEach(p => {
    p.seat = [0,1,2,3,4,5].find(seat => !taken.has(seat)); taken.add(p.seat);
  });
}
function validSeat(seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 5) fail("Choose a seat from 1 to 6.");
}
export function makeRoom(code, player, practice = false, seat = 0) {
  validSeat(seat); player.seat = seat;
  const room = { code, hostId: player.id, practice, players: [player], stage: "waiting", hand: 0, dealer: -1, board: [], deck: [], pending: [], turnId: null, deadline: null, currentBet: 0, minRaise: BIG_BLIND, log: [], results: [], settledPot: 0 };
  log(room, `${player.name} opened the table.`);
  return room;
}
export function joinRoom(room, player, preferredSeat) {
  if (room.practice) fail("Practice tables are single-player. Create a friends table to invite others.");
  if (room.players.filter(p => !p.left).length >= 6) fail("This table is full.");
  // Retain players with contributions until the current hand has settled.
  const dealerId = room.players[room.dealer]?.id;
  room.players = room.players.filter(p => !p.left || (isPlaying(room) && p.total > 0));
  room.dealer = room.players.findIndex(p => p.id === dealerId);
  if (room.players.length >= 6) fail("A seat will open after this hand.");
  ensureSeats(room);
  if (preferredSeat !== undefined) validSeat(preferredSeat);
  player.seat = preferredSeat ?? [0,1,2,3,4,5].find(seat => !room.players.some(p => p.seat === seat));
  if (room.players.some(p => p.seat === player.seat)) fail("That seat was just taken. Choose another seat.");
  player.waiting = isPlaying(room);
  room.players.push(player);
  log(room, `${player.name} joined${player.waiting ? " and will play next hand" : ""}.`);
}
export function moveSeat(room, id, seat) {
  validSeat(seat);
  if (isPlaying(room)) fail("You can change seats between hands.");
  const dealerId = room.players[room.dealer]?.id;
  room.players = room.players.filter(p => !p.left);
  room.dealer = room.players.findIndex(p => p.id === dealerId);
  ensureSeats(room);
  if (room.players.some(p => p.id !== id && p.seat === seat)) fail("That seat was just taken. Choose another seat.");
  const player = room.players.find(p => p.id === id);
  if (!player) fail("Seat not found.");
  player.seat = seat; player.lastAction = "Changed seat";
  log(room, `${player.name} moved to seat ${seat + 1}.`);
}
export function isPlaying(room) { return !["waiting", "showdown"].includes(room.stage); }
const live = r => r.players.filter(p => !p.folded && !p.waiting && p.cards.length);
const canAct = p => !p.folded && !p.waiting && !p.left && p.chips > 0 && p.cards.length > 0;
function clockwise(room, from, predicate) {
  for (let n = 1; n <= room.players.length; n++) {
    const index = (from + n + room.players.length) % room.players.length;
    if (predicate(room.players[index])) return index;
  }
  return -1;
}
function pay(p, amount) {
  amount = Math.min(amount, p.chips);
  p.chips -= amount; p.bet += amount; p.total += amount;
}
function setTurn(room, from, now) {
  const index = clockwise(room, from, p => room.pending.includes(p.id) && canAct(p));
  room.turnId = index < 0 ? null : room.players[index].id;
  room.deadline = index < 0 ? null : now + (room.players[index].bot ? 1000 : TURN_MS);
}
export function startHand(room, playerId, now = Date.now()) {
  if (playerId !== room.hostId) fail("Only the host can deal a hand.");
  if (isPlaying(room)) fail("Finish the current hand first.");
  if (room.practice) room.players.filter(p => p.bot && p.chips === 0).forEach(p => { p.chips = STARTING_CHIPS; log(room, `${p.name} rebuys 2,000 play chips.`); });
  const oldDealer = room.players[room.dealer]?.id;
  ensureSeats(room);
  room.players = room.players.filter(p => !p.left).sort((a,b) => a.seat - b.seat);
  room.dealer = room.players.findIndex(p => p.id === oldDealer);
  if (room.players.filter(p => p.chips > 0).length < 2) fail("At least two players with chips are needed. Players with no chips can rebuy.");
  room.hand++; room.stage = "preflop"; room.board = []; room.results = []; room.settledPot = 0;
  room.deck = shuffledDeck(); room.currentBet = BIG_BLIND; room.minRaise = BIG_BLIND;
  room.players.forEach(p => {
    p.bet = 0; p.total = 0; p.actedBet = null; p.folded = p.chips === 0;
    p.waiting = p.chips === 0; p.lastAction = p.waiting ? "Sitting out" : ""; p.cards = [];
  });
  room.dealer = clockwise(room, room.dealer, p => !p.waiting);
  const playing = room.players.filter(p => !p.waiting);
  for (let n = 0; n < 2; n++) playing.forEach(p => p.cards.push(room.deck.pop()));
  const sb = playing.length === 2 ? room.dealer : clockwise(room, room.dealer, p => !p.waiting);
  const bb = clockwise(room, sb, p => !p.waiting);
  pay(room.players[sb], SMALL_BLIND); pay(room.players[bb], BIG_BLIND);
  room.players[sb].lastAction = "Small blind"; room.players[bb].lastAction = "Big blind";
  room.pending = room.players.filter(canAct).map(p => p.id);
  log(room, `Hand #${room.hand} · ${room.players[room.dealer].name} is the dealer.`);
  progress(room, bb, now);
}
export function legalActions(room, playerId) {
  const p = room.players.find(p => p.id === playerId);
  if (!p || room.turnId !== p.id || !isPlaying(room)) return null;
  const call = Math.min(p.chips, Math.max(0, room.currentBet - p.bet));
  const max = p.bet + p.chips;
  const min = room.currentBet === 0 ? BIG_BLIND : Math.max(BIG_BLIND, room.currentBet + room.minRaise);
  const canRaise = max > room.currentBet && (p.actedBet === null || room.currentBet - p.actedBet >= room.minRaise || (p.actedBet === 0 && room.currentBet < BIG_BLIND));
  return { call, check: call === 0, min, max, canRaise, allIn: canRaise || max <= room.currentBet };
}
export function act(room, playerId, action, amount, now = Date.now()) {
  const p = room.players.find(p => p.id === playerId);
  const legal = legalActions(room, playerId);
  if (!legal) fail("It is not your turn.");
  if (action === "allin") {
    if (!legal.allIn) fail("A short raise has not reopened betting. You can call or fold.");
    action = legal.max > room.currentBet ? "raise" : "call"; amount = legal.max;
  }
  if (action === "fold") { p.folded = true; p.lastAction = "Fold"; }
  else if (action === "check") {
    if (!legal.check) fail("You must call or fold.");
    p.lastAction = "Check"; p.actedBet = room.currentBet;
  } else if (action === "call") {
    pay(p, legal.call); p.lastAction = p.chips === 0 ? "All-in" : `Call ${legal.call}`; p.actedBet = room.currentBet;
  } else if (action === "raise") {
    if (!legal.canRaise) fail("Betting has not reopened for a raise.");
    if (!Number.isSafeInteger(amount) || amount <= room.currentBet || amount > legal.max || (amount < legal.min && amount !== legal.max)) fail(`Raise to at least ${legal.min}, or go all-in.`);
    const increase = amount - room.currentBet;
    if (increase >= room.minRaise) room.minRaise = increase;
    pay(p, amount - p.bet); room.currentBet = amount; p.actedBet = amount;
    room.pending = room.players.filter(q => canAct(q) && q.id !== p.id && q.bet < amount).map(q => q.id);
    p.lastAction = p.chips === 0 ? `All-in ${amount}` : `Raise to ${amount}`;
  } else fail("Unknown action.");
  log(room, `${p.name}: ${p.lastAction.toLowerCase()}.`);
  room.pending = room.pending.filter(id => id !== p.id);
  progress(room, room.players.indexOf(p), now);
}
function progress(room, from, now) {
  if (live(room).length === 1) { settle(room, false); return; }
  room.pending = room.pending.filter(id => room.players.some(p => p.id === id && canAct(p)));
  const active = room.players.filter(canAct);
  if (active.length === 1 && active[0].bet >= room.currentBet) room.pending = [];
  if (room.pending.length) { setTurn(room, from, now); return; }
  if (room.stage === "river") { settle(room, true); return; }
  room.players.forEach(p => { p.bet = 0; p.actedBet = null; if (canAct(p)) p.lastAction = ""; });
  room.currentBet = 0; room.minRaise = BIG_BLIND;
  room.deck.pop(); // Burn before each community street.
  if (room.stage === "preflop") {
    room.stage = "flop"; room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else { room.stage = room.stage === "flop" ? "turn" : "river"; room.board.push(room.deck.pop()); }
  log(room, `${room.stage[0].toUpperCase() + room.stage.slice(1)} dealt.`);
  room.pending = room.players.filter(canAct).map(p => p.id);
  if (room.players.filter(canAct).length < 2) { room.pending = []; progress(room, room.dealer, now); }
  else setTurn(room, room.dealer, now);
}
export function settle(room, showdown) {
  room.settledPot = room.players.reduce((s, p) => s + p.total, 0);
  const contenders = live(room);
  const scores = new Map(contenders.map(p => [p.id, showdown ? evaluate([...p.cards, ...room.board]) : [0]]));
  const levels = [...new Set(room.players.map(p => p.total).filter(Boolean))].sort((a, b) => a - b);
  const awards = new Map(); let previous = 0;
  for (const level of levels) {
    const contributors = room.players.filter(p => p.total >= level);
    const pot = (level - previous) * contributors.length; previous = level;
    // A lone contributor's unmatched bet is returned, including a folded player's.
    if (contributors.length === 1) { contributors[0].chips += pot; continue; }
    const eligible = contenders.filter(p => p.total >= level);
    if (!eligible.length) {
      // All contributors to a layer folded: refund their own unmatched layer.
      contributors.forEach(p => { p.chips += pot / contributors.length; }); continue;
    }
    let best = scores.get(eligible[0].id);
    eligible.forEach(p => { if (compare(scores.get(p.id), best) > 0) best = scores.get(p.id); });
    const winners = eligible.filter(p => compare(scores.get(p.id), best) === 0);
    winners.sort((a, b) => ((room.players.indexOf(a) - room.dealer - 1 + room.players.length) % room.players.length) - ((room.players.indexOf(b) - room.dealer - 1 + room.players.length) % room.players.length));
    const share = Math.floor(pot / winners.length);
    winners.forEach((p, i) => {
      const amount = share + (i < pot % winners.length ? 1 : 0);
      p.chips += amount; awards.set(p.id, (awards.get(p.id) || 0) + amount);
    });
  }
  room.results = [...awards].map(([id, amount]) => ({ id, amount, hand: showdown ? HAND_NAMES[scores.get(id)[0]] : "Everyone else folded" }));
  room.results.forEach(r => log(room, `${room.players.find(p => p.id === r.id).name} wins ${r.amount} · ${r.hand.toLowerCase()}.`));
  room.stage = "showdown"; room.turnId = null; room.deadline = null; room.pending = [];
  room.showCards = showdown;
}
export function leaveRoom(room, id, now = Date.now()) {
  const p = room.players.find(p => p.id === id);
  if (!p) fail("Seat not found.");
  p.left = true; p.folded = true; log(room, `${p.name} left the table.`);
  if (room.hostId === id) room.hostId = room.players.find(q => !q.left && !q.bot)?.id || null;
  if (isPlaying(room)) {
    const oldTurn = room.turnId;
    const oldDeadline = room.deadline;
    const from = oldTurn === id ? room.players.indexOf(p) : room.players.findIndex(q => q.id === oldTurn) - 1;
    progress(room, from, now);
    if (room.turnId === oldTurn && oldTurn !== id) room.deadline = oldDeadline;
  }
}
export function rebuy(room, id) {
  const p = room.players.find(p => p.id === id);
  if (isPlaying(room) && !p.waiting) fail("Rebuy between hands.");
  if (p.chips > 0) fail("Rebuy is available when you run out of chips.");
  p.chips = STARTING_CHIPS; log(room, `${p.name} rebuys 2,000 play chips.`);
}
export function tick(room, now = Date.now()) {
  // A single transition per poll preserves a visible pace for practice bots.
  if (!room.turnId || !room.deadline || room.deadline > now) return false;
  const p = room.players.find(p => p.id === room.turnId);
  const legal = legalActions(room, p.id);
  if (p.bot) {
    const strength = ranks.indexOf(p.cards[0][0]) + ranks.indexOf(p.cards[1][0]);
    const roll = randomInt(100);
    if (legal.canRaise && legal.max >= legal.min && strength > 15 && roll < 18) act(room, p.id, "raise", legal.min, now);
    else if (legal.check) act(room, p.id, "check", null, now);
    else if (legal.call <= 80 || roll < 55 || strength > 18) act(room, p.id, "call", null, now);
    else act(room, p.id, "fold", null, now);
  } else act(room, p.id, legal.check ? "check" : "fold", null, now);
  return true;
}
export function viewRoom(room, id, version) {
  const { deck, pending, ...safe } = room;
  return { ...safe, version, you: id, legal: legalActions(room, id), players: room.players.map(p => {
    const { token, actedBet, ...player } = p;
    return { ...player, cards: p.id === id || (room.stage === "showdown" && room.showCards && !p.folded) ? p.cards : p.cards.map(() => "??") };
  }) };
}
