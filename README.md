# YMDC Pharmacy POS

Point-of-sale system for **Yaseen Medical & General Store** — pure HTML/CSS/JS frontend synced to Google Sheets via Google Apps Script.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | HTML, CSS, JavaScript (3 pages) |
| API | Google Apps Script Web App |
| Database | Google Sheets |
| Hosting | GitHub Pages |

## Pages

- **index.html** — POS / invoicing with search, cart, and printable receipts
- **inventory.html** — Add, edit, and delete inventory items
- **history.html** — Browse past invoices grouped by date

## Project Files

```
ymdc-pharmacy-pos/
├── index.html
├── inventory.html
├── history.html
├── config.js          ← Apps Script URL goes here
├── app.js             ← Shared utilities
├── style.css          ← Shared styles
├── apps-script/
│   └── Code.gs        ← Paste into Google Apps Script
└── README.md
```

---

## Deployment Guide

### Step 1 — Create the Google Sheet

You don't need to create the sheet manually. The Apps Script will automatically create a spreadsheet named **"YMDC Pharmacy POS"** with these tabs on first run:

| Sheet | Purpose |
|-------|---------|
| Inventory | Item catalog (ID, Name, Category, Price, Active) |
| Sales | Every invoice line item |
| Daily Summary | Auto-calculated daily totals |
| Config | Stores last invoice number |

On first run, the Inventory sheet is pre-populated with all medicines and snacks.

### Step 2 — Set Up Google Apps Script

1. Go to [script.google.com](https://script.google.com) and click **New Project**.
2. Delete any default code in the editor.
3. Open `apps-script/Code.gs` from this repo and **paste the entire contents** into the Apps Script editor.
4. Click **Save** (name the project "YMDC Pharmacy POS").
5. Click **Run** on the `doGet` function once to authorize the script:
   - Click **Review Permissions** → choose your Google account → **Advanced** → **Go to YMDC Pharmacy POS (unsafe)** → **Allow**.
   - This creates the spreadsheet and seeds inventory.

### Step 3 — Deploy as Web App

1. In Apps Script, click **Deploy** → **New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Configure:
   - **Description:** YMDC POS API v1
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/XXXXX/exec`).

### Step 4 — Configure the Frontend

1. Open `config.js` in this project.
2. Replace the placeholder with your Web App URL:

```js
const API_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

### Step 5 — Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `ymdc-pharmacy-pos`).
2. Push all project files to the repository:

```bash
cd ymdc-pharmacy-pos
git init
git add .
git commit -m "Initial YMDC Pharmacy POS"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ymdc-pharmacy-pos.git
git push -u origin main
```

3. On GitHub, go to **Settings** → **Pages**.
4. Under **Source**, select **Deploy from a branch**.
5. Choose branch `main`, folder `/ (root)`, and click **Save**.
6. After a minute, your site will be live at:
   `https://YOUR_USERNAME.github.io/ymdc-pharmacy-pos/`

### Step 6 — Done!

Open your GitHub Pages URL on any device (phone, tablet, or laptop) and start using the POS.

---

## Usage

### Making a Sale (POS)

1. Type an item name in the search bar — a dropdown appears with matching inventory.
2. Click an item (or press Enter) to add it to the cart.
3. Adjust quantity with +/- buttons; enter the unit price in PKR.
4. Optionally enter a patient name.
5. Click **Save & Print Invoice** — the sale is saved to Google Sheets and a receipt opens for printing.

### Managing Inventory

- View all items in a sortable table.
- Click **Add Item** to create a new medicine, snack, or other item.
- Click **Edit** or **Delete** on any row — changes sync immediately to Google Sheets.

### Viewing History

- Invoices are grouped by date with daily revenue totals.
- Use the date filter to narrow results.
- Click any invoice row to see the full itemized breakdown.
- Click **Print** in the detail modal to reprint a receipt.

---

## Invoice Format

Invoices are numbered sequentially: `INV-001`, `INV-002`, etc.

Receipts include:
- Store name and YMDC branding
- Invoice number, date, and time
- Patient name (if provided)
- Itemized list with quantities and prices
- Grand total in PKR
- WhatsApp: 0335-6733777
- Address: MA Jinnah Road Karachi

---

## Updating the Apps Script

If you change `Code.gs`:

1. Edit the code in Apps Script.
2. Click **Deploy** → **Manage deployments**.
3. Click the pencil icon on your deployment → change **Version** to **New version** → **Deploy**.
4. The URL stays the same — no need to update `config.js`.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to load inventory" | Check that `API_URL` in `config.js` is correct and the Web App is deployed with "Anyone" access |
| CORS / network errors | Re-deploy the Web App; ensure "Who has access" is set to **Anyone** |
| Cart lost on error | The cart stays in memory until you clear it or save successfully — just retry |
| Invoice numbers skip | Normal if a save failed mid-way; numbers are assigned only on successful save |
| Sheet not created | Run `doGet` once from the Apps Script editor to trigger authorization |

---

## Design

- **Colors:** Navy (#003366), White, Gold (#C9A84C) accents
- **Responsive:** Works on phone, tablet, and laptop
- **Print:** Invoice print view hides all navigation and UI chrome

----

## License

Private use for Yaseen Medical & General Store.
