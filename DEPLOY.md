# Deployment: frontend on Vercel · backend on YOUR server · data on each client's SQL Server

```
 Browsers ──HTTPS──▶ Vercel (public/)  ──rewrite /api──▶  YOUR server: Node backend (server/)
                                                              │
                                     registry DB on your SQL Server: table  exportdesklink
                                     (one row per client: code, name, THEIR SQL Server address + login)
                                                              │
                              ┌───────────────────────────────┼──────────────────────────────┐
                              ▼                               ▼                              ▼
                 Client A PC: SQL Server            Client B PC: SQL Server           Client C …
                 database ExportDesk_A              database ExportDesk_B
```

- You add a client on the **Clients** page (sign in as *platform owner*). The client's invoices, settings and users live only in **their** SQL Server; your server stores just the connection details (password encrypted).
- The client needs **no installation** — only SQL Server on their PC, reachable from your server (see Part C).
- If a client's PC is off, that client's app is unavailable until it is back; other clients are unaffected.

---

## Part A — Backend on your server (Windows or Linux)

1. Copy the project, run `npm install --omit=dev`.
2. Create `server/.env` from `server/.env.example` and fill in:
   - `REGISTRY_SERVER` / `REGISTRY_USER` / `REGISTRY_PASSWORD` → your own SQL Server (the registry DB `ExportDeskLink` and table `exportdesklink` are created automatically).
   - `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` → your sign-in for the Clients page.
   - `SECRET_KEY` → any long random string (keeps sessions valid across restarts and encrypts client DB passwords).
   - `COOKIE_SECURE=1` once you are behind HTTPS.
3. Run permanently: `npm i -g pm2 && pm2 start server/index.js --name exportdesk && pm2 save`
   (Windows alternative: `.\install.ps1` registers a scheduled task; `.\install.ps1 -Domain api.yourdomain.com` also sets up Caddy HTTPS.)
4. Reverse proxy with HTTPS (Caddy / nginx / IIS) → `https://api.yourdomain.com`. Check `GET /api/health` → `{"ok":true,"mode":"multi"}`.

## Part B — Frontend on Vercel

1. In `vercel.json` replace `YOUR-BACKEND-DOMAIN` with `api.yourdomain.com` (both rewrites).
2. Import the GitHub repo on Vercel: framework **Other**, no build command, output directory `public` (already set).
3. Open the Vercel URL → *Platform owner sign-in* (link at the bottom of the login card) → **Clients** page.

Optional: one Vercel project per client with `public/js/config.js` → `tenant: 'ACME'` hides the company-code field.

## Part C — Onboarding a client (what the client must do: only SQL Server)

On the client's PC (one time):
1. Install SQL Server Express + SSMS. In SSMS: Server Properties → Security → **SQL Server and Windows Authentication mode**; enable the `sa` login (or create a login with `dbcreator`).
2. SQL Server Configuration Manager → Protocols for SQLEXPRESS → **TCP/IP = Enabled** → IP Addresses tab → *IPAll* → clear *TCP Dynamic Ports*, set **TCP Port = 1433** → restart the SQL Server service.
3. Windows Firewall: allow inbound TCP **1433**.
4. Router: **port-forward TCP 1433** to the PC's LAN IP. Note the client's **public IP** (or set up a DDNS hostname if the IP changes).

Then either:
- **You do it**: Clients → *Add client* → enter name, code and the SQL address `publicIP,1433` + login → *Test* → *Create database* → *Users → Create first admin* → send them code + email + password.
- **Client does it**: Clients → *Add client* (name + code only) → *Activation key* → send them the setup link + key. They enter their SQL address, the app creates the database, they create their own admin.

Clients sign in with **company code + email + password**.

---

## Troubleshooting a client connection
| Message | Fix |
|---|---|
| Could not reach the SQL Server instance | Port forward / firewall / TCP-IP not enabled / SQL service stopped |
| Instance not found | Use `ip,1433` instead of `ip\SQLEXPRESS` (UDP 1434 is usually not forwarded) |
| Login failed | Mixed-mode auth not enabled, login disabled, or wrong password |
| Host not found | A Windows computer name was entered; use the public IP / DDNS name |

## Single-client mode (unchanged)
Leave `REGISTRY_SERVER` empty: the app runs for one company with the in-app wizard (`start.bat` on the client's PC).
