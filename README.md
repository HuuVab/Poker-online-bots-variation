# Riverroom

An invitation-only, play-money Texas Hold’em club for 2–6 players per table, with isolated bot practice.

## Club setup

The production `CLUB_OWNER_EMAIL` runtime secret selects the only account allowed to initialize the club. Sign in with ChatGPT and choose **Open private club**. The owner identity is then pinned to the verified Site user ID. An unset owner configuration fails closed; the first visitor cannot claim ownership.

Wallets start at zero. In **Members**, invite an email as Member or Host, then issue play chips with an audit reason. Invitations expire after seven days and must be accepted by the matching signed-in email. Hosts create/manage their own tables; the owner can manage all tables, change roles, suspend or remove memberships. Suspending/removing preserves balances and queues any seated stack for settlement and cash-out.

Site audience permissions are a separate gate. This deployment remains owner-private: grant friends access in Site sharing settings as well as inviting them inside the club. Club invitations create database invitations only; they do not send email or change Site access.

## Playing and managing tables

- Hosts set a table name and minimum/maximum buy-in. Rules remain six seats, no-limit Hold’em, 10/20 blinds and 45-second turns.
- Buy-ins and between-hand top-ups debit the permanent wallet. Only the owner can issue or correct chips, and a reason is mandatory.
- Lock blocks new seats. Pause blocks the next deal while the current hand finishes.
- Removing a player queues departure after the hand and blocks rejoining that table. It never force-folds the player.
- Closing a table finishes the current hand, then cashes out all remaining stacks exactly once.
- Voluntary departure folds an actionable hand, but preserves an all-in player’s pot eligibility. Cash-out waits until settlement.
- Practice chips and old anonymous demo-room chips never enter club wallets. Funded tables do not expire after 24 hours.
- **Club & wallet** returns to the club without abandoning a seat. **Leave & cash out** requests departure.

Chips have no cash value. No payments or real-money wagering are implemented.

## Architecture and security boundaries

React/Vinext on a Cloudflare Worker with D1. `/api/table` obtains identity from the Sites verified authentication helper; no browser-supplied account ID, role, balance or old seat bearer token authenticates a player. The poker engine deals and settles on the server. Responses redact opponent hole cards, deck, account IDs and internal accounting state, including for table managers.

One club aggregate is committed using a version compare-and-swap. Wallets and table stacks therefore share a concurrency boundary across tables. A transactional D1 batch writes the aggregate, append-only ledger/hand records and idempotency record together. Each insert is guarded by the successful CAS marker; failed races retry from fresh state, and SQL errors roll back the complete transaction. A chip-supply invariant checks every commit. Mutation request IDs prevent duplicate buy-ins, cash-outs and adjustments, and reject changed-payload replays. Same-origin checks, streaming 8 KiB request limits, strict whole-chip validation and per-account read/write rate limits are enforced.

The SQL ledger is append-only through the application (no update/delete endpoints); database administrators remain trusted. This is a small private-club architecture, not a claim of immunity to compromise or a real-money platform. A compromised owner account can issue chips. Collusion and multiple accounts are not detected. ChatGPT/Sites manages authentication; protect the owner account accordingly. Back up the D1 database using your hosting provider’s tools.

Clients poll tables every 1.2 seconds and the club every 5 seconds. Turn deadlines advance on an authenticated poll, so an abandoned table resumes its expired turns when someone next opens the club. This implementation serializes club writes and caps open tables at 30 and members at 250; it is intended for friends, not high-volume public play. History responses show the latest 100 wallet ledger entries. The aggregate has a storage ceiling and preserves closed table identities for idempotent retries.

## Local development

Requires Node.js 24+ (tests use built-in SQLite).

```powershell
npm ci
npm run build
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

Tests cover poker evaluation, blind order, short all-ins, side pots, ties, 300 randomized hands, verified membership and roles, concurrent cross-table spending, idempotent retries, SQL rollback, wallet reconciliation, all-in departures, deferred closure, kick fairness, suspension, practice isolation, request bounds and rate limits.
