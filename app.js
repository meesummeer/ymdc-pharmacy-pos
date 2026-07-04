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

// ── Sale payload builder ─────────────────────────────────────────
function buildSaleData(cart, patientName) {
  return {
    action: 'sale',
    patientName: String(patientName || '').trim(),
    items: cart.map(item => ({
      name: String(item.name || ''),
      category: String(item.category || ''),
      qty: Number(item.qty) || 1,
      price: Number(item.price) || 0,
    })),
  };
}

function syncCartFromDOM(cartBody, cart) {
  if (!cartBody) return cart;
  cartBody.querySelectorAll('tr').forEach((row, idx) => {
    if (!cart[idx]) return;
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    if (qtyInput) cart[idx].qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    if (priceInput) cart[idx].price = Math.max(0, parseFloat(priceInput.value) || 0);
  });
  return cart;
}

// ── Formatting ───────────────────────────────────────────────────
function formatPKR(amount) {
  const n = Number(amount) || 0;
  return 'PKR ' + n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDateFromParts(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
  }
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
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDate(dateStr) {
  const d = parseSheetDate(dateStr);
  if (!d) return dateStr || '';
  return formatDateFromParts(d);
}

function parseFilterDate(dmyStr) {
  if (!dmyStr) return null;
  const parts = String(dmyStr).trim().split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function getCurrentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatDateFromParts(first), to: formatDateFromParts(last) };
}

function dateInRange(dateStr, fromDMY, toDMY) {
  if (!fromDMY && !toDMY) return true;
  const d = parseSheetDate(dateStr);
  if (!d) return false;
  const from = parseFilterDate(fromDMY);
  const to = parseFilterDate(toDMY);
  if (from && d < from) return false;
  if (to) {
    const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
    if (d > toEnd) return false;
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
