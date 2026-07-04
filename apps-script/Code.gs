/**
 * YMDC Pharmacy POS — Google Apps Script Web App
 * Deploy as: Execute as Me, Access: Anyone
 */

const SPREADSHEET_NAME = 'YMDC Pharmacy POS';
const SHEETS = {
  INVENTORY: 'Inventory',
  SALES: 'Sales',
  DAILY_SUMMARY: 'Daily Summary',
  CONFIG: 'Config',
};

const SALES_HEADERS = ['Invoice No', 'Date', 'Time', 'Patient Name', 'Item Name', 'Category', 'Qty', 'Unit Price'];

// ── JSON helpers ─────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Entry points ─────────────────────────────────────────────────

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    switch (action) {
      case 'inventory':
        return jsonResponse({ items: getInventory() });
      case 'history':
        return jsonResponse({ days: getHistory(), invoices: getAllInvoices() });
      default:
        return jsonResponse({ error: 'Unknown action. Use ?action=inventory or ?action=history' });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'sale':
        return jsonResponse(saveSale(body));
      case 'inventory':
        return jsonResponse(handleInventory(body));
      default:
        return jsonResponse({ error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── One-time setup ───────────────────────────────────────────────

function runSetup() {
  migrateSalesSheet();
  formatSheetHeaders();
}

function migrateSalesSheet() {
  const sheet = getSheet(SHEETS.SALES);
  while (sheet.getLastColumn() > SALES_HEADERS.length) {
    sheet.deleteColumn(SALES_HEADERS.length + 1);
  }
  sheet.getRange(1, 1, 1, SALES_HEADERS.length).setValues([SALES_HEADERS]);
}

function formatSheetHeaders() {
  const ss = getSpreadsheet();
  const navy = '#003366';
  const gold = '#C9A84C';
  const grey = '#e2e6ea';

  const sales = ss.getSheetByName(SHEETS.SALES);
  if (sales && sales.getLastColumn() > 0) {
    const hdr = sales.getRange(1, 1, 1, sales.getLastColumn());
    hdr.setBackground(navy).setFontColor('#ffffff').setFontWeight('bold');
    sales.setFrozenRows(1);
    sales.autoResizeColumns(1, sales.getLastColumn());
  }

  const inventory = ss.getSheetByName(SHEETS.INVENTORY);
  if (inventory && inventory.getLastColumn() > 0) {
    const hdr = inventory.getRange(1, 1, 1, inventory.getLastColumn());
    hdr.setBackground(navy).setFontColor('#ffffff').setFontWeight('bold');
    inventory.setFrozenRows(1);
    inventory.autoResizeColumns(1, inventory.getLastColumn());
  }

  const summary = ss.getSheetByName(SHEETS.DAILY_SUMMARY);
  if (summary && summary.getLastColumn() > 0) {
    const hdr = summary.getRange(1, 1, 1, summary.getLastColumn());
    hdr.setBackground(gold).setFontColor(navy).setFontWeight('bold');
    summary.setFrozenRows(1);
    summary.autoResizeColumns(1, summary.getLastColumn());
  }

  const config = ss.getSheetByName(SHEETS.CONFIG);
  if (config && config.getLastColumn() > 0) {
    const hdr = config.getRange(1, 1, 1, config.getLastColumn());
    hdr.setBackground(grey).setFontWeight('bold');
    config.setFrozenRows(1);
    config.autoResizeColumns(1, config.getLastColumn());
  }
}

// ── Spreadsheet access ───────────────────────────────────────────

function getSpreadsheet() {
  const files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  initializeSheets(ss);
  return ss;
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    initializeSheets(ss);
    sheet = ss.getSheetByName(name);
  }
  return sheet;
}

// ── Initialize sheets ────────────────────────────────────────────

function initializeSheets(ss) {
  setupSheet(ss, SHEETS.INVENTORY, ['ID', 'Item Name', 'Category', 'Price (PKR)', 'Active (TRUE/FALSE)']);
  setupSheet(ss, SHEETS.SALES, SALES_HEADERS);
  setupSheet(ss, SHEETS.DAILY_SUMMARY, ['Date', 'Total Invoices', 'Total Revenue (PKR)']);
  setupSheet(ss, SHEETS.CONFIG, ['Key', 'Value']);

  const configSheet = ss.getSheetByName(SHEETS.CONFIG);
  const configData = configSheet.getDataRange().getValues();
  if (configData.length <= 1) {
    configSheet.getRange(2, 1, 1, 2).setValues([['lastInvoiceNumber', '0']]);
  }

  const invSheet = ss.getSheetByName(SHEETS.INVENTORY);
  if (invSheet.getLastRow() <= 1) {
    seedInventory(invSheet);
  }
}

function setupSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

// ── Date helpers ─────────────────────────────────────────────────

function parseDateStr(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
  }
  const s = String(dateStr).trim();
  if (s.indexOf('/') !== -1) {
    const parts = s.split('/');
    return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  }
  if (s.indexOf('-') !== -1) {
    const parts = s.split('-');
    if (parts[0].length === 4) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatSheetDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function formatSheetTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'hh:mm a');
}

function normalizeCellDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return formatSheetDate(value);
  }
  if (typeof value === 'number' && value > 0) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return formatSheetDate(d);
  }
  return String(value || '').trim();
}

function readSaleItem(row) {
  return {
    name: String(row[4] || ''),
    category: String(row[5] || ''),
    qty: Number(row[6]) || 0,
    price: Number(row[7]) || 0,
  };
}

function lineTotal(qty, price) {
  return (Number(qty) || 0) * (Number(price) || 0);
}

// ── Preloaded inventory ──────────────────────────────────────────

function seedInventory(sheet) {
  const medicines = [
    'Bristozole 2.5mg', 'Emacrit SCH', 'Gesunden Multi Tab', 'Resvitol Platinum 15s',
    'Tinostol D25 Sachet', 'Tinostol D600 Sachet', 'Brufen Syp', 'Panadol Syp', 'Synflex',
    'Ponstan Tab', 'Risek 20 Cap', 'Risek Insta 20mg', 'Mucaine Syp', 'Trisil Tab',
    'Peditral ORS Orange', 'Imodium', 'Onset B Tab', 'Onset Inj', 'Ispaghol Sch',
    'Glycerine Suppos Adult', 'Reltos', 'Hydryllin S', 'Johar Joshanda', 'Cefspan DS Syp',
    'Softin Tab', 'Fexet D', 'Fexet 60', 'Fexet 120', 'Arinac Fort', 'Norsaline P DR',
    'Xynosine', 'Amoxil 500mg', 'Amoxil 250mg', 'Augmentin 625', 'Augmentin 375',
    'Ciproxin 500', 'Rigix 30 Tab', 'Rigix Syp', 'Strepsil Mix', 'Disprin 100',
    'Panadol Tab', 'D Rich', 'Glucophage 500', 'Quench Cream', 'Bendge 3', 'Bendge 4',
    'Bendge 6', 'Bendge 2', 'Calpol 100 Syp', 'Flagyl Syp', 'Avil Syp', 'Wel D Cap',
    'Enziclor', 'Protect Mouth Wash', 'Somogel', 'Protect GM Paste M', 'Porkadex Eye Drop',
    'Moxigon DR', 'Sodaglycrin Ear Drops', 'ALP 0.5', 'Novidet 125 Syp', 'Novidet 250 Syp',
    'Rapicort 5', 'Betnesol Tab', 'Febrol Syrup', 'Febrol DS Syp', 'Dolor DS Syp',
    'Dolor Syp', 'Caflam', 'Dyclo 50 Tab', 'Rotec 50', 'Beflam', 'Surbex Z',
    'Methycobal Tab', 'Voren Inj', 'Dyclo Inj 50', 'Avil Inj', 'Decadron 1ml',
    'Velosef 250 Cap', 'Velosef 500 Cap', 'Ceespan Cap', 'Cebosh 200', 'Amoxil 125 90ml',
    'Augmentin Syp', 'Augmentin DS Syp', 'Velosef 125', 'Velosef 250 Syp', 'Cerosh Syp',
    'Tab Inoquin 500mg', 'Tab Inoquin 250mg', 'Tab Acicon 20mg', 'Tab Acicon 40mg',
    'Syp Acicon', 'Tab Equibar 16mg', 'Tab Equibar 8mg', 'Tab Esegrow', 'Syp Esegrow',
    'Cipotic Ear Drop',
  ];

  const snacks = [
    'Lollipop', 'Marie Biscuit', 'Cup Cake', 'Sooper Biscuit', 'Lemon Sandwich Biscuit',
    'Zeera Plus Biscuit', 'Now Chocolate', 'MilcoLu Biscuit', 'Dairy Milk Chocolate',
    'Paradise Chocolate', 'Chocolatto Biscuit', 'Peanut Pik Biscuit', 'Party Pik Biscuit',
    'Gluco Biscuit', 'Rio Biscuit', 'Seasons Biscuit',
  ];

  const rows = [];
  let id = 1;

  medicines.forEach(function(name) {
    rows.push(['MED-' + padId(id), name, 'Medicine', 0, 'TRUE']);
    id++;
  });

  snacks.forEach(function(name) {
    rows.push(['SNK-' + padId(id), name, 'Snack', 0, 'TRUE']);
    id++;
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }
}

function padId(n) {
  return String(n).padStart(3, '0');
}

// ── Config helpers ───────────────────────────────────────────────

function getConfig(key) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setConfig(key, value) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getNextInvoiceNo() {
  const last = parseInt(getConfig('lastInvoiceNumber') || '0', 10);
  const next = last + 1;
  setConfig('lastInvoiceNumber', String(next));
  return 'INV-' + String(next).padStart(3, '0');
}

// ── Inventory CRUD ───────────────────────────────────────────────

function getInventory() {
  const sheet = getSheet(SHEETS.INVENTORY);
  const data = sheet.getDataRange().getValues();
  const items = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const active = String(row[4]).toUpperCase() === 'TRUE';
    if (!active) continue;
    items.push({
      id: String(row[0]),
      name: String(row[1]),
      category: String(row[2]),
      price: Number(row[3]) || 0,
    });
  }

  items.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return items;
}

function handleInventory(body) {
  const op = body.operation;

  if (op === 'add') {
    return addInventoryItem(body);
  } else if (op === 'edit') {
    return editInventoryItem(body);
  } else if (op === 'delete') {
    return deleteInventoryItem(body);
  }

  throw new Error('Unknown inventory operation');
}

function addInventoryItem(body) {
  const sheet = getSheet(SHEETS.INVENTORY);
  const data = sheet.getDataRange().getValues();
  const id = generateItemId(data, body.category);
  sheet.appendRow([id, body.name, body.category, body.price || 0, 'TRUE']);
  return { success: true, id: id };
}

function generateItemId(data, category) {
  const prefix = category === 'Snack' ? 'SNK' : category === 'Medicine' ? 'MED' : 'OTH';
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0]);
    if (id.startsWith(prefix + '-')) {
      const num = parseInt(id.split('-')[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return prefix + '-' + padId(maxNum + 1);
}

function editInventoryItem(body) {
  const sheet = getSheet(SHEETS.INVENTORY);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[body.name, body.category, body.price || 0]]);
      return { success: true };
    }
  }

  throw new Error('Item not found');
}

function deleteInventoryItem(body) {
  const sheet = getSheet(SHEETS.INVENTORY);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.getRange(i + 1, 5).setValue('FALSE');
      return { success: true };
    }
  }

  throw new Error('Item not found');
}

// ── Sales ────────────────────────────────────────────────────────

function saveSale(body) {
  if (!body.items || !body.items.length) {
    throw new Error('No items in sale');
  }

  const invoiceNo = getNextInvoiceNo();
  const now = new Date();
  const date = formatSheetDate(now);
  const time = formatSheetTime(now);
  const patientName = body.patientName || '';

  const sheet = getSheet(SHEETS.SALES);

  body.items.forEach(function(item) {
    const name = String(item.name || '');
    const category = String(item.category || '');
    const qty = Number(item.qty) || 0;
    const price = Number(item.price) || 0;
    sheet.appendRow([invoiceNo, date, time, patientName, name, category, qty, price]);
  });

  const total = body.items.reduce(function(sum, item) {
    return sum + lineTotal(Number(item.qty) || 0, Number(item.price) || 0);
  }, 0);

  updateDailySummary();

  return {
    success: true,
    invoiceNo: invoiceNo,
    date: date,
    time: time,
    total: total,
  };
}

// ── Daily Summary ────────────────────────────────────────────────

function updateDailySummary() {
  const salesSheet = getSheet(SHEETS.SALES);
  const salesData = salesSheet.getDataRange().getValues();
  const summarySheet = getSheet(SHEETS.DAILY_SUMMARY);
  const dayStats = {};

  for (let i = 1; i < salesData.length; i++) {
    const row = salesData[i];
    if (!row[0]) continue;
    const d = normalizeCellDate(row[1]);
    const invoiceNo = String(row[0]);
    const item = readSaleItem(row);
    const rowTotal = lineTotal(item.qty, item.price);

    if (!dayStats[d]) {
      dayStats[d] = { invoices: {}, revenue: 0 };
    }
    dayStats[d].invoices[invoiceNo] = true;
    dayStats[d].revenue += rowTotal;
  }

  summarySheet.clear();
  summarySheet.getRange(1, 1, 1, 3).setValues([['Date', 'Total Invoices', 'Total Revenue (PKR)']]);
  summarySheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  summarySheet.setFrozenRows(1);

  const sortedDates = Object.keys(dayStats).sort(function(a, b) {
    const da = parseDateStr(a);
    const db = parseDateStr(b);
    if (!da || !db) return a.localeCompare(b);
    return da.getTime() - db.getTime();
  });

  let row = 2;
  sortedDates.forEach(function(d, idx) {
    if (idx > 0) row++;
    const stats = dayStats[d];
    const invoiceCount = Object.keys(stats.invoices).length;
    summarySheet.getRange(row, 1, 1, 3).setValues([[d, invoiceCount, stats.revenue]]);
    row++;
  });
}

// ── History ──────────────────────────────────────────────────────

function getHistory() {
  const sheet = getSheet(SHEETS.SALES);
  const data = sheet.getDataRange().getValues();
  const invoiceMap = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const invoiceNo = String(row[0]);
    const item = readSaleItem(row);
    const rowTotal = lineTotal(item.qty, item.price);

    if (!invoiceMap[invoiceNo]) {
      invoiceMap[invoiceNo] = {
        invoiceNo: invoiceNo,
        date: normalizeCellDate(row[1]),
        time: String(row[2]),
        patientName: String(row[3]),
        items: [],
        total: 0,
      };
    }

    invoiceMap[invoiceNo].items.push({
      name: item.name,
      category: item.category,
      qty: item.qty,
      price: item.price,
      lineTotal: rowTotal,
    });
    invoiceMap[invoiceNo].total += rowTotal;
  }

  const dayMap = {};
  Object.keys(invoiceMap).forEach(function(key) {
    const inv = invoiceMap[key];
    if (!dayMap[inv.date]) {
      dayMap[inv.date] = { date: inv.date, invoices: [], totalRevenue: 0 };
    }
    dayMap[inv.date].invoices.push(inv);
    dayMap[inv.date].totalRevenue += inv.total;
  });

  const days = Object.keys(dayMap).sort(function(a, b) {
    const da = parseDateStr(a);
    const db = parseDateStr(b);
    if (!da || !db) return b.localeCompare(a);
    return db.getTime() - da.getTime();
  }).map(function(d) {
    const day = dayMap[d];
    day.invoices.sort(function(a, b) { return b.time.localeCompare(a.time); });
    return day;
  });

  return days;
}

function getAllInvoices() {
  const days = getHistory();
  const invoices = [];
  days.forEach(function(day) {
    day.invoices.forEach(function(inv) {
      invoices.push(inv);
    });
  });
  return invoices;
}
