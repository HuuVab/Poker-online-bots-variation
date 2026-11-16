# Private internet hosting preparation

The hardening is implemented locally. **No domain, tunnel, Access application, firewall rule, or public audience has been activated.** A real domain will be purchased later. Do not substitute a quick public tunnel for the configured private application.

## What the public profile enforces

- The Node origin still binds only to **127.0.0.1**. No router port forwarding is needed.
- `RIVERROOM_MODE=public` requires one exact HTTPS origin, one Cloudflare Access team issuer, and the exact application AUD tag. It refuses startup without a locally created admin and verified authenticator enrollment.
- Every public request, including assets, requires a signed RS256 Access application JWT with the configured issuer/audience, expiry, issuance time, subject and email. Service tokens without a human email are not accepted. Keys are fetched only from the configured team's JWKS endpoint, with bounded timeouts and caching. The configured Access session must be no longer than 24 hours; use eight hours initially.
- The origin accepts the public Host only through the loopback proxy with HTTPS forwarding. `X-Forwarded-For` is ignored. The Cloudflare client IP is used only after the signed gateway identity is verified. Local mode rejects proxy/forwarding headers entirely to prevent accidental tunnel exposure.
- The gateway email must match the local account at login. A public session is bound to the signed gateway subject/email, preventing a session copied to a different gateway identity from authenticating.
- Public cookies use `__Host-river_session`, `Secure`, HttpOnly, SameSite=Strict, Path=/ and no Domain attribute. Public responses include HSTS. Mutations require the exact configured Origin.
- Public sessions expire after six hours or 30 minutes idle. Admin login requires an authenticator or unused recovery code. Sensitive admin actions additionally require password/MFA confirmation within ten minutes. Hosts cannot use admin endpoints.
- Setup is available only in local mode before the first admin exists. Public registration is disabled. There is no MFA-disable endpoint.
- Untrusted bodies remain outside the serialized database queue. Body deadlines, size/reader/connection/queue caps, ingress limits, per-account game limits and authentication throttling remain active. Clock jobs receive queue priority.

This remains a small invitation-only club, not a certified payment platform or a public-scale denial-of-service service.

## 1. Complete setup locally

Start with `npm start` and open http://localhost:3000. Create the admin if needed. In **Account and server management → Admin security**, confirm your password, add the generated secret to an authenticator app, and submit its current six-digit code. Save the ten recovery codes securely; they are shown once and each works once. The app encrypts the authenticator seed with `data/security.key`; it stores only hashes of recovery codes. TOTP codes cannot be replayed. Existing other sessions are revoked when MFA is enabled.

The operator must enter their own password and authenticator codes. No production MFA seed or default credential is pre-enrolled by the implementation. Losing the authenticator, recovery codes and encryption key can prevent recovery; protect them separately.

Run the server using a standard Windows account, keep Windows/Node updated, and restrict private storage:

```powershell
powershell -NoProfile -File server/protect-data.ps1
```

This restricts the selected `data` directory and its files to the current Windows account, SYSTEM and Administrators. It rejects symbolic links/reparse points. Do not grant other users access to the database, security key, backups or tunnel credentials. An administrator or malware controlling the Windows account remains trusted by this design.

## 2. Configure the real domain and access gate later

After buying the domain:

1. Configure the domain in Cloudflare and create a self-hosted **Access application for the entire poker hostname**, including `/api/*` and assets.
2. Add an explicit allowlist of invited players' exact email addresses. Do not use Everyone, bypass policies, public signup or a service-token bypass. Require MFA at the identity provider where available, especially for the admin. The app's admin TOTP remains required independently.
3. Choose an eight-hour Access session duration. Copy the team origin and exact application AUD tag.
4. Create a named Cloudflare Tunnel to `http://127.0.0.1:3000`. Use `server/cloudflared.example.yml` as a template, replacing every placeholder. Keep credentials private and use the latest supported cloudflared. Enable the tunnel's own Access validation as well as the app's validation. Preserve the public Host using `httpHostHeader`. End ingress with the 404 fallback. Do not disable TLS certificate verification.
5. Copy `server/public.env.example` to `server/public.env` and fill the real HTTPS origin, team origin and AUD. It is Git-ignored. No cloud API credentials or tunnel tokens belong in source control.

The implementation follows Cloudflare's [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [origin/Access parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/). Gateway policy and DNS must still be configured and tested on the actual account; code cannot establish those external settings by itself.

## 3. Backups, logs and restart

Normal startup makes a verified encrypted SQLite snapshot before listening, then schedules another every six hours. The newest 14 `.rrbackup` files are retained under `data/backups`. Each snapshot is checked with SQLite integrity checking and encrypted with AES-256-GCM. Public-mode backup scratch storage must remain under the private database directory. Temporary plaintext snapshot files are used inside that private storage directory and removed after completion. Backups on the same disk do not protect against disk loss: copy encrypted snapshots off-device and keep a separately protected copy of `security.key`. No off-device destination or automatic upload is configured.

Test recovery to a **new** filename:

```powershell
npm run restore -- --file data/backups/YOUR-SNAPSHOT.rrbackup --output data/restored.sqlite --key data/security.key
```

The restore refuses an existing output, checks authenticated decryption and SQLite integrity, and revokes saved sessions. Stop the server before changing `RIVERROOM_DB` to the verified restored file. Do not overwrite the live database during recovery. Never regenerate a lost key and expect it to decrypt old backups or MFA seeds.

Security events omit credentials, codes, cookies and JWTs. The latest 10,000 events are retained locally; the admin can view recent events after step-up. Ten denials in a minute produce a structured stderr alert. Clock/backup failures also generate events and errors. Protect log files and configure external alert forwarding/monitoring before unattended public operation; no email/SMS/webhook destination has been configured.

`npm run serve:managed` starts the restart supervisor. `npm run serve:public` loads `server/public.env` and uses the same supervisor. It checks the minimal loopback-only `/healthz`, restarts after repeated unhealthy checks or process failure, and stops after five failures in ten minutes. Clock jobs get priority over normal queued operations. A per-database PID lock prevents two entry-point processes from opening the same live database. Windows sleep or shutdown still stops service.

For unattended operation, run the supervisor under your standard account using a Windows startup task and configure protected stdout/stderr capture. A Windows service/startup task is not installed automatically. Do not run the app as Administrator or expose the Vite/Vinext development server.

## 4. Readiness and final remote validation

With the public environment configured:

```powershell
node --env-file=server/public.env server/readiness.mjs
npm test
npm audit --omit=dev
npm run build:local
npm run serve:public
```

The readiness command checks the exact domain/issuer/audience configuration, existing admin/MFA/key, SQLite integrity, private Windows storage permissions and the built client. It does not claim to verify external Cloudflare policy, DNS, TLS or internet availability.

Before inviting players, test from another network/device: unauthenticated visitors must hit Access, uninvited email addresses must be denied, invited identities must match their local accounts, admin MFA and step-up must be required, HTTP must redirect to HTTPS, secure cookies must be present, and direct origin/public-signup bypasses must fail. Exercise reconnects and the three-table tournament through the real tunnel, and repeat a backup restore. Confirm edge rate limits and monitoring appropriate to the chosen hosting plan.

## Validation completed locally

Automated tests use independent accounts and locally signed synthetic gateway tokens. They cover MFA enrollment/replay, single-use recovery, JWT signatures/audience/expiry, identity-bound sessions, step-up, idle expiry, setup denial, redacted audit data, health probes, encrypted restore and corruption rejection. A bounded HTTP load fixture uses 27 sessions, three nine-seat tables and 54 concurrent polls. These are local tests, not a completed remote penetration test or real-network capacity guarantee.


Security update validation: the full regression suite passes, standalone and retained hosted builds complete, schema tooling checks pass, and the complete npm advisory audit (including development tools) reports zero known findings at this review. Dependency updates include the framework/React/build stack plus scoped patches for esbuild, fflate and minimatch; future advisories still require ongoing maintenance.
