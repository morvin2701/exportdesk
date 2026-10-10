# ExportDesk — Export Invoice Generator

A dynamic sales-invoice generator for import / export businesses. Every company's data lives in **its own Microsoft SQL Server** (the instance you manage in SSMS).

Two ways to run it:
- **Single-client**: the app runs on the company's own PC (`start.bat`, in-app setup wizard). Sections 1–4 below.
- **Multi-client (SaaS style)**: frontend on Vercel, one backend on your server, a `exportdesklink` registry table listing each client and *their* SQL Server. You onboard clients from the **Clients** page. See **[DEPLOY.md](DEPLOY.md)**.

- **Invoice editor** – fill in consignee, shipment, goods and charges; the A4 invoice builds itself live with your logo, stamp and signature. Print or download as PDF.
- **Saved invoices** – search, filter, status (unpaid / partial / paid), duplicate, delete, quick preview.
- **Settings** – company profile, logo / stamp / signature, numbering, defaults, bank accounts, terms, database connection.
- **Team** – admin & staff logins, activity log.

---

## 1. Requirements (on the PC that will run it)

| Software | Notes |
|---|---|
| **Node.js 18+** (LTS) | https://nodejs.org — install with default options |
| **SQL Server** (Express is fine) + **SSMS** | Any edition 2016 or newer. A named instance such as `SQLEXPRESS` works. |

## 2. Prepare SQL Server (one time, 3 minutes)

1. **Enable TCP/IP** – open *SQL Server Configuration Manager* → *SQL Server Network Configuration* → *Protocols for &lt;INSTANCE&gt;* → right-click **TCP/IP** → *Enable*. Restart the SQL Server service.
2. **Start SQL Server Browser** (needed for named instances like `\SQLEXPRESS`) – *Services* → *SQL Server Browser* → Startup type **Automatic** → Start.
3. **Allow SQL logins** – in SSMS right-click the server → *Properties* → *Security* → **SQL Server and Windows Authentication mode** → OK → restart the service.
4. **Create / enable a login** – SSMS → *Security* → *Logins* → right-click **sa** → *Properties*:
   - *General*: set a password
   - *Status*: Login **Enabled**

   (Or create a new login with `dbcreator` server role.)

## 3. Run ExportDesk

```
1. Copy this folder anywhere, e.g. C:\ExportDesk
2. Double-click  start.bat        (Mac: start.command)
```

The first run installs the backend dependencies into `server/node_modules` (needs internet once) and opens http://localhost:4000 in your browser.
If the PC has no internet, copy the folder **including `server/node_modules`** from a machine where `npm install` was already run — the dependencies are pure JavaScript and work on Windows and Mac alike.

The **setup wizard** appears:

1. **Connect SQL Server** – type the instance exactly as in SSMS, e.g. `DESKTOP-PC\SQLEXPRESS` or `.\SQLEXPRESS`, choose authentication, enter the login, pick a database name (default `ExportDesk`). Click *Test connection*, then *Create database & continue*. The database and all tables are created automatically and the connection is remembered in `server/config/db.json`.
   - *SQL Server Authentication* (recommended): the `sa` login or any login with `dbcreator`.
   - *Windows Authentication*: your Windows user name and password; the domain defaults to the PC name.
   - Encryption is on by default and self-signed certificates are accepted; if the server cannot negotiate TLS the app falls back automatically.
2. **Admin account** – company name, your name, email and password.
3. Done. Go to **Settings** to upload your logo, stamp and signature and add bank details, then create your first invoice.

Other PCs on the same network can open the app via the *Network* URL printed in the console window (e.g. `http://192.168.1.10:4000`).

## 4. Everyday use

- **New invoice**: `N` key or the *New Invoice* button. `Ctrl+S` saves.
- **Numbering**: automatic (`EXP-INV-2026-0001` style, configurable in Settings → Numbering). Type a custom number any time.
- **Customers** are remembered automatically – start typing the consignee name to reuse details.
- **PDF / Print** from the preview toolbar on the editor, or from the eye icon on *Saved Invoices*.

## 5. Deploying: frontend on Vercel, backend on the client's PC

See **[DEPLOY.md](DEPLOY.md)** for the step-by-step guide (installer script, port forwarding / Caddy / Cloudflare Tunnel, Vercel rewrites).

### Summary

The frontend (`public/`) is plain static files; the backend (`server/`) is a Node API that talks to SQL Server.

### Backend (your server — Windows or Linux)
1. Copy the whole folder, run `npm install --omit=dev`.
2. Copy `server/.env.example` to `server/.env` and set:
   - `PORT=4000`
   - `COOKIE_SECURE=1` (you will be behind HTTPS)
   - optionally the `DB_*` variables so the SQL Server connection is fixed from the server (otherwise use the in-app wizard once).
3. Run it permanently, e.g. with pm2: `npm i -g pm2 && pm2 start server/index.js --name exportdesk && pm2 save`.
4. Put HTTPS in front of it (Caddy, nginx or IIS reverse proxy) so it is reachable at `https://api.yourdomain.com`. `GET /api/health` must return `{"ok":true}`.

> The backend must be able to reach the SQL Server instance (same machine, or TCP 1433 / UDP 1434 open to it).

### Frontend (Vercel) — option A, recommended: proxy through Vercel rewrites
1. In `vercel.json` replace `YOUR-BACKEND-DOMAIN` with your API host (e.g. `api.yourdomain.com`).
2. Deploy the repo on Vercel with **no build command** and output directory `public` (already set in `vercel.json`).
3. Done — `/api/*` and `/vendor/*` are proxied to your server, cookies stay first-party, no CORS needed. `CORS_ORIGIN` can stay empty.

### Frontend (Vercel) — option B: call the API directly (cross-origin)
1. In `public/js/config.js` set `window.XD_CONFIG.apiBase = 'https://api.yourdomain.com'` and remove the `rewrites` from `vercel.json`.
2. In `server/.env` set `CORS_ORIGIN=https://your-app.vercel.app`, `COOKIE_SAMESITE=none`, `COOKIE_SECURE=1` (HTTPS required on the API).

### All-in-one (no Vercel)
Just run the Node server: it serves the frontend and the API from the same port (`http://server:4000`). This is what `start.bat` does.

## 6. Project layout

```
server/            Backend API (Node) – self-contained: own package.json, index.js entry point, install.ps1. Only this folder is deployed to the server.
server/db.js       SQL Server connection, registry (exportdesklink) + automatic schema creation
server/.env        Backend settings (port, REGISTRY_*, PLATFORM_ADMIN_*, cookies, optional DB_*) – see .env.example
server/config/     db.json / secret.json (single-client mode) – do not share
public/            Frontend (no build step, deployed to Vercel): css/, js/, js/pages/, vendor/ (PDF libs); js/config.js holds the API base URL
vercel.json        Vercel static deployment + rewrite that proxies /api to the backend
```

Change the port with the `PORT` environment variable (default 4000).

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| *Could not reach the SQL Server instance* | SQL Server service running? TCP/IP enabled? SQL Server Browser running (named instance)? |
| *Login failed* | Mixed-mode authentication enabled and the login is *Enabled* with the right password. |
| *CREATE DATABASE permission denied* | Use `sa` or give the login the `dbcreator` role, or create the database in SSMS first and enter its name. |
| App opens but says "Server not reachable" | The console window was closed – run `start.bat` again. |
| Forgot admin password | Another admin can reset it from *Team*. If no admin is available, run in SSMS: `DELETE FROM ExportDesk.dbo.users` and restart – the wizard will ask for a new admin. |
