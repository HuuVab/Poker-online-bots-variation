# Windows localhost server

## Start

Install Node.js 24 or later, then in PowerShell:

```powershell
cd D:\Poker\river-room
npm ci
npm run build:local
npm start
```

Open http://localhost:3000. `npm run start:local` combines the build and start steps; later restarts only require `npm start`. Keep the terminal running. Ctrl+C closes the HTTP server and database cleanly. This is a local-only release: there is no LAN/internet listener, tunnel, router setting, or firewall rule.

The existing Cloudflare/Sites build and `npm run start:sites` remain separate. Local mode uses a standalone Vite-built React client plus Node's HTTP/SQLite APIs, reusing the authoritative poker/economy modules. It needs neither Cloudflare credentials nor ChatGPT authentication.

## Admin and players

On the first visit, create your own admin name, email, password, and club name. No default credentials are installed. Setup closes after the first successful admin creation; the admin ID is pinned in the database. This is a local login: email is an identifier, and no verification or email delivery is performed.

Use the shield button in the game's top bar (**Account and server management**):

- Create a player with name, email, initial password, and Member/Host role. Accounts begin with zero tickets and points.
- Manage accounts: promote/demote Host, suspend or restore access. The admin cannot be demoted or suspended. The club book also provides member removal and restoration controls.
- Reset another player's password. This revokes that player's existing sessions.
- Change your own password by supplying the current password. Other sessions are revoked; the current browser gets a new session.
- Sign out. Players should change admin-assigned initial passwords before use.

Passwords require 12–256 characters and are stored as per-user salted scrypt hashes (N=32768, r=8, p=1), never plaintext. Sessions use random 256-bit tokens, store only token hashes, expire after six hours, and use HttpOnly/SameSite=Strict cookies. There are at most five sessions per user. Authentication attempts are rate-limited. A suspension/removal revokes existing sessions; restoring access requires a fresh login. Session status is refreshed periodically in the client.

There is no email password recovery yet. If the admin loses the password, retain the data and arrange an explicit recovery procedure; do not delete the database just to reset a login.

## Tickets and settings

**Members → Grant mode tickets** grants Regular or Tournament tickets with an audit reason. Only the admin can grant them. Existing game permissions, point awards, chip retirement and no-cash-out rules are unchanged.

**Settings** changes defaults for newly created games:

| Setting | Default | Bounds |
| --- | --- | --- |
| Regular starting chips | 2,000 | 100–1,000,000 |
| Regular small blind | 10 | 1–50,000 |
| Regular big blind | 20 | 2–100,000; at least 2× SB |
| Regular action seconds | 45 | 10–120 |
| Tournament prize points per entry | 1,000 | 1–1,000,000 |

The starting stack must cover at least 10 BB. Existing tables keep the settings captured on creation. Tournament points lock when registration opens; hosts may choose the published contribution at creation. Tournament gameplay rules remain 15-minute levels, 5,000 chips, 20-second actions, two +20s time cards, BB ante, Level 6 rebuy cutoff and one 10-minute break. There is no live stack or deck editor.

## Persistence and clock

`data/riverroom.sqlite` stores local accounts, sessions, club state, tickets, points and history. The data directory and generated `local-dist/` are Git-ignored. All tracked SQL migrations are applied once on startup, with recorded hashes; schema changes are not silently reapplied. Previously deployed Sites data and preview/demo databases are not imported.

An internal clock runs every second, advancing all tables even without connected browsers. It calls the same transaction/invariant code as player actions and does not spend a player's read-rate allowance. Practice bot tables also progress. Regular hosts still choose when to deal the next hand; tournament hands start automatically under the existing rules. The clock stops when the process stops or the PC sleeps. On restart, saved deadlines resume; tournament wall-clock blind schedules can advance. This is not an always-on Windows service.

Stop the server before copying the entire `data` folder for a backup. Keep SQLite `-wal`/`-shm` sidecars if present. Password/session data is sensitive and must not be committed or shared publicly. The SQLite file is not encrypted; Windows account and disk protection remain the operator's responsibility.

Optional PowerShell configuration:

```powershell
$env:PORT = '3001'
$env:RIVERROOM_DB = 'D:\Poker\private-data\riverroom.sqlite'
npm start
```

The host remains fixed at 127.0.0.1. Use one server process per database. To update, stop it, pull code, run `npm ci` if dependencies changed, rebuild with `npm run build:local`, then restart. Back up before upgrading because migrations can remove retired data.

## Boundaries

Local mode ignores browser identity/role headers and uses authenticated server sessions. Host and Origin checks block off-site mutation and DNS-rebinding hostnames. CSP/frame restrictions, bounded JSON bodies and the existing game authorization, replay, CAS and audit protections remain active. It does not provide multi-factor authentication, password-reset email, anti-collusion, TLS, remote hosting or a security audit. Do not expose this HTTP listener through a proxy/tunnel as an internet service without implementing and testing the remote-hosting security setup.


## Attack regression checks

See [SECURITY-ATTACK-TEST.md](SECURITY-ATTACK-TEST.md) for the controlled attack simulation and its confirmed availability fix. Network bodies are read outside the serialized game/database queue, with a three-second deadline, 8 KiB body limit, and 32-reader cap. The operation queue is limited to 64 pending operations and the listener to 128 connections. These are local resource bounds, not a public-scale denial-of-service guarantee.
