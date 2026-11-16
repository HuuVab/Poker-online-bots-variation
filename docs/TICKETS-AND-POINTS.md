# Tickets, points and gameplay chips

There is no player wallet. Tickets purchase no cash value: they authorize participation in the matching game mode. Points are earned scores. Gameplay chips are local stakes inside a table/event. No conversion, transfer, withdrawal or payment endpoints exist.

| Mode | Entry | Rebuy | Gameplay stack | Points |
| --- | --- | --- | --- | --- |
| Regular | 1 Regular ticket | 1 Regular ticket, zero stack between hands only | 2,000 chips per entry/rebuy | Positive net hand winnings; losses do not deduct points |
| Tournament | 1 Tournament ticket | 1 Tournament ticket, existing Level 6 cutoff rules | 5,000 chips per entry/rebuy | Published tournament prize distribution |
| Practice | Free | Free | 2,000 isolated chips | None |

Each member has independent `tickets.regular`, `tickets.tournament`, `points.regular`, and `points.tournament`. New members begin at zero. Points cannot pay for entry or rebuy. Matching tickets are required even if the player has another mode’s tickets or a large point total.

## Admin grants

Only the club owner (admin) can use **Members → Grant mode tickets**. Select a member, mode, quantity (1–1,000,000 whole tickets), and reason (3–160 characters). Hosts and players cannot grant tickets, edit points, choose their stack, or spend another member’s tickets. Grants are append-only audit events. No deduction/correction or point-grant endpoint is provided.

## Awards and departure

Regular points equal `max(0, chips after settlement − chips at the beginning of the hand)`. For example, a player contributes 20 and wins a 30-chip pot: profit and points are 10. Returned unmatched bets and refunded own chips do not earn points. Losing players keep their previously earned point totals. The server awards once per settled hand, before processing departures. All-in departing players retain pot eligibility.

Remaining regular chips are retired when a seat leaves or the table closes, after any active hand. No entry ticket is returned, including leaving before the first hand. Returning to the club view keeps the seat. Tournament chips remain inside the event. Pre-start tournament unregister/cancel returns the matching ticket once and removes its point-pool contribution; running events retain the existing cancellation prohibition.

The host sets tournament prize points per entry/rebuy before opening registration (default 1,000). The setting locks immediately. This value is a score contribution, not a ticket price or deposited money. Prizes credit only Tournament points using the published original-player payout tier. Unlimited eligible rebuys use one ticket each and add the same point contribution; time cards are not replenished.

## Persistence and upgrade

Apply SQL migration `drizzle/0003_mode_resources.sql` once before running this release against an existing database. It adds nullable mode/resource/delta/balance columns to the existing append-only ledger; ticket/point audit records remain intact. Apply the follow-up `0004_remove_player_wallets.sql` migration to purge old wallet-only ledger records, drop wallet balance/delta columns, and remove wallet/legacyWallet fields from all members, including inactive members. Historical migration files remain necessary for clean database setup. This purge does not erase external backups or Git history. Drizzle journal and snapshot include this migration.

On the first successful authenticated state write, the server atomically upgrades the club aggregate to economy version 3. Retired wallet values are deleted, without conversion or an archived player balance. Version 3 also removes archives created by version 2, preserving existing tickets and points. Tickets and points start at zero; no implicit exchange rate is invented. Existing seats keep their chips and in-progress hand, with an opening chip-conservation baseline. Existing tournament prize pools become point pools at their existing numeric value; completed old-economy awards are not converted to new points. Existing pre-start tournament entries are grandfathered: unregister/cancel returns one Tournament ticket per entry. Admins should review and grant the desired initial tickets before admitting new entries.

Every ticket/point change and its resource audit record commit in the same aggregate CAS/D1 batch as seats, prizes and idempotency records. Duplicate requests do not double-spend or double-award; changed-payload replays fail. Regular tables conserve `chipsIssued = held stacks + live contributions + chipsRetired`. Tournament chip and point-pool invariants remain separate. Resource balances cannot become negative or exceed safe integers. SQL failure rolls back the whole operation.

## Future payment integration

No payment credentials, checkout or receipt-trust endpoints are added. A later gateway should grant tickets only after a verified server-to-server payment notification, using a unique provider transaction ID and the same atomic resource/idempotency boundary. Client redirects or client-supplied balances must never grant tickets.

Positive-win scoring is a game score, not an anti-collusion system: repeated play can increase points, and chip dumping/multiple accounts are not detected. Owner/admin and database access remain trusted. The existing authenticated-polling scheduling limitation is unchanged.
