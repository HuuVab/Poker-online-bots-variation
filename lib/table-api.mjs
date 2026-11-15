import { makePlayer, makeRoom, joinRoom, startHand, act, leaveRoom, rebuy, tick, viewRoom } from "./poker.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
const newToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map(n => alphabet[n % alphabet.length]).join("");

export async function handleTable(request, db) {
  try {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "This request came from another site." }, 403);
    if (!db) return json({ error: "The table service is not available yet. Please try again shortly." }, 503);
    const text = await request.text();
    if (text.length > 2048) return json({ error: "Request too large." }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400); }
    if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400);
    if (body.action === "create") {
      const token = newToken();
      const player = makePlayer(body.name, token);
      for (let attempt = 0; attempt < 4; attempt++) {
        const room = makeRoom(newCode(), player, body.practice === true);
        if (room.practice) {
          room.players.push(...["Milo", "Jules", "Cleo"].map(name => makePlayer(name, newToken(), true)));
          startHand(room, player.id);
        }
        const result = await db.prepare("INSERT OR IGNORE INTO rooms (code, state, version, updated_at) VALUES (?, ?, 0, ?)").bind(room.code, JSON.stringify(room), Date.now()).run();
        if (result.meta.changes) return json({ room: viewRoom(room, player.id, 0), token });
      }
      return json({ error: "Could not open a table. Please try again." }, 503);
    }
    if (typeof body.code !== "string" || !/^[A-Z2-9]{6}$/.test(body.code)) return json({ error: "Enter a six-character room code." }, 400);
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await db.prepare("SELECT state, version, updated_at FROM rooms WHERE code = ?").bind(body.code).first();
      if (!row || Date.now() - row.updated_at > 86400000) return json({ error: "That table was not found or has expired. Check your room code." }, 404);
      const room = JSON.parse(row.state);
      let player, token;
      let changed = false;
      if (body.action === "join") {
        token = newToken(); player = makePlayer(body.name, token); joinRoom(room, player); changed = true;
      } else {
        const bearer = request.headers.get("Authorization")?.replace(/^Bearer /, "");
        player = room.players.find(p => p.token === bearer && !p.left && !p.bot);
        if (!player) return json({ error: "Your seat has expired. Please join the table again." }, 401);
        if (body.action !== "state" && body.version !== row.version) return json({ error: "The table has changed. Please try your action again.", room: viewRoom(room, player.id, row.version) }, 409);
        changed = tick(room);
        if (body.action === "act") {
          if (!changed) { act(room, player.id, body.move, body.amount); changed = true; }
        } else if (body.action === "deal") { startHand(room, player.id); changed = true; }
        else if (body.action === "leave") { leaveRoom(room, player.id); changed = true; }
        else if (body.action === "rebuy") { rebuy(room, player.id); changed = true; }
        else if (body.action === "emote") {
          if (!["👋", "😎", "👏", "🍀"].includes(body.emoji)) return json({error:"Unknown reaction."},400);
          player.emote = body.emoji; player.emoteUntil = Date.now() + 2500; changed = true;
        }
        else if (body.action !== "state") return json({ error: "Unknown table action." }, 400);
      }
      if (!changed) return json({ room: viewRoom(room, player.id, row.version) });
      const result = await db.prepare("UPDATE rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?").bind(JSON.stringify(room), Date.now(), body.code, row.version).run();
      if (result.meta.changes) return json({ room: viewRoom(room, player.id, row.version + 1), ...(token ? { token } : {}) });
    }
    return json({ error: "The table is busy. Please try again." }, 409);
  } catch (error) {
    if (error instanceof Error && !/SQLITE|D1_|database|no such table/i.test(error.message)) return json({ error: error.message }, 400);
    console.error("Table storage request failed.");
    return json({ error: "The table service is temporarily unavailable. Please try again." }, 503);
  }
}
