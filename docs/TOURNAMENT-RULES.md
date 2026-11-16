# Riverroom tournament mode

Implemented private-club no-limit Hold’em tournament mode. All chips are play chips with no cash value.

## Fixed structure

- 2–27 original players; at most three tables of nine seats.
- 5,000 tournament chips for each entry or rebuy.
- Entry and eligible rebuy each consume one Tournament ticket. The host locks a 1–1,000,000-point prize contribution per entry/rebuy (default 1,000) when opening registration. No fee or cash-out.
- All levels last 15 minutes. Initial SB/BB/ante: 25/50/50. Full schedule lives in `lib/tournament-rules.mjs` and appears in the lobby. After the listed levels, the last pattern continues with alternating increases.
- One full-BB ante is paid by the BB player, including heads-up. Pay the blind first if short. The ante is dead money and does not reduce the amount needed to call.
- 20 seconds per action; two time cards per original entrant. Each adds 20 seconds, one per action, with no replenishment after rebuy or transfer. Requests must arrive before the server deadline.
- Timeout checks where legal, otherwise folds.
- BTN uses tournament dead-button progression. Heads-up, BTN is SB and the BB advances to avoid a consecutive BB. The UI can display BTN at an empty seat.

## Registration and reserve

Registration is limited to active club members. Consume one Tournament ticket and add the configured points to the tournament prize reserve in the same D1 transaction. Duplicate registrations and capacity overflow do not consume tickets. Unregistering before start returns the Tournament ticket and reduces entries/pool. Pre-start cancellation returns all entry tickets once. No late registration; no host cancellation after starting.

The host must have at least two eligible entrants to start. Starting locks the original-player count and payout tier, shuffles seating using cryptographic randomness, and deals automatically. Existing cash and bot-practice tables remain separate six-seat modes.

## Rebuys and the one scheduled break

1. Only a zero-stack player after settlement receives a rebuy offer.
2. If that hand began at Level 6 or earlier and rebuys have not closed, reserve the seat for a 20-second decision.
3. Accepting spends the original entry price, adds it to the prize pool, and restores 5,000 tournament chips. Rebuy count is unlimited while eligible and affordable. Time cards remain unchanged.
4. Declining or timing out finalizes elimination. No add-ons and no later re-entry after final elimination.
5. At the end of Level 6, stop starting hands across all tables. Finish in-progress hands and their final eligible rebuy windows.
6. Close rebuys permanently and start one 10-minute break. No hands or rebuys run during it.
7. Resume at Level 7 automatically when next advanced by a connected viewer. No further scheduled breaks.

A completed tournament can finish before Level 7 if only one player remains and all rebuy decisions have resolved.

## Table balancing and placements

- Start tables as evenly populated as possible.
- Set a synchronization barrier when an elimination/rebuy, imbalance or table break requires it. Moves occur only after current hands settle and their result displays finish.
- At 18 remaining, break to two tables; at nine remaining, break to one. Pending rebuy decisions count as participating until resolved.
- A balancing move selects the player due for BB next from the larger table and the first available seat clockwise after the receiving table’s BB. Table breaks fill available seats between hands. Players never choose a move to avoid blinds; table changes may alter blind timing under the published seating convention.
- Stacks and time cards follow the account. Active players opening an old table are routed to their new seat; eliminated players can spectate other tables.
- After rebuys close, multiple tables synchronize hand-for-hand on the payout bubble. Eliminations in the synchronized round form one placement cohort.
- Within one hand/cohort, larger starting stacks finish higher. Equal starting stacks tie and share the prizes spanning their finishing positions. Riverroom’s starting-stack convention is before forced bets, not a claim of complete TDA conformance.

## Prizes

| Original entrants | Percentage payouts |
| --- | --- |
| 2–3 | 100% |
| 4–9 | 70 / 30 |
| 10–18 | 50 / 30 / 20 |
| 19–27 | 40 / 30 / 20 / 10 |

Rebuys increase entries and prize pool without changing original entrants or the payout tier. Percentage rounding remainder goes to first place. Equal-stack placement ties pool the affected prizes; any integer leftovers follow registration order. Integer percentage arithmetic uses BigInt before converting safe results back to numbers.

Complete only after all hands settle, all rebuy decisions resolve, and one playing entrant remains. Credit all prizes and empty the reserve atomically. A failed SQL insert rolls the entire completion back; the next valid retry cannot duplicate a committed payout.

## Distinct counters

- Players: unique original entrants (current registration count before start).
- Remaining: participating players, including pending rebuy decisions; one champion after completion.
- Total entries: original entries plus completed rebuys.
- Rebuys: completed additional entries.
- Total prize pool: all net entry/rebuy contributions, shown separately from each hand’s pot.

## Permissions and pauses

Hosts manage their own registrations and starts; the club owner may manage any registration/start. Hosts cannot kick a running entrant, change stacks, manually deal, cash out tournament chips, alter payouts or force a winner. Existing regular-table endpoints reject tournament stack operations.

A social pause requires all remaining entrants to vote for it, then begins between hands. A participant or manager may resume. Server deadlines, level end, break end and rebuy windows shift by the pause duration. A membership review pauses the event and requires restoring active membership before resumption. All-in eligibility and balances remain preserved.

Private-card redaction applies equally to spectators, managers and tournament participants. The server still knows the deck; server-blind cryptography is outside this mode.

## Persistence and clocks

Tournament state and table states are part of the existing versioned club aggregate. No new database migration or hosting binding is needed. Every read/mutation uses the same server-authoritative advancement routine. Wall-clock level/break times are persisted; browser clock changes cannot alter them. Human timeout transitions advance once per request, and new hands wait at least five seconds after settlement for the result display.

This hosting configuration uses authenticated polling, not an unattended scheduler. Any open club/table progresses all tables. If every viewer disconnects, the next viewer resumes stored play and advances the expired clock state; missed turns are not replayed as a fast-forward cascade. Pauses are explicit and shift stored timers. This behavior is visible in the in-app rules and README.

Operational bounds remain five live tournaments, 30 live club tables total, 250 members, the existing aggregate storage ceiling and per-account request limits. Long-term archival and an unattended event scheduler are future infrastructure work; do not claim a public-scale service or a production load audit.

## Accounting invariants

- Regular and Tournament ticket balances and point totals are independent nonnegative safe integers, reconciled with resource audit deltas on each commit.
- Each entry/rebuy consumes one Tournament ticket. Only pre-start unregister/cancel returns a ticket. Tournament prizes credit Tournament points, never tickets or Regular points.
- Active point reserve = prize pool; completed reserve + awarded points = prize pool; cancelled reserve = zero.
- Tournament stacks + live contributions + antes = chips issued through entries and rebuys.
- Point awards and ticket consumption share the aggregate CAS and transactional ledger boundary.
- Legacy wallet balances and wallet-only ledger history are removed without conversion. See TICKETS-AND-POINTS.md for upgrade behavior.

## Validation

Run `npm test`, `npm run typecheck`, `npm run test:exhaustive`, and the production build. Tournament tests cover 27 entrants, three full tables, 3→2→1 transfers and seat routing, ante priority, 20-second turns, time-card replay protection, unlimited rebuy accounting, SQL rollback, cutoff/break timing, Level 7 rebuy denial, privacy, membership review, unanimous pause, ties and exactly-once prizes. One complete simulated 27-player event and 100 nine-player varied-stack all-in hands verify chip conservation.

Local browser QA uses synthetic local-only members, never production invitations or seeded production balances. Real multi-device sign-in, unattended scheduling and production load tests are not implied by these checks.
