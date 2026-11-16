# Riverroom

An invitation-only, ticket-entry Texas Hold’em club with 2–6-player regular tables, isolated bot practice, and tournaments for up to 27 players across three nine-seat tables.

## Run on your Windows PC (localhost)

```powershell
cd D:\Poker\river-room
npm ci
npm run build:local
npm start
```

Open **http://localhost:3000** and create your admin account. There is no default login. The server binds to **127.0.0.1 only**, so this release is accessible only on your own PC. Node.js 24+ is required. No Cloudflare account or ChatGPT sign-in is needed for this mode.

The admin creates player accounts using the shield button (**Account and server management**) in the top bar, manages access/roles, resets player passwords, and grants Regular/Tournament tickets in **Members**. **Settings** changes starting chips, blinds, action duration and default tournament prize points for new games. Existing tables/events retain their settings. Gameplay remains server-authoritative.

Local SQLite data lives in `data/riverroom.sqlite`; migrations run automatically. Accounts, salted password hashes, sessions, games, tickets, points and history survive restart. No hosted or demo database is imported. The one-second server clock advances hands and tournament timers without browser polling while the process is running. Keep the terminal and PC awake; press Ctrl+C for a clean stop. `npm run start:local` builds and starts in one command.

See [docs/LOCAL-SERVER.md](docs/LOCAL-SERVER.md) for account management, settings, backup, ports and limitations. The Cloudflare/Sites path below is retained separately (`npm run start:sites`).

## Hosted club setup

The production `CLUB_OWNER_EMAIL` runtime secret selects the only account allowed to initialize the club. Sign in with ChatGPT and choose **Open private club**. The owner identity is then pinned to the verified Site user ID. An unset owner configuration fails closed; the first visitor cannot claim ownership.

Tickets and points start at zero. In **Members → Grant mode tickets**, the owner selects Regular or Tournament, a member, a whole-ticket quantity, and an audit reason. Invitations expire after seven days and must be accepted by the matching signed-in email. Hosts create/manage their own tables; only the owner grants tickets. Suspending/removing preserves ticket and point balances and queues regular seats for settlement and chip retirement. There is no player wallet, payment integration, cash-out, resource transfer or points-to-entry conversion.

Site audience permissions are a separate gate. This deployment remains owner-private: grant friends access in Site sharing settings as well as inviting them inside the club. Club invitations create database invitations only; they do not send email or change Site access.

## Playing and managing tables

- Regular and Tournament tickets, points and gameplay chips are separate. Practice remains free and awards nothing.
- Regular tables have six seats, 10/20 blinds and 45-second turns. One Regular ticket grants a fixed 2,000-chip seat. Between-hand rebuys require zero chips and one further Regular ticket; no top-ups.
- After each regular hand, each player earns `max(0, ending stack − opening stack)` Regular points. Returned own bets are excluded. Losses do not deduct earned points. Points never buy entry or chips.
- Lock blocks new seats. Pause blocks the next deal while the current hand finishes.
- Removing a player queues departure after the hand and blocks rejoining that table. It never force-folds the player.
- Closing or leaving a table retires remaining chips after settlement. No ticket or chip redemption occurs, even before the first deal.
- Voluntary departure folds an actionable hand, but preserves an all-in player’s pot eligibility.
- **Club & tickets** returns without abandoning a seat. **Leave table** requests departure.

Tickets, points and gameplay chips have no cash value. See [docs/TICKETS-AND-POINTS.md](docs/TICKETS-AND-POINTS.md) for accounting, upgrade behavior and the future payment boundary.

## Tournament mode

Open **Tournaments** in the club book. Hosts create events requiring one Tournament ticket per entry or eligible rebuy. Each entry adds a locked prize-point contribution (default 1,000 points). Members register; the host starts with 2–27 entrants. Seats are randomly assigned across up to three nine-seat tables, which balance and merge automatically between hands. Existing regular/practice tables remain six-seat games.

- Each entry gives 5,000 tournament chips. These stay inside the event and cannot be redeemed.
- Levels last 15 minutes, starting at 25/50 with a one-BB big-blind ante. The blind is paid before the ante by a short-stacked BB. Antes do not count toward calls.
- Turns last 20 seconds. Each entrant starts with two time cards adding 20 seconds each; one card per action, with no replenishment on rebuy.
- Unlimited zero-stack rebuys through Level 6, using one Tournament ticket. Decisions last 20 seconds. A Level 6 hand finishing past the clock cutoff retains its last rebuy decision.
- Stop new hands at the cutoff, resolve those hands and decisions, close rebuys, then take one 10-minute break. Resume automatically at Level 7 with rebuys permanently closed. No other scheduled breaks.
- Players, remaining players, total entries, rebuys, tournament prize pool, and each hand’s pot are distinct displays.
- Entries/rebuys increase the point prize pool. Completion awards Tournament points once: 2–3 original players 100%; 4–9 70/30%; 10–18 50/30/20%; 19–27 40/30/20/10%. Rebuys increase the pool without changing the payout tier.
- Same-hand equal-stack eliminations share affected prizes. Percentage rounding remainder goes to first place; tied-prize integer leftovers follow registration order.
- Tournament stacks cannot use regular-table entry, rebuy, leave, seat-move or host kick endpoints. Unregister/cancel before starting returns the matching entry ticket and removes its prize-point contribution. A running tournament cannot be cancelled by its host.
- Unanimous remaining-player approval pauses between hands. Resume shifts clocks and deadlines. A club membership suspension/removal pauses the event for review instead of silently forfeiting that player’s stack.

Hosted mode advances events on authenticated club/table polling; local mode has a dedicated one-second server clock. If anyone has the club or table open, all tournament tables progress. When every viewer disconnects, saved gameplay resumes on return; the wall-clock blind schedule still advances. The hosted deployment does not install an unattended timer service. Real production multi-device and load testing remain separate from local SQLite and browser QA.

The full rules and schedule are also available in the lobby and tournament help dialog. See [docs/TOURNAMENT-RULES.md](docs/TOURNAMENT-RULES.md) for the state machine, accounting and validation details.

## Architecture and security boundaries

Local mode serves the existing React game through Node HTTP and SQLite. Hosted mode uses React/Vinext on a Cloudflare Worker with D1. `/api/table` obtains identity from the Sites verified authentication helper; no browser-supplied account ID, role, balance or old seat bearer token authenticates a player. The poker engine deals and settles on the server. Responses redact opponent hole cards, deck, account IDs and internal accounting state, including for table managers.

One club aggregate is committed using a version compare-and-swap. Mode-specific tickets, points, regular stacks and tournament prize reserves share a concurrency boundary across tables. Every resource change must match its mode/resource audit delta. Each regular table conserves chips issued = held stacks + live contributions + retired chips; tournament chips have their own conservation invariant. A transactional D1 batch writes the aggregate, append-only ledger/hand records and idempotency record together. Inserts are guarded by the successful CAS marker; failed races retry and SQL errors roll back the transaction. Request IDs prevent duplicate grants, entries, rebuys and point awards, rejecting changed-payload replays. Same-origin checks, streaming 8 KiB limits, whole-number validation and per-account rate limits remain enforced.

The SQL ledger is append-only through the application (no update/delete endpoints); database administrators remain trusted. This is a small private-club architecture, not a claim of immunity to compromise or a real-money platform. A compromised owner account can grant tickets. Hosts choose the published tournament point contribution before registration. Collusion and multiple accounts are not detected. ChatGPT/Sites manages authentication; protect the owner account accordingly. Back up the D1 database using your hosting provider’s tools.

Hosted clients poll tables every 1.2 seconds and the club every 5 seconds. Turn deadlines advance on an authenticated poll, so an abandoned table resumes its expired turns when someone next opens the club. This implementation serializes club writes and caps open tables at 30 and members at 250; it is intended for friends, not high-volume public play. History responses show the latest 100 ticket/point ledger entries. The aggregate has a storage ceiling and preserves closed table identities for idempotent retries.

## Local development

Requires Node.js 24+ (tests use built-in SQLite).

```powershell
npm ci
npm run build
# Upgrade an existing database: apply ONLY unapplied migrations; apply 0003_mode_resources.sql and then 0004_remove_player_wallets.sql.
# Fresh database: apply each migration once, in filename order.
Get-ChildItem drizzle/*.sql | Sort-Object Name | ForEach-Object {
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file $_.FullName
}
npm run dev -- --host 127.0.0.1 --port 5173
```

Open http://127.0.0.1:5173 and use **Sign in with ChatGPT**. The bundled development middleware provides a loopback-only mock identity (`seedy@sites.test`) and strips incoming spoofed identity headers. The development owner fallback is compiled out of production. Local browsers share that mock identity; multi-account authorization and accounting tests supply independent trusted identities directly to the handler, with no production impersonation endpoint.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

Tests cover poker evaluation, blind order, short all-ins, side pots, ties, 300 randomized hands, verified membership and roles, concurrent cross-table spending, idempotent retries, SQL rollback, mode-specific ticket/point reconciliation, all-in departures, deferred closure, kick fairness, suspension, practice isolation, request bounds and rate limits.

## Full test matrix

See [docs/TEST-SCENARIOS.md](docs/TEST-SCENARIOS.md) for 120 prioritized scenarios, execution status, known verification limits, and the manual release checklist. Run `npm run test:exhaustive` for the complete five-card category check.


## Security attack regression

The standalone server has controlled attack regression tests for spoofed sessions, privilege escalation, resource tampering, SQL/prototype payloads, replay races, Origin/Host checks, private file paths, malformed bodies and slow/incomplete requests. See [docs/SECURITY-ATTACK-TEST.md](docs/SECURITY-ATTACK-TEST.md) for the confirmed availability finding, fix, results and scope limits.
