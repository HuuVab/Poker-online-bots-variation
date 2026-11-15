# River Room

A multiplayer, play-money Texas Hold’em game for 2–6 friends. Create a private room, share its six-character code or invite link, and deal. Includes a four-seat practice table with three bots.

## Play locally

Requires Node.js 24+ (tests use the built-in SQLite module).

```powershell
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_past_secret_warriors.sql
npm run dev -- --host 0.0.0.0 --port 5173
```

Open <http://127.0.0.1:5173>. For friends on the same network, open the host computer’s LAN address on port 5173. Allow Node through the private-network firewall if your OS asks. Friends must use that LAN address too. An internet game requires hosting; localhost links work only on your computer.

The local migration command is for a fresh database. For later schema changes, generate and apply only new migrations.

## Features

- Six-character invite codes and copyable invite links.
- Server-managed deck, cryptographic shuffling and private hole cards.
- No-limit betting: check, call, raise to an amount, fold and all-in.
- Dealer rotation, heads-up blind order, 10/20 blinds and 2,000 starting chips.
- Five-card evaluation from seven cards, split pots, side pots and uncalled-bet returns.
- 45-second turns; a timed-out player checks for free or folds.
- Join during a hand and play next hand; host transfers when the host leaves.
- Refresh reconnects to your seat within the same browser tab.
- Optional turn sounds, activity feed, rules and responsive mobile layout.
- Rebuy at zero chips between hands. Practice bots rebuy automatically.

## Architecture

React UI on Vinext, deployed as a Cloudflare Worker through Sites. D1 stores room state; clients poll every 1.2 seconds. Each state change uses an atomic version comparison, so simultaneous requests cannot apply the same turn twice. Players receive only their own cards until showdown. Session tokens stay in browser session storage and are sent in authorization headers.

`lib/poker.mjs` is the pure game engine. `lib/table-api.mjs` handles authentication, storage and optimistic concurrency. `app/api/table/route.ts` connects the handler to D1. SQL schema and migrations live in `db/` and `drizzle/`.

Rooms expire after 24 hours without a committed change. Timers advance when a client polls. This is a friends-table MVP: no real money, payment system, tournaments, accounts, chat, anti-collusion system or production traffic abuse controls. A hosted Site’s access policy controls who can reach the game, independently of room codes. New Sites are owner-private until sharing is configured.

## Verify

```powershell
npm test
npm run typecheck
npm run build
```

Tests cover ranking, blind order, legal actions, short all-ins, side pots, ties, privacy, departure, timeouts, 300 randomized games, separate-client multiplayer and concurrent-write protection.
