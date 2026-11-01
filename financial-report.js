/* Monthly Profit & Loss report (Hub, admin-only): data -> A4 HTML preview -> one-page PDF.
   Relies on app.js (db, fetchAllPages, fetchExpenses, normalizeCategory, escapeHtml, showToast, GENERAL_SUBCATEGORIES). */

const FR_NAME = 'Yaseen Medical & Diagnostic Centre';
const FR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FR_INCOME_ORDER = ['Medicine', 'Snack', 'Other'];
// Expense rows in report order; General is split by its type (subcategory).
const FR_EXPENSE_ROWS = [
  { key: 'Medicine', label: 'Medicine purchases' },
  { key: 'Beverage', label: 'Beverage purchases' },
  { key: 'Snacks', label: 'Snacks purchases' },
  { key: 'Ice Cream', label: 'Ice Cream purchases' },
  { key: 'General|Salary', label: 'Salaries' },
  { key: 'General|Rent', label: 'Rent' },
  { key: 'General|Utility Bill', label: 'Utility Bills' },
  { key: 'General|Repair', label: 'Repairs' },
  { key: 'General|Other', label: 'Other (General)' },
  { key: 'General|', label: 'General (no type)' },
];
const FR_UNCATEGORISED = { key: 'Uncategorised', label: 'Uncategorised' };
const FR_MIN_PROJECTION_DAYS = 3;
const FR_PAGE_W = 794; // A4 at 96dpi
const FR_PAGE_H = 1123;
const FR_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

let frModel = null;
let frLibsPromise = null;

// ── Dates (Asia/Karachi) ─────────────────────────────────────────
const frDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });

function frDayKey(date) { return frDayFmt.format(date); } // YYYY-MM-DD in Karachi

function frToday() {
  const [y, m, d] = frDayKey(new Date()).split('-').map(Number);
  return { y, m, d };
}

function frMonthKey(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }

function frShiftMonth(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

function frDaysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// Karachi is UTC+5 with no DST, so local midnight is 19:00Z the previous day.
function frKarachiStartISO(y, m) { return new Date(Date.UTC(y, m - 1, 1, -5)).toISOString(); }

function frMonthName(y, m) { return `${FR_MONTHS[m - 1]} ${y}`; }

function frDayLabel(dayKey) {
  const [, m, d] = dayKey.split('-').map(Number);
  return `${d} ${FR_MONTHS[m - 1].slice(0, 3)}`;
}

// ── Formatting ───────────────────────────────────────────────────
function frMoney(n) {
  const r = Math.round(Number(n) || 0);
  return (r < 0 ? '-' : '') + 'PKR ' + Math.abs(r).toLocaleString('en-US');
}

function frSigned(n) {
  const r = Math.round(Number(n) || 0);
  return (r < 0 ? '-' : '+') + 'PKR ' + Math.abs(r).toLocaleString('en-US');
}

function frPct(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }

function frPctText(p) { return p.toFixed(1) + '%'; }

// null when there is no base to compare against
function frChange(cur, prev) { return prev ? ((cur - prev) / Math.abs(prev)) * 100 : null; }

function frChangeText(cur, prev) {
  const c = frChange(cur, prev);
  if (c === null) return `${frSigned(cur - prev)}`;
  return `${c >= 0 ? 'up' : 'down'} ${Math.abs(c).toFixed(1)}%, ${frSigned(cur - prev)}`;
}

// ── Data ─────────────────────────────────────────────────────────
function frAggregate(invoices, expenses, monthKey) {
  const income = { byCat: {}, total: 0, invoiceCount: 0, daily: {} };
  invoices.forEach(inv => {
    const day = frDayKey(new Date(inv.sold_at));
    if (day.slice(0, 7) !== monthKey) return;
    let invTotal = 0;
    (inv.sale_items || []).forEach(li => {
      const amt = (Number(li.qty) || 0) * (Number(li.unit_price) || 0);
      const cat = normalizeCategory(li.category);
      income.byCat[cat] = (income.byCat[cat] || 0) + amt;
      invTotal += amt;
    });
    income.total += invTotal;
    income.invoiceCount += 1;
    const d = income.daily[day] || (income.daily[day] = { total: 0, count: 0 });
    d.total += invTotal;
    d.count += 1;
  });

  const exp = { byKey: {}, total: 0, count: 0 };
  expenses.forEach(e => {
    if (String(e.expense_date).slice(0, 7) !== monthKey) return;
    const amt = Number(e.amount) || 0;
    const key = e.category === 'General' ? `General|${e.subcategory || ''}` : e.category;
    const known = FR_EXPENSE_ROWS.some(r => r.key === key);
    const k = known ? key : FR_UNCATEGORISED.key;
    exp.byKey[k] = (exp.byKey[k] || 0) + amt;
    exp.total += amt;
    exp.count += 1;
  });
  return { income, exp, hasData: income.invoiceCount > 0 || exp.count > 0 };
}

async function frBuildReport(y, m) {
  const prev = frShiftMonth(y, m, -1);
  const next = frShiftMonth(y, m, 1);
  const startISO = frKarachiStartISO(prev.y, prev.m);
  const endISO = frKarachiStartISO(next.y, next.m);
  const fromDate = frMonthKey(prev.y, prev.m) + '-01';
  const toDate = frMonthKey(y, m) + '-' + String(frDaysIn(y, m)).padStart(2, '0');

  const [invoices, expenses] = await Promise.all([
    fetchAllPages(() =>
      db.from('invoices').select('id, sold_at, sale_items(category, qty, unit_price)')
        .gte('sold_at', startISO).lt('sold_at', endISO)
        .order('sold_at', { ascending: true }).order('id', { ascending: true })
    ),
    fetchExpenses(fromDate, toDate),
  ]);

  const today = frToday();
  const inProgress = today.y === y && today.m === m;
  return {
    y, m, prev,
    cur: frAggregate(invoices, expenses, frMonthKey(y, m)),
    prevAgg: frAggregate(invoices, expenses, frMonthKey(prev.y, prev.m)),
    daysInMonth: frDaysIn(y, m),
    daysElapsed: inProgress ? today.d : frDaysIn(y, m),
    inProgress,
    generated: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
  };
}

// ── Report rows + analysis (all derived from data) ───────────────
function frIncomeRows(agg) {
  const cats = FR_INCOME_ORDER.filter(c => agg.income.byCat[c]).concat(Object.keys(agg.income.byCat).filter(c => !FR_INCOME_ORDER.includes(c) && agg.income.byCat[c]));
  return cats.map(c => ({ label: c, amount: agg.income.byCat[c] }));
}

function frExpenseRows(agg) {
  return FR_EXPENSE_ROWS.concat([FR_UNCATEGORISED])
    .filter(r => agg.exp.byKey[r.key])
    .map(r => ({ label: r.label, amount: agg.exp.byKey[r.key] }));
}

function frTopRow(rows) {
  return rows.reduce((best, r) => (!best || r.amount > best.amount ? r : best), null);
}

function frAnalysis(model) {
  const { cur, prevAgg, prev } = model;
  const monthName = frMonthName(model.y, model.m);
  const prevName = frMonthName(prev.y, prev.m);
  const income = cur.income.total;
  const expenses = cur.exp.total;
  const net = income - expenses;
  const bullets = [];

  // 1. Comparison with previous month
  if (prevAgg.hasData) {
    const pNet = prevAgg.income.total - prevAgg.exp.total;
    const partial = model.inProgress ? ` (${monthName} is in progress: ${model.daysElapsed} of ${model.daysInMonth} days)` : '';
    bullets.push(
      `<strong>Vs ${prevName}${partial}:</strong> income ${frMoney(income)} against ${frMoney(prevAgg.income.total)} (${frChangeText(income, prevAgg.income.total)}), ` +
      `expenses ${frMoney(expenses)} against ${frMoney(prevAgg.exp.total)} (${frChangeText(expenses, prevAgg.exp.total)}). ` +
      `Net income moved from ${frMoney(pNet)} to ${frMoney(net)} (${frChangeText(net, pNet)}).`
    );
  } else {
    bullets.push(`<strong>Vs ${prevName}:</strong> no data recorded for ${prevName}, so no month-on-month comparison is available.`);
  }

  // 2. Interesting stats
  const stats = [];
  const topIncome = frTopRow(frIncomeRows(cur));
  if (topIncome) stats.push(`${topIncome.label} is the top income category at ${frMoney(topIncome.amount)} (${frPctText(frPct(topIncome.amount, income))} of income)`);
  const days = Object.entries(cur.income.daily);
  if (days.length) {
    const [bestDay, d] = days.reduce((a, b) => (b[1].total > a[1].total ? b : a));
    stats.push(`the highest single-day income was ${frMoney(d.total)} on ${frDayLabel(bestDay)} (${d.count} invoice${d.count === 1 ? '' : 's'})`);
  }
  const topExpense = frTopRow(frExpenseRows(cur));
  if (topExpense) stats.push(`the biggest expense was ${topExpense.label} at ${frMoney(topExpense.amount)} (${frPctText(frPct(topExpense.amount, expenses))} of expenses)`);
  if (stats.length) {
    const text = stats.join('; ');
    bullets.push(`<strong>Highlights:</strong> ${text.charAt(0).toUpperCase() + text.slice(1)}.`);
  }

  // 3. Projection / ratio insight
  if (model.inProgress && income > 0 && model.daysElapsed < FR_MIN_PROJECTION_DAYS) {
    bullets.push(`<strong>Projection:</strong> only ${model.daysElapsed} day${model.daysElapsed === 1 ? '' : 's'} of ${monthName} so far, which is too early for a reliable month-end projection.`);
  } else if (model.inProgress && income > 0 && model.daysElapsed < model.daysInMonth) {
    const avg = income / model.daysElapsed;
    bullets.push(
      `<strong>Projection:</strong> at the current average of ${frMoney(avg)} a day over ${model.daysElapsed} days, income would reach about ${frMoney(avg * model.daysInMonth)} by month-end. ` +
      `Expenses are irregular (stock purchases, rent, salaries), so net income is not projected.`
    );
  } else if (income > 0) {
    const ratio = frPct(expenses, income);
    const prevRatio = prevAgg.income.total > 0 ? frPct(prevAgg.exp.total, prevAgg.income.total) : null;
    bullets.push(
      `<strong>Expense ratio:</strong> expenses were ${frPctText(ratio)} of income` +
      (prevRatio === null ? ', and there is no prior-month income to compare against.' : ` against ${frPctText(prevRatio)} in ${prevName}.`)
    );
  } else {
    bullets.push('<strong>Expense ratio:</strong> no income recorded this month, so no expense-to-income ratio can be calculated.');
  }
  return bullets;
}

// ── Preview HTML (also what the PDF is captured from) ────────────
function frTableHtml(title, rows, total, totalLabel) {
  const body = rows.length
    ? rows.map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="fr-num">${frMoney(r.amount)}</td><td class="fr-num">${frPctText(frPct(r.amount, total))}</td></tr>`).join('')
    : '<tr><td colspan="3" class="fr-none">None recorded this month</td></tr>';
  return `
    <section class="fr-section">
      <h3 class="fr-h">${title}</h3>
      <table class="fr-table">
        <thead><tr><th>Category</th><th class="fr-num">Amount (PKR)</th><th class="fr-num">% of total</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td>${totalLabel}</td><td class="fr-num">${frMoney(total)}</td><td class="fr-num">${rows.length ? '100.0%' : '–'}</td></tr></tfoot>
      </table>
    </section>`;
}

function frReportHtml(model) {
  const monthName = frMonthName(model.y, model.m);
  const head = `
    <header class="fr-head">
      <img src="logo.jpeg" alt="" class="fr-logo" width="56" height="56">
      <div class="fr-head-text">
        <div class="fr-org">${FR_NAME}</div>
        <div class="fr-title">Profit &amp; Loss Report &mdash; ${monthName}</div>
      </div>
      <div class="fr-generated">Generated<br><strong>${model.generated}</strong></div>
    </header>`;

  if (!model.cur.hasData) {
    return `${head}<div class="fr-empty">No data for this month</div>`;
  }

  const income = model.cur.income.total;
  const expenses = model.cur.exp.total;
  const net = income - expenses;
  const margin = income > 0 ? `${((net / income) * 100).toFixed(1)}%` : 'n/a';
  const tone = net < 0 ? 'fr-neg' : net > 0 ? 'fr-pos' : '';
  return `
    ${head}
    ${frTableHtml('1. Income Breakdown', frIncomeRows(model.cur), income, 'Total Income')}
    ${frTableHtml('2. Expense Breakdown', frExpenseRows(model.cur), expenses, 'Total Expenses')}
    <section class="fr-section">
      <h3 class="fr-h">3. Net Income</h3>
      <div class="fr-net">
        <div><span class="fr-net-label">Total Income &minus; Total Expenses</span><span class="fr-net-value ${tone}">${frMoney(net)}</span></div>
        <div class="fr-net-margin"><span class="fr-net-label">Profit margin</span><span class="fr-net-value fr-net-small ${tone}">${margin}</span></div>
      </div>
    </section>
    <section class="fr-section">
      <h3 class="fr-h">4. Month Analysis</h3>
      <ul class="fr-bullets">${frAnalysis(model).map(b => `<li>${b}</li>`).join('')}</ul>
    </section>
    <p class="fr-foot">Income is total invoice sales at full value; this system records no doctor or service splits and no cancelled invoices (a deleted invoice is removed). Expenses are the entries on the Expenses page, which include stock purchases; no separate cost of goods is recorded, so none is deducted. Figures are rounded to the nearest rupee.</p>`;
}

function frRenderPreview(model) {
  const page = document.getElementById('fr-page');
  page.classList.remove('fr-compact');
  page.innerHTML = frReportHtml(model);
  // Must fit one A4 page: tighten spacing if the content would overflow.
  if (page.scrollHeight > FR_PAGE_H + 1) page.classList.add('fr-compact');
  document.getElementById('fr-download').disabled = !model.cur.hasData;
}

// ── PDF ──────────────────────────────────────────────────────────
function frLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src.split('/').pop()));
    document.head.appendChild(s);
  });
}

function frLoadLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (!frLibsPromise) {
    frLibsPromise = Promise.all(FR_LIBS.map(frLoadScript)).catch(err => { frLibsPromise = null; throw err; });
  }
  return frLibsPromise;
}

async function frDownloadPdf() {
  if (!frModel || !frModel.cur.hasData) return;
  const btn = document.getElementById('fr-download');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Preparing…';
  try {
    await frLoadLibs();
    const page = document.getElementById('fr-page');
    const canvas = await window.html2canvas(page, {
      scale: 3, backgroundColor: '#ffffff', useCORS: true,
      width: FR_PAGE_W, height: FR_PAGE_H, windowWidth: FR_PAGE_W,
    });
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    pdf.save(`YMDC_PnL_${frMonthKey(frModel.y, frModel.m)}.pdf`);
  } catch (err) {
    showToast('PDF failed: ' + err.message, 'error');
  } finally {
    btn.textContent = label;
    btn.disabled = !frModel.cur.hasData;
  }
}

// ── Modals ───────────────────────────────────────────────────────
function frInitPicker() {
  const today = frToday();
  const monthSel = document.getElementById('fr-month');
  const yearSel = document.getElementById('fr-year');
  monthSel.innerHTML = FR_MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('');
  const years = [];
  for (let y = today.y; y >= today.y - 3; y--) years.push(y);
  yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  monthSel.value = String(today.m);
  yearSel.value = String(today.y);
}

function frOpenPicker() {
  document.getElementById('fr-preview-modal').classList.remove('open');
  document.getElementById('fr-picker-modal').classList.add('open');
}

function frClose() {
  document.getElementById('fr-picker-modal').classList.remove('open');
  document.getElementById('fr-preview-modal').classList.remove('open');
}

async function frGenerate() {
  const y = Number(document.getElementById('fr-year').value);
  const m = Number(document.getElementById('fr-month').value);
  const today = frToday();
  if (y > today.y || (y === today.y && m > today.m)) {
    showToast('Choose the current month or an earlier one', 'warning');
    return;
  }
  const btn = document.getElementById('fr-generate');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    frModel = await frBuildReport(y, m);
    document.getElementById('fr-picker-modal').classList.remove('open');
    frRenderPreview(frModel);
    document.getElementById('fr-preview-modal').classList.add('open');
    frLoadLibs().catch(() => {}); // warm up; Download reports any failure
  } catch (err) {
    showToast('Failed to build report: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

function wireFinancialReport() {
  frInitPicker();
  document.getElementById('fr-open').addEventListener('click', frOpenPicker);
  document.getElementById('fr-generate').addEventListener('click', frGenerate);
  document.getElementById('fr-download').addEventListener('click', frDownloadPdf);
  document.getElementById('fr-change-month').addEventListener('click', frOpenPicker);
  ['fr-picker-close', 'fr-picker-cancel', 'fr-preview-close'].forEach(id => document.getElementById(id).addEventListener('click', frClose));
  ['fr-picker-modal', 'fr-preview-modal'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('click', (e) => { if (e.target === el) frClose(); });
  });
}
