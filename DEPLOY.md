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

Only the backend goes to the server (the frontend stays on Vercel; the full project is never copied to the server). Two options:

**Option 1 — single EXE (recommended, no Node.js on the server)**
`npm run build:exe` on your Mac/PC produces `dist/ExportDesk-server-win-x64.exe` (~100 MB). Copy it to the server as `C:\ExportDesk\ExportDesk-server.exe` together with `.env`, `install.ps1` and `Caddyfile`, then run `.\install.ps1` (it detects the exe and registers the auto-start task). No `node_modules`, nothing to scan or index.

**Option 2 — source folder**

1. Copy `server/` to the server as `C:\ExportDesk` (contents: `index.js`, `routes\`, `package.json`, `.env`, optionally `node_modules\`). Run `npm install --omit=dev` inside it if `node_modules` was not included.
2. Create `.env` from `.env.example` and fill in:
   - `REGISTRY_SERVER` / `REGISTRY_USER` / `REGISTRY_PASSWORD` → your own SQL Server (the registry DB `ExportDeskLink` and table `exportdesklink` are created automatically).
   - `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` → your sign-in for the Clients page.
   - `SECRET_KEY` → any long random string (keeps sessions valid across restarts and encrypts client DB passwords).
   - `COOKIE_SECURE=1` once you are behind HTTPS.
3. Run permanently — Windows: PowerShell (Admin) in `C:\ExportDesk` → `.\install.ps1` (registers the auto-start task `ExportDeskAPI`, opens the firewall port; `-Domain api.yourdomain.com` also sets up Caddy HTTPS). Linux: `pm2 start index.js --name exportdesk`.
4. Make port 4000 reachable from the internet (router port-forward), or use `-Domain` for HTTPS. Check `GET /api/health` → `{"ok":true,"mode":"multi"}`.

## Part B — Frontend on Vercel

1. `vercel.json` rewrites `/api/*` to the backend (`http://<server-ip>:4000` or `https://api.yourdomain.com`). The PDF libraries are shipped in `public/vendor/`, so the frontend needs nothing else from the backend.
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
