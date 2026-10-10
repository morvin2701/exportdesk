/** Minimal .env loader (server/.env) — no dependency needed. Existing environment variables win. */
const fs = require('fs');
const path = require('path');
/** Directory for runtime files: next to the exe when packaged, else this folder. */
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const file = path.join(BASE_DIR, '.env');
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

module.exports = { BASE_DIR };
