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

// ── Supabase data helpers ──────────────────────────────────────────
async function fetchInventory() {
  const { data, error } = await db
    .from('inventory')
    .select('*')
    .eq('active', true)
    .order('name');
  if (error) throw new Error(error.message);
  return data || [];
}

async function createSale(patientName, paymentMethod, cart) {
  const p_items = cart.map(item => ({
    id: item.id,
    name: item.name,
    category: item.category,
    qty: Number(item.qty) || 1,
    price: Number(item.price) || 0,
  }));
  const { data, error } = await db.rpc('create_sale', {
    p_patient_name: String(patientName || '').trim(),
    p_payment_method: paymentMethod,
    p_items,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function restockItem(itemId, qtyToAdd) {
  const { data, error } = await db.rpc('restock_item', {
    p_item_id: itemId,
    p_qty_to_add: qtyToAdd,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function addInventoryItem(fields) {
  const { error } = await db.from('inventory').insert(fields);
  if (error) throw new Error(error.message);
}

async function updateInventoryItem(id, fields) {
  const { error } = await db.from('inventory').update(fields).eq('id', id);
  if (error) throw new Error(error.message);
}

async function deleteInventoryItem(id) {
  const { error } = await db.from('inventory').update({ active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

async function fetchHistory() {
  const { data, error } = await db
    .from('invoices')
    .select('*, sale_items(*)')
    .order('sold_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

function formatSoldAtDate(sold_at) {
  const d = new Date(sold_at);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
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

function parseDMYParts(dmyStr) {
  if (!dmyStr) return null;
  const parts = String(dmyStr).trim().split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (!day || !month || !year) return null;
  return { day, month, year };
}

function dmyToNumber(parts) {
  return parts.year * 10000 + parts.month * 100 + parts.day;
}

function parseFilterDate(dmyStr) {
  return parseDMYParts(dmyStr);
}

function getCurrentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: formatDateFromParts(first), to: formatDateFromParts(last) };
}

function getLastMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: formatDateFromParts(first), to: formatDateFromParts(last) };
}

function getTodayRange() {
  const d = formatDateFromParts(new Date());
  return { from: d, to: d };
}

function getYesterdayRange() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const d = formatDateFromParts(y);
  return { from: d, to: d };
}

function getThisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: formatDateFromParts(monday), to: formatDateFromParts(sunday) };
}

function getDateRangePreset(preset) {
  switch (preset) {
    case 'today': return getTodayRange();
    case 'yesterday': return getYesterdayRange();
    case 'this-week': return getThisWeekRange();
    case 'this-month': return getCurrentMonthRange();
    case 'last-month': return getLastMonthRange();
    default: return getCurrentMonthRange();
  }
}

const ALL_CATEGORIES = ['Medicine', 'Snack', 'Other'];

function dateInRange(dateStr, fromDMY, toDMY) {
  if (!fromDMY && !toDMY) return true;
  const normalized = formatDate(dateStr);
  const d = parseDMYParts(normalized);
  if (!d) return true;
  const dn = dmyToNumber(d);
  const from = parseDMYParts(fromDMY);
  const to = parseDMYParts(toDMY);
  if (from && dn < dmyToNumber(from)) return false;
  if (to && dn > dmyToNumber(to)) return false;
  return true;
}

function formatTimeDisplay(timeVal) {
  if (timeVal == null || timeVal === '') return '—';
  const s = String(timeVal).trim();
  if (!s) return '—';
  if (s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Karachi',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(d);
    }
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = parseFloat(s);
    if (num >= 0 && num < 1) {
      const totalMins = Math.round(num * 24 * 60);
      const h24 = Math.floor(totalMins / 60);
      const mins = String(totalMins % 60).padStart(2, '0');
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 || 12;
      return `${h12}:${mins} ${ampm}`;
    }
  }
  return s;
}

function categoryClass(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'medicine') return 'medicine';
  if (c === 'snack') return 'snack';
  return 'other';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Active nav link ──────────────────────────────────────────────
function setActiveNav(page) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}
