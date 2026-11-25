# HealthySure Corporate Renewal Intelligence & AI SPOC Database

A high-performance, searchable corporate database application built for **[HealthySure](https://www.healthysure.in)** (Employee Health Benefits Platform).

Pre-loaded with **27,003 Indian companies** with renewal dates, employee sizes, existing insurers/brokers, BD assignment, and built-in **OpenAI API** enhancements to find decision-maker SPOCs, email formats, phone numbers, and draft renewal pitches.

---

## 🚀 Run & Deploy

Hosted on **Cloudflare Workers** (static app + API + D1 shared database), auto-deployed from GitHub.
Edits made by any BD member are shared live with everyone. See **[plan.md](plan.md)** for setup and architecture.

```bash
npm install
npm run db:migrate:local   # local D1
npm run dev                # http://localhost:8787
```

---

## ✨ Key Features

### 1. Ultra-Fast Search & Multi-Dimensional Filters (27,003 Companies)
- **Instant Search**: Type any company name (e.g. *Udaan*, *Atlan*, *Pixxel*), city, contact person, or BD member with instant debounced results.
- **Missing Contacts Quick Filters**:
  - `Missing Contacts (23.6k)`: Isolates all companies lacking verified SPOCs.
  - `Missing Email` / `Missing Phone`: Isolates companies missing specific outreach channels.
- **Renewal Period Filters**:
  - Filter by any month (January through December) or upcoming periods (Current Month, Next Month).
- **BD Member Allocation**:
  - Filter by representative: **Vimlendu** (6,725 cos), **Aditi** (6,655 cos), **Deepesh** (6,603 cos), **Vipul** (6,099 cos), **Ishan**, **Charan**, **Pooja**, **Mayank**, **Aadish**.
- **Company Size**: Small (<50), Medium (50-250), Large (250+ employees).
- **Outreach Status**: Track leads as *New*, *AI Enriched*, *Contacted*, *Meeting Scheduled*, *Won*, or *Lost*.

---

### 2. OpenAI API Integration & SPOC Finder
Click **"OpenAI Key"** in the top navigation bar to configure your API key (`sk-...`). It is stored securely in your browser's local storage and is never sent to external servers other than OpenAI's official endpoint.

#### 🎯 AI SPOC & Contact Intelligence Modal
For any company, click the ✨ **"Find SPOC"** button to open the AI analysis drawer:
1. **Target Decision-Makers**: Identifies who approves the corporate health policy for this size (e.g., CHRO, VP People, Head of Total Rewards, or Founder/CEO).
2. **Corporate Email Syntax Prediction**: Generates probable email domain formats (`first.last@company.com`, `first@company.com`).
3. **1-Click Live Prospecting Shortcuts**:
   - 👔 **LinkedIn HR Search**: `site:linkedin.com/in/ "HR" [Company]`
   - 👔 **LinkedIn Founders / CXO**: `site:linkedin.com/in/ "Founder" [Company]`
   - 🏢 **ZaubaCorp / MCA Directors**: Pulls director filings and registered company contact info.
   - 🌐 **Google Contact Dorks**: Targeted email & phone search strings.
   - 🔍 **Apollo.io Search**: Instant shortcut to company verified leads.
4. **Tailored HealthySure Renewal Pitch**:
   - Generates a customized value hook emphasizing HealthySure USPs:
     - 360° Employee Health Insurance (GMC + GPA + GTL)
     - Cashless & paperless WhatsApp claims assistance
     - OPD & Teleconsultation benefits
     - Flexible employee wallets & wellness checkups
5. **Cold Email & 30-Second Cold Call Script**:
   - Copyable cold outreach email and telephone intro script referencing their exact renewal month.
6. **Save to Database**: Save discovered contact person, designation, email, phone, and remarks directly with 1 click.

---

### 3. Batch AI SPOC Enrichment
- Select 5, 10, or 20 companies using the checkboxes.
- Click **"Batch AI Enrich SPOCs"** in the action bar.
- The engine processes the companies sequentially with a real-time progress bar and updates your local database.

---

### 4. Interactive HealthySure AI Sales Copilot
Click **"AI Copilot"** in the top-right corner to open the sliding assistant drawer.
- Pre-prompted with HealthySure products, insurance underwriting knowledge, and awareness of your 27,000+ database.
- Ask questions like:
  - *"Which companies in November are large and need contacts?"*
  - *"Draft a renewal email pitch for a company with 500 employees currently with Bajaj Allianz."*
  - *"Give me cold call objection handling for an HR who says 'We already have an existing broker'."*

---

### 5. Persistent Local Storage (IndexedDB)
- All edits, updates, new contacts, and status changes are automatically saved to your browser's **IndexedDB**.
- Records survive browser restarts and refreshes.

---

### 6. Excel & CSV Import/Export
- **Export to Excel (.xlsx)**: Downloads your filtered view or full enriched database back into an Excel spreadsheet.
- **Export to CSV**: Fast download of current records.
- **Import / Update**: Drag & drop any `.xlsx`, `.xlsm`, or `.csv` spreadsheet to append or refresh companies.

---

## 📁 Project Structure

```text
public/                 # Served app: index.html, app.js, app.css, companies_data.js (27k baseline)
src/worker.js           # Cloudflare Worker: routing + /api/sync, /api/companies, /api/feedback, /api/prospeo
src/auth.js             # Emailed one-time-code login (SendGrid) + session cookies
migrations/             # D1 schema migrations
wrangler.jsonc          # Cloudflare config
companies.json / .csv   # Data exports (not deployed)
plan.md                 # Deployment plan & runbook
```
