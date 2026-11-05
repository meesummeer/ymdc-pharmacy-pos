/* Cloud backup (Hub, admin-only): every row of every table -> one zip -> Cloudflare R2 via the backup Worker.
   Relies on app.js (db, fetchAllPages, currentUser, BACKUP_WORKER_URL, BACKUP_TABLES) and JSZip. Never logs row contents. */

const BK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let bkZipBlob = null;
let bkZipName = '';
let bkBusy = false;

const bkEl = id => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────────
function bkKarachiParts(date) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  return parts;
}

function bkFileName(date) {
  const p = bkKarachiParts(date);
  return `PharmacyPilot-backup-${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}.zip`;
}

function bkFormatDateTime(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function bkFormatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function bkToken() {
  const { data } = await db.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error('You are signed out. Sign in again and retry.');
  return token;
}

function bkCsvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Spreadsheet formula guard: text only, so negative numbers stay numbers.
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function bkToCsv(rows) {
  const columns = [];
  rows.forEach(r => Object.keys(r).forEach(k => { if (!columns.includes(k)) columns.push(k); }));
  const lines = [columns.map(bkCsvCell).join(',')];
  rows.forEach(r => lines.push(columns.map(c => bkCsvCell(r[c])).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function bkSha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const BK_RESTORE_README = `PharmacyPilot backup - restore notes

- sale_items.line_total and staff_credit.total are generated columns. Skip them when importing.
- Restore in this order: inventory, invoices, sale_items, request_stock, expenses, staff, staff_credit.
- Each table is included as <table>.json (exact data) and <table>.csv (for spreadsheets; text cells that start with = + - or @ are prefixed with a single quote).
- manifest.json lists when the backup was made, who ran it, and the row count of every table.
`;

// ── Last backup line ─────────────────────────────────────────────
async function bkRefreshLast() {
  const lastEl = bkEl('backup-last');
  const warnEl = bkEl('backup-warn');
  try {
    const res = await fetch(`${BACKUP_WORKER_URL}/list`, { headers: { Authorization: `Bearer ${await bkToken()}` } });
    if (!res.ok) throw new Error('list ' + res.status);
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) {
      lastEl.textContent = 'Last cloud backup: none yet';
      warnEl.style.display = '';
      return;
    }
    const newest = items[0];
    lastEl.textContent = `Last cloud backup: ${bkFormatDateTime(newest.uploaded)} · ${bkFormatSize(newest.size)}`;
    warnEl.style.display = Date.now() - new Date(newest.uploaded).getTime() > BK_MAX_AGE_MS ? '' : 'none';
  } catch {
    lastEl.textContent = "Couldn't check the last backup";
    warnEl.style.display = 'none';
  }
}

// ── Backup run ───────────────────────────────────────────────────
function bkProgress(text) {
  const el = bkEl('backup-progress');
  el.textContent = text;
  el.style.display = text ? '' : 'none';
}

function bkResult(text, kind) {
  const el = bkEl('backup-result');
  el.textContent = text;
  el.className = 'backup-result ' + (kind || '');
  el.style.display = text ? '' : 'none';
}

async function bkFetchTables() {
  const data = {};
  const counts = {};
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const table = BACKUP_TABLES[i];
    bkProgress(`Backing up ${table}… ${i + 1} of ${BACKUP_TABLES.length}. Don't close this tab.`);
    let rows;
    let expected;
    try {
      rows = await fetchAllPages(() => db.from(table).select('*').order('id'));
      const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      expected = count;
    } catch (err) {
      throw new Error(`FAILED on table "${table}": ${err.message}. Nothing was saved.`);
    }
    if (rows.length !== expected) {
      throw new Error(`FAILED on table "${table}": read ${rows.length} rows but the table has ${expected}. Nothing was saved. Try again.`);
    }
    data[table] = rows;
    counts[table] = rows.length;
  }
  return { data, counts };
}

async function bkBuildZip({ data, counts }, now, fileName) {
  const zip = new JSZip();
  BACKUP_TABLES.forEach(table => {
    zip.file(`${table}.json`, JSON.stringify(data[table]));
    zip.file(`${table}.csv`, bkToCsv(data[table]));
  });
  zip.file('manifest.json', JSON.stringify({
    created_at: now.toISOString(),
    file: fileName,
    run_by: currentUser ? currentUser.email : null,
    tables: counts,
  }, null, 2));
  zip.file('RESTORE-README.txt', BK_RESTORE_README);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
}

async function bkUpload(blob, fileName) {
  const sha = await bkSha256Hex(blob);
  let res;
  try {
    res = await fetch(`${BACKUP_WORKER_URL}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await bkToken()}`,
        'Content-Type': 'application/zip',
        'X-Sha256': sha,
        'X-Filename': fileName,
      },
      body: blob,
    });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (res.status === 201) return body;
  if (res.status === 409) throw new Error('A backup with this name already exists. Wait a minute and try again.');
  throw new Error(`Upload failed (${res.status}): ${(body && body.error) || res.statusText || 'unknown error'}`);
}

async function bkRun() {
  if (bkBusy) return;
  bkBusy = true;
  const btn = bkEl('backup-run');
  btn.disabled = true;
  bkEl('backup-download').style.display = 'none';
  bkResult('');
  bkZipBlob = null;
  try {
    const tables = await bkFetchTables();
    bkProgress('Building the backup file… Don\'t close this tab.');
    const now = new Date();
    bkZipName = bkFileName(now);
    bkZipBlob = await bkBuildZip(tables, now, bkZipName);
    bkProgress('Uploading to Cloudflare R2… Don\'t close this tab.');
    const saved = await bkUpload(bkZipBlob, bkZipName);
    bkProgress('');
    bkResult(`Saved to Cloudflare R2: ${saved.key} (${bkFormatSize(saved.size)})`, 'ok');
    bkZipBlob = null;
    await bkRefreshLast();
  } catch (err) {
    bkProgress('');
    bkResult(err.message, 'err');
    if (bkZipBlob) bkEl('backup-download').style.display = '';
  } finally {
    bkBusy = false;
    btn.disabled = false;
  }
}

function bkDownloadLocal() {
  if (!bkZipBlob) return;
  const url = URL.createObjectURL(bkZipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bkZipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Called once the Hub has confirmed an admin session; wired in its own try/catch so it can never break the page.
function wireCloudBackup() {
  try {
    bkEl('backup-run').addEventListener('click', bkRun);
    bkEl('backup-download').addEventListener('click', bkDownloadLocal);
  } catch { /* card missing: ignore */ }
}

async function loadCloudBackupCard() {
  try {
    if (typeof JSZip === 'undefined') {
      bkEl('backup-run').disabled = true;
      bkResult("Couldn't load the backup library. Reload the page.", 'err');
    }
    await bkRefreshLast();
  } catch { /* the card must never break the rest of Hub */ }
}
