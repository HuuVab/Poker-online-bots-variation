# Localhost attack simulation — 16 November 2026

## Scope

Controlled HTTP attacks against separately created localhost servers with in-memory databases and synthetic accounts. No attack requests target the user's real database or any external system. Existing localhost account tests also cover password reset/session revocation, brute-force limits, expiry, account-creation rollback, and restart persistence.

## Confirmed finding and fix

**Availability: an unfinished unauthenticated request could block the API and game clock.** The original handler entered the globally serialized database queue before reading the network body. One client could begin a login JSON body and stop sending; ordinary API requests and scheduled ticks waited behind it. A regression test reproduced the blocked request with a 500 ms observation window. This did not demonstrate account takeover or ticket theft.

The handler now reads bounded network input outside the database queue. Bodies have a three-second absolute deadline (not extended by trickled bytes), an 8 KiB limit for declared and chunked content, and at most 32 concurrent readers. Rejected/incomplete requests close their connections. The operation queue is capped at 64 and the HTTP server at 128 connections. Mutation authorization is still checked inside the serialized operation, so reading a body cannot grant a stale or revoked session access. Malformed URL escaping now returns 400 rather than a generic 500.

## Tested attack groups

| Attack | Observed result |
| --- | --- |
| Fake identity headers, invented/duplicate cookies, browser-supplied account IDs | Rejected; no tickets granted |
| Member promoting themselves, resetting admin password, changing settings or granting tickets | Rejected; admin and resources unchanged |
| Setup takeover after initialization | Rejected |
| SQL injection in sign-in/member targets and prototype-related keys | No sign-in bypass, account changes or prototype mutation |
| Forged chip stack, tickets, points, hole cards and illegal bets | Rejected or ignored; fixed server stack and balances retained |
| Reading opponent cards, deck and internal accounting in game responses | Opponent cards redacted; tested private fields absent |
| Concurrent replay of the same entry and races spending the last ticket | Exactly one entry/charge per request ID; one ticket cannot fund two entries |
| Accidental proxy/tunnel access in local mode | Refused even with a valid local session |
| Off-site/missing/null Origin, cross-site fetch metadata and rebinding Host | Rejected; existing session remained valid |
| Paths targeting server source, database and dotfiles | Not served |
| Malformed JSON, invalid URL escapes, oversized declared/chunked bodies | Rejected; server remained usable |
| Slow or unfinished login body | Other API requests and the clock remain usable after fix |
| Excess simultaneous incomplete bodies | Excess requests receive 429; normal requests and ticks remain usable |

Run `node --test tests/server-security.test.mjs` for these eleven attack groups. Run `npm test` for the complete regression suite. These tests require loopback networking; restrictive execution sandboxes may require network permission even though no external service is contacted.

## Limits

This is an application-level regression exercise, not a comprehensive penetration test, dependency audit, Windows security audit, or internet-scale load test. A valid stolen session acts as its user until revoked/expired. The admin and anyone who controls the Windows account/database remain trusted. HTTP localhost has no TLS, and first-run setup trusts the first authorized local setup request. Public hosting, a payment gateway, anti-collusion, and resistance to arbitrary local malware are outside this result. Do not describe these passing tests as proof that the game is unhackable.
