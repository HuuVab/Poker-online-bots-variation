# Riverroom test scenarios

A risk-based matrix for the current private, play-money club. No finite list covers every possible input or event ordering. Cross the important cases below with player counts (2–6), all four streets, account roles, connection failures, and browser sizes.

## Verification labels

- **A** — automated handler/engine coverage executed in this audit. Some rows group multiple focused tests; see the files below.
- **E** — exhaustive five-card category distribution check executed in this audit. This does not exhaust every seven-card selection or tiebreak ordering.
- **M** — browser, real-account or environment scenario planned; not executed in this audit.
- **L** — load/operational test planned; not executed in this audit.
- **R** — rule/product convention must be agreed before writing acceptance assertions.
- **A+M** — server behavior covered, visual/end-to-end portion still pending.

P0 protects chips, permissions, privacy and recovery. P1 protects correct play, usability and capacity.

## Non-negotiable invariants

1. Wallets + held club stacks + live committed pots equal net owner-issued chips. Practice is excluded.
2. Every wallet equals the sum of its wallet ledger entries. No negative or fractional chip balances.
3. Buy-in, top-up, hand accounting and cash-out commit completely or not at all.
4. Each committed request and each hand settlement has one financial effect.
5. Only a verified active member may act, and only for their own actual turn.
6. Hosts cannot issue chips or gain ownership through engine host transfer.
7. Private cards/deck never leak to opponents, spectators, logs or error messages.
8. Cards in a real hand are unique; burn and board counts remain correct.
9. All-in eligibility survives removal, suspension and deferred departure.
10. Buttons, labels, visual effects and local clocks never decide server outcomes.
11. Failed/invalid operations leave financial state unchanged.
12. Stored tables holding funds never silently expire.

## Identity and private membership

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-001 | P0 | Anonymous request, including an old seat bearer token | 401; no seat, wallet, or private cards returned | A |
| QA-002 | P0 | First visitor tries to claim club ownership | Only configured verified owner can initialize | A |
| QA-003 | P0 | Missing owner configuration | Setup fails closed; no fallback production owner | A |
| QA-004 | P0 | Different identity has the owner email after initialization | Cannot replace pinned owner ID | A |
| QA-005 | P0 | Wrong, revoked, expired, or already-used invitation | No membership is created | A |
| QA-006 | P1 | Invitation email uses spaces or uppercase letters | Normalize email and bind acceptance to verified account | A |
| QA-007 | P0 | Member attempts owner grant or host-only creation | 403 and unchanged balances | A |
| QA-008 | P0 | Host tries to manage another host’s table | 403; owner can still manage it | A |
| QA-009 | P0 | Suspension, removal, demotion, and restoration | Rights change immediately; balances survive | A |
| QA-010 | P1 | Site permission granted without club invitation, or vice versa | Both independent gates must allow access; clear sign-in/access message | M |

## Table creation and management

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-011 | P1 | Create table with no seated players | Host can watch/manage; deal disabled until two funded seats | A+M |
| QA-012 | P1 | Minimum/maximum buy-in boundaries | Exact limits accepted; below/above/invalid values rejected | A |
| QA-013 | P1 | Duplicate Deal commands arrive together | Exactly one hand starts | A |
| QA-014 | P1 | Lock and unlock a table | New joins blocked while locked; existing hand can continue | A |
| QA-015 | P1 | Pause and resume while a hand is active | Current hand finishes; next deal remains blocked until resume | A+M |
| QA-016 | P0 | Close while waiting or after showdown | All stacks return exactly once | A |
| QA-017 | P0 | Close while bets or all-ins remain active | Complete hand normally, then cash out; no forced winner | A |
| QA-018 | P0 | Kick an opponent during a hand | Retain current pot eligibility; remove after settlement and block rejoin | A |
| QA-019 | P1 | Thirty open tables, then a thirty-first; close one and retry | Cap enforced, then capacity released without deleting balances | A |
| QA-020 | P1 | Close/reopen browser after 24 hours of inactivity | Funded table does not expire or lose funds; expired turns resume on polling | M |

## Seats, BTN and blinds

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-021 | P1 | Fill six seats and attempt a seventh | Reject extra seat without debiting wallet | A |
| QA-022 | P0 | Two accounts claim the same seat simultaneously | One succeeds; losing wallet remains unchanged | A |
| QA-023 | P1 | Move to an empty physical seat between hands | Preserve player identity, stack, and betting order by seat | A |
| QA-024 | P1 | Move into an occupied seat or move during a hand | Reject without creating a second stack | A |
| QA-025 | P1 | Join in the middle of a hand | Waiting seat receives no cards and cannot act until next deal | A |
| QA-026 | P0 | Leave while waiting for the next hand | Refund full uncommitted buy-in after current settlement | A |
| QA-027 | P1 | BTN rotates and a seat is busted or absent | Follow the implemented moving-button convention; skip sitting-out seats | A |
| QA-028 | P1 | Three players become heads-up | BTN is SB; BTN acts first pre-flop and BB acts first post-flop | A |
| QA-029 | P1 | Six players with nonconsecutive physical seats | Visual BTN/SB/BB agree with engine posting and action order | M |
| QA-030 | P1 | BTN and SB share one seat in heads-up | Both markers are legible and distinct from bet and timer | M |

## Cards and hand evaluation

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-031 | P0 | All possible five-card hands | Category frequencies match independent combinatorial counts for all 2,598,960 hands | E |
| QA-032 | P1 | Ace-low wheel, royal straight flush, and seven-card best hand | Correct category and highest valid five-card choice | A |
| QA-033 | P1 | Pair kickers and tied category comparisons | Correct ordered tiebreakers; suits do not break a poker tie | A |
| QA-034 | P1 | Two triplets in seven cards | Use higher trips as trips and lower trips as pair | A |
| QA-035 | P1 | Three pairs in seven cards | Use highest two pairs and best remaining kicker | A |
| QA-036 | P1 | More than five flush cards or several possible straights | Select highest valid five-card hand | A |
| QA-037 | P0 | Full six-player runout | No duplicated hole/board/deck cards; exactly three burns | A |
| QA-038 | P0 | Opponent, spectator, and unseated table manager inspect payload | No deck, private hole cards, account IDs, or internal opening stacks | A |
| QA-039 | P0 | Everyone folds before a showdown | Winner paid without revealing private cards | A |
| QA-040 | P0 | Folded strongest hand at showdown | Folded player cannot win; folded cards stay private to other viewers | A |

## Betting and turn order

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-041 | P1 | Check with no bet versus check facing a bet | Allow free check; reject illegal check without mutation | A |
| QA-042 | P1 | Call when fewer chips remain than the call amount | Call only remaining chips; mark all-in; never go negative | A |
| QA-043 | P1 | Raise to exact minimum, below minimum, or above stack | Allow valid bounds; reject invalid amounts without mutation | A |
| QA-044 | P1 | A full raise increases the next minimum raise | Use last full raise increment, not a fixed blind amount | A |
| QA-045 | P1 | A single short all-in after an earlier call | Do not reopen that caller’s raise rights | A |
| QA-046 | P1 | Several short all-ins cumulatively reach a full increment | Reopen affected caller’s raise rights | A |
| QA-047 | P1 | BB option after everyone limps | BB still has a check/raise decision | A |
| QA-048 | P0 | Act out of turn or send a stale version | Reject; never spend another player’s stack or take a second turn | A |
| QA-049 | P1 | Blinds exceed one or all remaining stacks | Post affordable blinds and run out any all-in hand correctly | A |
| QA-050 | P1 | Short opening all-in after checks; dead-button or missed-blind conventions | Document intended cash-game rules before treating these variants as acceptance criteria | R |

## Pots, ties and settlement

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-051 | P0 | One main pot with a clear winner | Award correct committed amount and record hand once | A |
| QA-052 | P0 | Main pot plus multiple successive side pots | Only eligible contributors can win each layer | A |
| QA-053 | P0 | Uncalled overbet exceeds every opponent’s contribution | Return unmatched amount to its owner | A |
| QA-054 | P0 | Two-way tie with an odd chip | Assign odd chip clockwise after BTN under current convention | A |
| QA-055 | P0 | Three-way board tie with unequal contributions | Split contested layers and return unmatched chips | A |
| QA-056 | P0 | All-in player requests departure | Do not fold all-in cards; preserve all pot eligibility | A |
| QA-057 | P0 | All-in player is suspended before final response | Deny further account actions but preserve payout and cash out after settlement | A |
| QA-058 | P0 | All-in player is kicked before final response | Do not transfer pot to host through a forced fold | A |
| QA-059 | P0 | Settlement races another poll, close, or departure | Record hand and each cash-out once; never double-award | A |
| QA-060 | P1 | One player wins main pot and another wins a side pot | UI says multiple players paid; displays exact separate payouts in history | M |

## Wallets and chip integrity

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-061 | P0 | New account or restored account | New wallet starts zero; restoration preserves existing balance | A |
| QA-062 | P0 | Buy-in/top-up with insufficient wallet | Reject atomically; no seat or partial debit | A |
| QA-063 | P0 | Negative, fractional, string, null, or unsafe-integer amounts | Reject without issuing or moving chips | A |
| QA-064 | P0 | Owner issue/correction without a meaningful reason | Reject; all accepted changes carry an audit reason | A |
| QA-065 | P0 | Two simultaneous deductions from one wallet | No negative balance; at most affordable deductions commit | A |
| QA-066 | P0 | Same wallet buys into two tables concurrently | Cannot spend the same chips twice | A |
| QA-067 | P0 | Browser edits player ID, role, stack, cards, or wallet fields | Trusted server identity and values prevail | A |
| QA-068 | P0 | Cash-out requested repeatedly or after response loss | One payout for the same operation; ledger remains exact | A |
| QA-069 | P0 | Practice win, loss, rebuy, departure, suspension or restart | Practice funds cannot enter club wallets | A |
| QA-070 | P0 | Random legal funded games | After every move: wallets + held stacks + live pots = net issued chips, and each wallet = its ledger sum | A |

## Concurrency and failed requests

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-071 | P0 | Same request ID and identical body repeated | Replay safe result; no duplicate side effect | A |
| QA-072 | P0 | Same request ID with changed action or amount | 409; no second mutation | A |
| QA-073 | P0 | Two accounts happen to use the same request ID | Keys are scoped per actor; valid operations stay independent | A |
| QA-074 | P0 | Ledger SQL fails after aggregate update is attempted | Transaction rolls back aggregate, ledger, seat, and operation record together | A |
| QA-075 | P0 | Top-up races Leave | Either allowed order conserves all chips; no locked orphan stack | A |
| QA-076 | P0 | Buy-in races Close | Join rejected or accepted and fully refunded | A |
| QA-077 | P0 | Two different betting actions race for the same turn | Only one committed action; loser receives conflict | A |
| QA-078 | P1 | Owner/member changes race invitation acceptance or a player action | No privilege escalation; check fresh membership on retry | M |
| QA-079 | P1 | Network response lost after commit; browser user retries | Browser must safely reuse operation identity or clearly reconcile before another financial request | M |
| QA-080 | P1 | Many active tables cause club-version conflicts | Conflicts recover without UI losing actions, bypassing validation, or duplicating chips | L |

## Disconnects, time and recovery

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-081 | P1 | Timeout immediately before and exactly at deadline | No early timeout; action occurs at boundary | A |
| QA-082 | P1 | Absent player can check | Check rather than fold | A |
| QA-083 | P1 | Absent player owes a call | Fold; no automatic paid call | A |
| QA-084 | P1 | Another player leaves out of turn | Retain current actor and deadline when still valid | A |
| QA-085 | P1 | Refresh, close tab, reopen table and use another device | Rejoin same account-bound seat with same stack; no extra buy-in | M |
| QA-086 | P1 | Connection drops during deal, raise, all-in or cash-out | Recover committed state and explain retry; never invent a local result | M |
| QA-087 | P1 | Two tabs use the same account and different stale snapshots | Only actual server turn succeeds; both converge afterward | M |
| QA-088 | P1 | All players go offline for several hours | No funds disappear; expired actions advance when authenticated polling resumes | M |
| QA-089 | P1 | Device sleep, clock skew, daylight-saving/timezone changes | Server remains authoritative; countdown resynchronizes after resume | M |
| QA-090 | P0 | Worker restarts or deployment happens during a hand | Durable state recovers; no lost buy-ins or repeated settlement | M |

## Malformed input and abuse

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-091 | P0 | Unknown/missing action, malformed JSON, null or array body | Client error; no mutation or internal details | A |
| QA-092 | P0 | Invalid table code including inherited property names | 400; do not inspect inherited properties or return internal errors | A |
| QA-093 | P0 | Inherited member names such as __proto__ and constructor | Not a real member; never mutate object prototypes | A |
| QA-094 | P1 | String/number/null supplied for pause or lock boolean | Reject instead of coercing to false | A |
| QA-095 | P0 | Cross-origin authenticated mutation | 403; no wallet or room mutation | A |
| QA-096 | P1 | Request body exceeds 8 KiB | 413 with bounded reading | A |
| QA-097 | P1 | Read or write rate-limit boundary | 429 above limit; blocked mutation has no financial side effect | A |
| QA-098 | P0 | Attempt to read another member’s ledger | Member denied; explicit owner access allowed | A |
| QA-099 | P1 | HTML/script/Unicode/bidi or very long name, title or emote | Render text safely, bound length, preserve layout; unknown emote rejected | M |
| QA-100 | P0 | Direct production endpoint with forged authentication headers | Hosting strips/replaces visitor identity headers; real signed-out request stays denied | M |

## Visual, responsive and accessible gameplay

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-101 | P1 | 1920×1080, 1600×900, 1366×768 and 1280×720 | Table, names, cards, pot and actions remain separated and accessible | M |
| QA-102 | P1 | 100%, 125% and 150% real browser zoom at each desktop resolution | No clipped actions, hidden inputs or overlapping seat indicators | M |
| QA-103 | P1 | Phone portrait/landscape and browser chrome resizing | Essential controls remain reachable; intentional scrolling where necessary | M |
| QA-104 | P1 | All 52 faces, especially 10/J/Q/K at actual card sizes | Exactly one large rank/suit and recognizable colors; accessible card name | M |
| QA-105 | P1 | Long names, maximum stacks, large pots and multiple winners | No text overflow or hidden values; accounting terminology stays accurate | M |
| QA-106 | P1 | Local versus opponent turn | Your turn / Thinking matches actual server actor and highlight | M |
| QA-107 | P1 | Keyboard-only use of menus, raise input, betting and dialogs | Visible focus; sensible order; Escape dismissal; no inaccessible essential action | M |
| QA-108 | P1 | Screen reader on turn, dealer, cards, result and errors | Correct names and useful announcements without repeated polling noise | M |
| QA-109 | P1 | Hover, press, focus, disabled states and low-contrast displays | Actions distinguishable; unavailable deal explains why | M |
| QA-110 | P1 | Private Site sign-in, invitation acceptance and wallet-first setup | No dead ends; clear explanation of zero balance and access requirements | M |

## Motion, performance and operations

| ID | Priority | Scenario | Expected result | Verification |
| --- | --- | --- | --- | --- |
| QA-111 | P1 | Deal a new hand and rotate BTN | Visible sequential dealing and correct marker destination; do not replay on ordinary polls | M |
| QA-112 | P1 | New flop/turn/river or opponent showdown reveal | Reveal only new cards; do not redeal existing cards | M |
| QA-113 | P1 | Call, raise, fold, split payout and winner announcement | Movement goes to correct pot/seat; labels agree with server amounts | M |
| QA-114 | P1 | Open completed hand or reconnect during animation | Current result is clear; transient motion never changes state or hides controls | M |
| QA-115 | P1 | Enable reduced motion before or during play | Cancel nonessential motion; maintain static result and turn clarity | M |
| QA-116 | P1 | Resize or navigate away during animation; rapid successive hands | Clean up particles, animations and timers; no lingering overlays or growing memory | M |
| QA-117 | P1 | Thirty active tables at expected polling rates | Measure p50/p95 response time, CAS retries, D1 operations and client frame times | L |
| QA-118 | P1 | 250 members, long-lived ledger and many closed tables | Measure aggregate size/history performance and warn before limits prevent recovery | L |
| QA-119 | P0 | Backup/restore and migration rehearsal on a copy of D1 | Wallet and ledger reconcile; ongoing hand and idempotency records survive | L |
| QA-120 | P1 | Unsupported/missing audio, clipboard or browser storage; slow devices | Graceful fallback; sound stays optional; gameplay remains possible | M |

## Execution record — 2026-11-16

Commands:

```powershell
npm test
npm run test:exhaustive
npm run typecheck
npm run build
```

- Original suite: 26 reported tests. Expanded suite: 90 reported tests, including 25 parameterized subtests; run the command for current totals.
- Randomized coverage: the existing 300 engine hands plus 30 funded handler games with seeded action choices, varied stacks and 2–6 accounts. Card shuffles still use production cryptographic randomness; the complete run is not fully deterministic.
- Exhaustive category oracle: all 2,598,960 unique five-card hands, with expected counts computed independently from combinations.
- Handler tests use real SQLite transactions behind a D1-shaped adapter and independent trusted test identities. They do not validate the production Sites authentication proxy or reproduce D1 geographic/concurrency latency.
- Expected injected-SQL-failure test emits one generic server error log; that line is intentional.
- Browser/zoom, live two-account sign-in, production header stripping, network fault injection, load limits, backup/restore and real D1 restart tests remain pending. Do not infer production security/performance certification from local passes.

## Confirmed findings fixed during this audit

1. Invalid/inherited table names could reach object-prototype lookups and return internal service errors. Table actions now require a valid six-character code and own-property lookup.
2. Membership targets could resolve inherited properties. Financial/member operations now accept only own membership records; regression tests verify Object.prototype remains unchanged.
3. Pause/lock accepted non-boolean values through coercion. They now require actual booleans.
4. Unknown actions could fall through unrelated table/seat authorization. Known actions are validated at the request boundary.

## Source of automated coverage

- `tests/poker.test.mjs`: original rules, evaluation and random engine games.
- `tests/poker-edge.test.mjs`: short stacks, cumulative all-ins, full deck partition, BTN rotation, time boundaries and layered payouts.
- `tests/api.test.mjs`: original authenticated club, privacy, ledger and concurrency coverage.
- `tests/scenarios.test.mjs`: new adversarial inputs, permission transitions, physical seat races, wallet races, capacity and randomized funded reconciliation.
- `tests/stress/evaluator.mjs`: independent exhaustive five-card category frequency oracle.
- `tests/support/club.mjs`: shared SQLite/D1 adapter and independent test users.

## Next manual test session

Use a staging club and disposable play chips, three independent accounts (owner, host, member), and two browsers/devices. Record room code, hand number, action/version, request ID, expected/actual result and screenshot for failures. Do not run load or malformed-identity tests against real users.

1. Complete the real sign-in/invitation path, then a full three-person hand.
2. Repeat with heads-up, six occupied seats, a late join and a suspended all-in player.
3. Interrupt network during a buy-in and settlement; reconnect and reconcile wallet/ledger.
4. Run the 4 resolutions × 3 real zoom settings, plus phone portrait/landscape and reduced motion.
5. Rehearse a deployment/restart and backup/restore on a database copy.
6. Run authorized load tests and record response/latency/conflict measurements before selecting a production capacity target.

## Implemented tournament extension

The tournament mode adds tests in `tests/tournament.test.mjs` and a rules specification in `docs/TOURNAMENT-RULES.md`. The suite now reports 110 passing tests (including parameterized subtests). These cover three nine-player tables, 27→18→9 transfers, dead BTN, BB ante priority and conservation, 20-second actions, two +20-second time cards, unlimited Level 1–6 rebuys, the Level 6 decision barrier, exactly one 10-minute break, Level 7 rebuy denial, reserved prize funds, tied placements and exactly-once payouts. A complete simulated 27-player event and 100 varied-stack nine-player all-in hands supplement the earlier random-game checks.

Local browser QA verified tournament creation, entry debit, unregister refund, cancellation, one real time-card activation, the cutoff break screen and nine-seat layout. Measured 1920×1080, 1600×900, 1366×768, 1280×720, effective 854×480 and 390×844: no station overlaps or horizontal overflow. Compact desktop uses intentional vertical scrolling. This was viewport testing, not a new claim of actual browser-zoom coverage or independent multi-device authentication/load testing. Test accounts and fixtures existed only in local D1.


## Ticket and points economy (current contract)

The prior wallet/buy-in/cash-out scenarios above describe the retired economy. Current behavior is defined in TICKETS-AND-POINTS.md. Regression tests now assert matching-ticket consumption, fixed stacks, zero-stack-only ticket rebuys, positive net hand point awards, Tournament point prizes, chip retirement on exit, owner-only grants, and resource audit reconciliation. Tests cover duplicate grants/entries/rebuys, concurrent spending of the last ticket, SQL rollback of grants/entry/awards/rebuys, cross-mode isolation, rejected client stack amounts, unauthorized grants, legacy migration, and redacted history. Poker engine, roles, privacy, pause, seat routing, full tournament and accounting regressions remain covered.

Local browser checks verified owner grants in both modes, isolated balances, Regular entry and chip retirement without ticket return, disabled nonzero-stack rebuy, Tournament registration/unregister with ticket return and point-pool updates, resource history, and a 390×844 phone view without horizontal overflow. No console errors were observed. Local test identities and grants are not production data. Production upgrades require SQL migration 0003 before this release runs.
