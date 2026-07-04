/* Shared utilities for YMDC Pharmacy POS */

const STORE_NAME = 'Yaseen Medical & General Store';
const STORE_SHORT = 'YMDC';
const STORE_ADDRESS = 'MA Jinnah Road Karachi';
const STORE_WHATSAPP = '0335-6733777';

// ── Toast notifications ──────────────────────────────────────────
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── API helpers ──────────────────────────────────────────────────
async function apiGet(action) {
  const url = `${API_URL}?action=${encodeURIComponent(action)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function apiPost(body) {
  // text/plain avoids CORS preflight with Google Apps Script Web Apps
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Formatting ───────────────────────────────────────────────────
function formatPKR(amount) {
  const n = Number(amount) || 0;
  return 'PKR ' + n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (s.includes('/')) {
    const [d, m, y] = s.split('/');
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  }
  if (s.includes('-')) {
    const parts = s.split('-');
    if (parts[0].length === 4) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(dateStr) {
  const d = parseSheetDate(dateStr);
  if (!d) return dateStr || '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toInputDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toInputDate(first), to: toInputDate(last) };
}

function dateInRange(dateStr, fromIso, toIso) {
  const d = parseSheetDate(dateStr);
  if (!d) return true;
  if (fromIso) {
    const from = new Date(fromIso + 'T00:00:00');
    if (d < from) return false;
  }
  if (toIso) {
    const to = new Date(toIso + 'T23:59:59');
    if (d > to) return false;
  }
  return true;
}

function formatTime(timeStr) {
  return timeStr || '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Receipt HTML builder ─────────────────────────────────────────
function buildReceiptHTML(invoice) {
  const rows = invoice.items.map(item => `
    <tr>
      <td>${escapeHtml(item.itemName)}</td>
      <td class="num">${item.qty}</td>
      <td class="num">${formatPKR(item.unitPrice)}</td>
      <td class="num">${formatPKR(item.lineTotal)}</td>
    </tr>
  `).join('');

  return `
    <div class="receipt">
      <div class="receipt-header">
        <h2>${STORE_NAME}</h2>
        <p class="receipt-short">${STORE_SHORT}</p>
        <p class="receipt-address">${STORE_ADDRESS}</p>
      </div>
      <div class="receipt-meta">
        <p><strong>Invoice:</strong> ${escapeHtml(invoice.invoiceNo)}</p>
        <p><strong>Date:</strong> ${escapeHtml(invoice.date)} &nbsp; <strong>Time:</strong> ${escapeHtml(invoice.time)}</p>
        ${invoice.patientName ? `<p><strong>Patient:</strong> ${escapeHtml(invoice.patientName)}</p>` : ''}
      </div>
      <table class="receipt-table">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Price</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="total-label">Total</td>
            <td class="num total-value">${formatPKR(invoice.total)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="receipt-footer">
        <p>WhatsApp: ${STORE_WHATSAPP}</p>
        <p>Thank you for your visit!</p>
      </div>
    </div>
  `;
}

function printReceipt(invoice) {
  const area = document.getElementById('print-area');
  area.innerHTML = buildReceiptHTML(invoice);
  window.print();
}

// ── Active nav link ──────────────────────────────────────────────
function setActiveNav(page) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}
