# Deployment: frontend on Vercel, backend + database on the client's PC

```
 Browsers (anywhere) ──HTTPS──▶ Vercel  (public/: index.html, css, js)
                                   │  rewrite  /api/*  and  /vendor/*
                                   ▼
                 Client's Windows PC  ──▶  Node backend (server/index.js, port 4000)
                                                │
                                                ▼  WIN-PC\SQLEXPRESS
                                           SQL Server (database ExportDesk) — stays on the client's PC
```

- Sign-in works with a session token in the `Authorization` header **and** a cookie, so it works through the Vercel proxy in every browser (Safari / iPhone included).
- Invoices, settings, users: everything is stored in the SQL Server database on the client's PC. Nothing is stored on Vercel.

---

## Part A — Backend on the client's Windows PC

### A1. Install (one time, as Administrator)
1. Copy the whole project folder to the PC (e.g. a USB stick or a zip of the Git repo).
2. Open **PowerShell as Administrator** in that folder and run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\install.ps1
   ```
   This installs Node.js if needed, copies the app to `C:\ExportDesk`, opens the firewall port, and registers the task **ExportDeskAPI** that runs at boot and auto-restarts.
3. Open `http://localhost:4000` on that PC → the **setup wizard** appears: enter `WIN-PC\SQLEXPRESS`, the SQL login and password, database `ExportDesk` → *Test connection* → *Create database & continue* → create the admin account.
   (Alternatively put `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` in `C:\ExportDesk\server\.env` before running the installer — then the wizard is skipped.)

### A2. Make the backend reachable from the internet (so Vercel can proxy to it)
Choose **one**:

| Option | How | Result |
|---|---|---|
| **Public IP + port forwarding** (simplest) | On the client's router forward TCP **4000** → the PC's LAN IP. Needs a static/public IP from the ISP. | `http://<public-ip>:4000` |
| **Domain + Caddy HTTPS** (cleanest) | DNS A record `api.client.com` → public IP; forward **80/443**; run `.\install.ps1 -Domain api.client.com` | `https://api.client.com` |
| **Cloudflare Tunnel** (no port forwarding) | Install `cloudflared`, create a tunnel from `api.client.com` to `http://127.0.0.1:4000` | `https://api.client.com` |

Check from any phone/PC outside the office: `http(s)://<address>/api/health` must return `{"ok":true,...}`.

---

## Part B — Frontend on Vercel

1. In `vercel.json` set the two rewrite destinations to the backend address from A2, e.g.
   ```json
   { "source": "/api/:path*",    "destination": "http://103.49.124.50:4000/api/:path*" },
   { "source": "/vendor/:path*", "destination": "http://103.49.124.50:4000/vendor/:path*" }
   ```
   (`https://api.client.com/...` if you used Caddy or a tunnel.)
2. Push to GitHub. Import the repo on Vercel: framework **Other**, no build command, output directory **public** (already in `vercel.json`).
3. Open the Vercel URL → sign in with the admin created in A1. The top bar shows the SQL Server instance name.

Because `/api` is rewritten by Vercel, the browser only ever talks to the Vercel domain: no CORS, no mixed-content problem even when the backend is plain HTTP.

### One client, one backend
Each client has their own PC + SQL Server. For a second client, deploy another Vercel project (or a second branch) with its own `vercel.json` destination.

---

## Updating later
- **Frontend**: push to GitHub → Vercel redeploys automatically.
- **Backend**: copy the new files to the PC and run `.\install.ps1` again (it restarts the task), or restart task **ExportDeskAPI** in Task Scheduler.
- Logs: `C:\ExportDesk\server.log`.

## Local / same-origin mode (no Vercel)
`start.bat` on the PC serves frontend + API together at `http://<pc-ip>:4000` for the office LAN. Nothing else to configure.
