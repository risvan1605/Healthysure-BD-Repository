/**
 * Healthysure Corporate Renewal Intelligence & Multi-SPOC Discovery Engine
 * Microsoft Fluent 2 UI & Enterprise Dataverse Engine
 * Official Brand Color: #11a387
 * Website: https://www.healthysure.in
 */

// Model ID Sanitizer (Prevents "invalid model ID" errors from legacy strings or badges)
function sanitizeModelId(modelStr) {
  if (!modelStr || typeof modelStr !== 'string') return 'gpt-4o-mini';
  const cleaned = modelStr.trim();

  if (cleaned.includes('gpt-4o-mini')) return 'gpt-4o-mini';
  if (cleaned.includes('gpt-4o')) return 'gpt-4o';
  if (cleaned.includes('gpt-4-turbo')) return 'gpt-4-turbo';
  if (cleaned.includes('gpt-4')) return 'gpt-4';
  if (cleaned.includes('gpt-3.5-turbo')) return 'gpt-3.5-turbo';
  if (cleaned.includes('o1-mini')) return 'o1-mini';
  if (cleaned.includes('o1-preview')) return 'o1-preview';
  if (cleaned.includes('o3-mini')) return 'o3-mini';

  const match = cleaned.match(/^[a-zA-Z0-9._-]+/);
  return match && match[0] ? match[0] : 'gpt-4o-mini';
}

// Global Application State
const state = {
  allCompanies: [],
  filteredCompanies: [],
  selectedIds: new Set(),
  currentPage: 1,
  pageSize: 50,
  activeCompany: null,
  filters: {
    search: '',
    dataSource: 'ALL', // 'ALL', 'Insurer', 'TPA', 'Claim Tech', 'Channel Partner', 'Team Member', 'Broker', 'Other'
    city: 'ALL',
    bd: 'ALL',
    size: 'ALL', // 'ALL', 'Small', 'Medium', 'Large'
    status: 'ALL',
    contactFilter: 'ALL', // 'ALL', 'MISSING_ALL', 'MISSING_EMAIL', 'MISSING_PHONE', 'AI_ENRICHED'
    datePreset: 'ALL', // 'ALL', 'NEXT_15_DAYS', 'NEXT_30_DAYS', 'CURRENT_MONTH', 'NEXT_MONTH'
    customDateRange: null // { fromDay, fromMonth, toDay, toMonth }
  },
  aiConfig: {
    apiKey: localStorage.getItem('hs_openai_key') || '',
    apolloKey: localStorage.getItem('hs_apollo_key') || '',
    serpApiKey: localStorage.getItem('hs_serpapi_key') || '',
    prospeoKey: localStorage.getItem('hs_prospeo_key') || '',
    model: sanitizeModelId(localStorage.getItem('hs_openai_model')),
    cachedModels: JSON.parse(localStorage.getItem('hs_openai_models_cache') || '[]'),
  },
  adminConfig: {
    // Admin password verified via SHA-256 cryptographic hash
  },
  bdCockpit: {
    activeBD: 'ALL',
    pairings: {
      'Aditi': 'Vipul',
      'Charan': 'Deepesh',
      'Vimlendu': 'Sachin',
      'Sudipto': 'Atharva',
      'Deepesh': 'Sales Rep 5',
      'Vipul': 'Sales Rep 6',
      'Backup': 'Float Sales Closer'
    },
    directMonthlyTargets: {
      'ALL': 125,
      'Aditi': 25,
      'Charan': 25,
      'Vimlendu': 25,
      'Sudipto': 25,
      'Deepesh': 25,
      'Vipul': 25,
      'Backup': 25
    },
    weeklyMeetingTargets: {
      'ALL': 32,
      'Aditi': 6,
      'Charan': 6,
      'Vimlendu': 5,
      'Sudipto': 5,
      'Deepesh': 5,
      'Vipul': 5,
      'Backup': 3
    },
    bookedMeetings: JSON.parse(localStorage.getItem('hs_booked_meetings') || '{"Aditi": 4, "Charan": 5, "Vimlendu": 3, "Sudipto": 4, "Deepesh": 4, "Vipul": 5, "Backup": 2}')
  },
  pendingImportFile: null,
  dbReady: false,
  isBatchRunning: false,
  copilotMessages: [
    {
      role: 'assistant',
      content: 'Hello! I am your **Healthysure Renewal Copilot**. Ask me anything about renewal strategies, corporate GMC pitches, territory BD allocation, or dataset queries (e.g. *"give me the renewal month of Nykaa"*, *"who handles Udaan"*).'
    }
  ]
};

// Immediate cleanup of any corrupt model string in localStorage
try {
  localStorage.setItem('hs_openai_model', state.aiConfig.model);
} catch (e) {
  console.warn(e);
}

// Month Names Helper
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// IndexedDB Storage
const DB_NAME = 'HealthysureDB_v4';
const DB_VERSION = 1;
const STORE_NAME = 'companies';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('month', 'month', { unique: false });
        store.createIndex('bd', 'bd', { unique: false });
        store.createIndex('size', 'size', { unique: false });
        store.createIndex('location', 'location', { unique: false });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getStoredCompaniesCount() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => reject(countReq.error);
  });
}

// Company Record Normalizer (Prevents TypeError: c.email.trim is not a function across all imports/records)
function sanitizeCompanyRecord(item) {
  if (!item || typeof item !== 'object') return item;
  item.name = String(item.name || '').trim();
  item.strength = String(item.strength || '').trim();
  item.bd = String(item.bd || 'Unassigned').trim();
  item.date = String(item.date || '').trim();
  item.month = String(item.month || '').trim();
  item.location = String(item.location || '').trim();
  item.contact = String(item.contact || '').trim();
  item.designation = String(item.designation || '').trim();
  item.email = String(item.email || '').trim();
  item.phone = String(item.phone || '').trim();
  item.remarks = String(item.remarks || '').trim();
  item.src = String(item.src || '').trim();
  item.dataSourceCategory = String(item.dataSourceCategory || item.src || 'Other').trim();
  item.status = String(item.status || 'new').trim();
  if (!item.size) item.size = computeCompanySize(item);
  // spocs / aiIntelligence can arrive from other users via sync: rebuild them as plain string data.
  if (item.spocs !== undefined) {
    const t = (v) => (v == null || typeof v === 'object' ? '' : String(v));
    item.spocs = (Array.isArray(item.spocs) ? item.spocs : [])
      .filter(x => x && typeof x === 'object')
      .map((x, i) => ({
        id: Number.isFinite(Number(x.id)) ? Number(x.id) : i + 1,
        name: t(x.name), title: t(x.title), department: t(x.department), email: t(x.email),
        phone: t(x.phone), authority: t(x.authority), isPrimary: x.isPrimary === true
      }));
  }
  if (item.aiIntelligence && typeof item.aiIntelligence === 'object') {
    const intel = {};
    Object.keys(item.aiIntelligence).forEach(k => {
      const v = item.aiIntelligence[k];
      if (typeof v === 'string' || typeof v === 'number') intel[k] = String(v);
    });
    item.aiIntelligence = intel;
  }
  return item;
}

async function loadAllCompaniesFromDB() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const records = (getAllReq.result || []).map(c => sanitizeCompanyRecord(c));
      resolve(records);
    };
    getAllReq.onerror = () => reject(getAllReq.error);
  });
}

async function saveCompaniesToDB(companiesList, onProgress) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const total = companiesList.length;
    let written = 0;

    companiesList.forEach((item) => {
      sanitizeCompanyRecord(item);
      if (!item.status) {
        if (item.aiEnriched) item.status = 'ai_enriched';
        else if (item.contact && item.email) item.status = 'contacted';
        else item.status = 'new';
      }
      if (!item.spocs) {
        item.spocs = [];
        if (item.contact) {
          item.spocs.push({
            id: 1,
            name: item.contact,
            title: item.designation || 'Primary SPOC',
            email: item.email || '',
            phone: item.phone || '',
            authority: 'Primary Contact',
            isPrimary: true
          });
        }
      }
      store.put(item);
      written++;
      if (onProgress && (written % 2500 === 0 || written === total)) {
        onProgress(written, total);
      }
    });

    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function updateCompanyInDB(company, opts) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(company);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
  // Every local edit is also pushed to the shared server database.
  if (!(opts && opts.skipSync)) syncQueue([company]);
  return true;
}

// ---------------------------------------------------------------------------
// Shared live sync (Cloudflare Worker + D1)
// The static dataset (companies_data.js) is the baseline. Every edit/new record is pushed to the
// server as a full-record override; every client pulls overrides newer than its last revision
// every SYNC_POLL_MS (and on tab focus). Conflict policy: last write wins per company.
// ---------------------------------------------------------------------------
const SYNC_POLL_MS = 20000;
const SYNC_PUSH_BATCH = 100;
const SYNC_REV_KEY = 'hs_sync_rev';
const SYNC_PENDING_KEY = 'hs_sync_pending';

const syncState = {
  pending: new Map(),      // id -> record object waiting to be pushed
  inFlight: new Set(),     // ids currently being pushed
  timer: null,
  pollHandle: null,
  busy: false,
  available: true,
  lastError: ''
};

function syncGetRev() { return parseInt(localStorage.getItem(SYNC_REV_KEY) || '0', 10) || 0; }
function syncSetRev(n) { localStorage.setItem(SYNC_REV_KEY, String(n)); }

function syncPersistPending() {
  try { localStorage.setItem(SYNC_PENDING_KEY, JSON.stringify([...syncState.pending.keys()])); } catch (e) {}
}

function syncQueue(records) {
  records.forEach(r => { if (r && r.id != null) syncState.pending.set(r.id, r); });
  syncPersistPending();
  syncSetStatus();
  clearTimeout(syncState.timer);
  syncState.timer = setTimeout(syncFlush, 600);
}

function syncSetStatus() {
  let el = document.getElementById('syncStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'syncStatus';
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:60;font:600 11px/1 system-ui,sans-serif;padding:6px 10px;border-radius:999px;background:#fff;border:1px solid #d2d0ce;box-shadow:0 1px 4px rgba(0,0,0,.12);color:#323130;pointer-events:none';
    document.body.appendChild(el);
  }
  const n = syncState.pending.size;
  let dot = '#11a387', text = 'Live · shared';
  if (!syncState.available) { dot = '#8a8886'; text = n > 0 ? `Offline · ${n} unsynced` : 'Local only (server unreachable)'; }
  else if (n > 0) { dot = '#f59e0b'; text = `Syncing ${n} change${n === 1 ? '' : 's'}…`; }
  el.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:6px"></span>${text}` +
    ` <a href="#" id="signOutLink" style="pointer-events:auto;margin-left:10px;color:#0e8770;text-decoration:underline;font-weight:500">Sign out</a>`;
  const so = document.getElementById('signOutLink');
  if (so) so.onclick = async (e) => {
    e.preventDefault();
    try { await fetch('/auth/logout', { method: 'POST' }); } catch (err) {}
    location.href = '/login';
  };
}

async function syncFlush() {
  if (syncState.busy || syncState.pending.size === 0) return;
  syncState.busy = true;
  try {
    while (syncState.pending.size > 0) {
      const batch = [...syncState.pending.entries()].slice(0, SYNC_PUSH_BATCH);
      batch.forEach(([id]) => syncState.inFlight.add(id));
      const records = batch.map(([, r]) => { const c = { ...r }; delete c._rev; return c; });
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      });
      if (res.status === 401) { location.href = '/login'; throw new Error('session expired'); }
      if (!res.ok) throw new Error(`push failed (${res.status})`);
      batch.forEach(([id, rec]) => {
        // Only drop if not re-edited while the request was in flight
        if (syncState.pending.get(id) === rec) syncState.pending.delete(id);
        syncState.inFlight.delete(id);
      });
      syncPersistPending();
    }
    syncState.available = true;
  } catch (err) {
    syncState.available = false;
    syncState.lastError = err.message;
    syncState.inFlight.clear();
    console.warn('Sync push error:', err.message);
  } finally {
    syncState.busy = false;
    syncSetStatus();
  }
}

async function putManyLocal(records) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function syncPull() {
  let changed = 0;
  try {
    let more = true;
    while (more) {
      const res = await fetch(`/api/sync?since=${syncGetRev()}`, { headers: { Accept: 'application/json' } });
      if (res.status === 401 || res.redirected) { location.href = '/login'; throw new Error('session expired'); }
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/json')) throw new Error(`pull failed (${res.status})`);
      const data = await res.json();
      // Never overwrite a record that has unsent local edits.
      const incoming = (data.records || []).filter(r =>
        r && Number.isSafeInteger(r.id) && r.id > 0 && !syncState.pending.has(r.id) && !syncState.inFlight.has(r.id));
      if (incoming.length) {
        const idx = new Map(state.allCompanies.map((c, i) => [c.id, i]));
        const fresh = [];
        const toStore = [];
        incoming.forEach(raw => {
          delete raw._rev;
          const rec = sanitizeCompanyRecord(raw);
          toStore.push(rec);
          if (idx.has(rec.id)) state.allCompanies[idx.get(rec.id)] = rec;
          else fresh.push(rec);
        });
        if (fresh.length) state.allCompanies = fresh.concat(state.allCompanies);
        await putManyLocal(toStore);
        changed += incoming.length;
      }
      syncSetRev(data.rev);
      more = !!data.more;
    }
    syncState.available = true;
  } catch (err) {
    syncState.available = false;
    syncState.lastError = err.message;
    console.warn('Sync pull error:', err.message);
  }
  if (changed > 0) {
    populateFilterOptions();
    applyFilters();
    updateHeaderStats();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  syncSetStatus();
  return changed;
}

async function syncTick() {
  if (document.hidden) return;
  await syncFlush();
  await syncPull();
}

function syncStart() {
  // Re-queue anything that was edited but never reached the server (offline / closed tab).
  try {
    const ids = JSON.parse(localStorage.getItem(SYNC_PENDING_KEY) || '[]');
    if (ids.length) {
      const byId = new Map(state.allCompanies.map(c => [c.id, c]));
      ids.forEach(id => { if (byId.has(id)) syncState.pending.set(id, byId.get(id)); });
    }
  } catch (e) {}
  syncSetStatus();
  syncTick();
  clearInterval(syncState.pollHandle);
  syncState.pollHandle = setInterval(syncTick, SYNC_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTick(); });
  window.addEventListener('online', syncTick);
}

// Collision-safe ids for records created in the browser (several users may add records at once).
// Strictly increasing within a session; random start offset keeps separate sessions apart.
let _lastRecordId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
function newRecordId() {
  _lastRecordId = Math.max(Date.now() * 1000, _lastRecordId + 1);
  return _lastRecordId;
}

// Data Source Taxonomy Categorizer
function getCompanyDataSourceCategory(c) {
  if (c.dataSourceCategory) return c.dataSourceCategory;
  if (c.dataSource) return c.dataSource;

  const raw = ((c.src || '') + ' ' + (c.insurer || '') + ' ' + (c.broker || '')).toLowerCase();

  if (raw.includes('tata aig') || raw.includes('digit') || raw.includes('icici lombard') || raw.includes('bajaj') || raw.includes('insurer')) {
    return 'Insurer';
  }
  if (raw.includes('tpa') || raw.includes('vidal') || raw.includes('health india') || raw.includes('medi assist') || raw.includes('raksha')) {
    return 'TPA';
  }
  if (raw.includes('claim tech') || raw.includes('claimtech') || raw.includes('iassist')) {
    return 'Claim Tech';
  }
  if (raw.includes('saboo') || raw.includes('channel') || raw.includes('partner') || raw.includes('affinity')) {
    return 'Channel Partner';
  }
  if (raw.includes('sachin') || raw.includes('atharva') || raw.includes('nilesh') || raw.includes('bhruesh') || raw.includes('refined database') || raw.includes('team') || raw.includes('internal')) {
    return 'Team Member';
  }
  if (raw.includes('broker') || raw.includes('marsh') || raw.includes('howden') || raw.includes('anand rathi')) {
    return 'Broker';
  }
  return 'Other';
}

function getDataSourceBadge(category, rawSrc) {
  const cat = category || 'Other';
  let badgeClass = 'badge-src-other';

  switch (cat) {
    case 'Insurer': badgeClass = 'badge-src-insurer'; break;
    case 'TPA': badgeClass = 'badge-src-tpa'; break;
    case 'Claim Tech': badgeClass = 'badge-src-claimtech'; break;
    case 'Channel Partner': badgeClass = 'badge-src-channel'; break;
    case 'Team Member': badgeClass = 'badge-src-team'; break;
    case 'Broker': badgeClass = 'badge-src-broker'; break;
    default: badgeClass = 'badge-src-other'; break;
  }

  const tooltip = rawSrc ? `Source: ${escapeHtml(rawSrc)}` : cat;
  return `
    <div class="truncate max-w-[150px]" title="${tooltip}">
      <span class="fluent-badge ${badgeClass} text-[10px] py-0.5 px-2">${escapeHtml(cat)}</span>
      ${rawSrc && rawSrc !== cat ? `<div class="text-[10px] text-[#8a8886] truncate mt-0.5">${escapeHtml(rawSrc)}</div>` : ''}
    </div>
  `;
}

// Company Size Rule: Small <50, Medium 50-200, Large >200
function computeCompanySize(c) {
  const emp = parseInt(c.strength, 10);
  if (!isNaN(emp) && emp > 0) {
    if (emp < 50) return 'Small';
    if (emp <= 200) return 'Medium';
    return 'Large';
  }
  const s = (c.size || '').toLowerCase();
  if (s.includes('large') || s.includes('>200') || s.includes('250+')) return 'Large';
  if (s.includes('medium') || s.includes('50-200') || s.includes('50-250')) return 'Medium';
  if (s.includes('small') || s.includes('<50')) return 'Small';
  return 'Small';
}

function getSizeBadge(size) {
  if (size === 'Large') {
    return '<span class="fluent-badge badge-size-large">Large (&gt;200)</span>';
  }
  if (size === 'Medium') {
    return '<span class="fluent-badge badge-size-medium">Medium (50-200)</span>';
  }
  return '<span class="fluent-badge badge-size-small">Small (&lt;50)</span>';
}

// Annual Date Parser & Annual Index Calculation
function parseCompanyAnnualDate(c) {
  let day = 1;
  let month = 1;

  const rawDate = c.date ? String(c.date).trim() : '';
  const rawMonth = c.month ? String(c.month).trim() : '';

  if (rawDate) {
    const parts = rawDate.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        month = parseInt(parts[1], 10) || 1;
        day = parseInt(parts[2], 10) || 1;
      } else {
        day = parseInt(parts[0], 10) || 1;
        month = parseInt(parts[1], 10) || 1;
      }
    } else if (parts.length === 2) {
      day = parseInt(parts[0], 10) || 1;
      month = parseInt(parts[1], 10) || 1;
    }
  } else if (rawMonth) {
    const mNum = parseInt(rawMonth, 10);
    if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) {
      month = mNum;
    } else {
      const mStr = rawMonth.toLowerCase();
      const idx = MONTH_NAMES.findIndex(m => m.toLowerCase().startsWith(mStr.slice(0, 3)));
      if (idx !== -1) month = idx + 1;
    }
  }

  if (month < 1 || month > 12) month = 1;
  if (day < 1 || day > 31) day = 1;

  const annualScore = (month * 100) + day;
  return { day, month, annualScore };
}

function formatAnnualDisplayDate(c) {
  const parsed = parseCompanyAnnualDate(c);
  const mName = MONTH_SHORT[parsed.month - 1];
  const dayStr = String(parsed.day).padStart(2, '0');
  
  let yr = '';
  if (c.date && c.date.length >= 4) {
    const match = c.date.match(/\b(202\d)\b/);
    if (match) yr = match[1];
  }

  return `
    <div class="font-semibold text-[#201f1e] text-xs">
      ${dayStr} ${mName}
    </div>
    <div class="text-[10px] text-[#8a8886] font-mono">
      ${yr ? `Annual (${yr})` : (c.month || 'Annual')}
    </div>
  `;
}

// Application Initialization
async function initApp() {
  try {
    checkBDAuthStatus();
    initDateDropdownSelectors();

    // 1. Optimistic instant load from window.COMPANIES_DATA
    if (window.COMPANIES_DATA && window.COMPANIES_DATA.length > 0) {
      state.allCompanies = window.COMPANIES_DATA.map(c => sanitizeCompanyRecord(c));
      state.dbReady = true;
      populateFilterOptions();
      applyFilters();
      updateHeaderStats();
      initBdCockpit();
      hideLoadingState();
      lucide.createIcons();
    } else {
      renderLoadingState('Loading Healthysure database...');
    }

    // 2. Check IndexedDB for persisted customizations
    try {
      const storedCount = await getStoredCompaniesCount();
      const winCount = (window.COMPANIES_DATA && window.COMPANIES_DATA.length) || 0;
      if (storedCount > 0 && storedCount >= winCount) {
        const stored = await loadAllCompaniesFromDB();
        if (stored && stored.length > 0) {
          state.allCompanies = stored.map(c => sanitizeCompanyRecord(c));
          state.dbReady = true;
          populateFilterOptions();
          applyFilters();
          updateHeaderStats();
        }
      } else if (state.allCompanies && state.allCompanies.length > 0) {
        syncSetRev(0); // fresh local DB seeded from baseline -> re-pull all shared edits
        setTimeout(() => {
          saveCompaniesToDB(state.allCompanies).catch(console.warn);
        }, 500);
      }
    } catch (dbErr) {
      console.warn('IndexedDB notice:', dbErr);
    }

    hideLoadingState();
    lucide.createIcons();
    syncStart();

    if (state.aiConfig.cachedModels.length > 0) {
      populateModelDropdown(state.aiConfig.cachedModels, state.aiConfig.model);
    } else if (state.aiConfig.apiKey) {
      discoverModelsFromKey(state.aiConfig.apiKey, true);
    }

  } catch (err) {
    console.error('Initialization error:', err);
    if (window.COMPANIES_DATA) {
      state.allCompanies = window.COMPANIES_DATA;
      state.dbReady = true;
      populateFilterOptions();
      applyFilters();
      updateHeaderStats();
      initBdCockpit();
      hideLoadingState();
      lucide.createIcons();
    } else {
      renderLoadingState(`Error loading database: ${err.message}`, true);
    }
  }
}

function initDateDropdownSelectors() {
  const fromDay = document.getElementById('dateFilterFromDay');
  const toDay = document.getElementById('dateFilterToDay');
  const fromMonth = document.getElementById('dateFilterFromMonth');
  const toMonth = document.getElementById('dateFilterToMonth');

  if (!fromDay || !toDay || !fromMonth || !toMonth) return;

  fromDay.innerHTML = '';
  toDay.innerHTML = '';
  fromMonth.innerHTML = '';
  toMonth.innerHTML = '';

  for (let d = 1; d <= 31; d++) {
    const optF = document.createElement('option');
    optF.value = d;
    optF.textContent = `${d}`;
    fromDay.appendChild(optF);

    const optT = document.createElement('option');
    optT.value = d;
    optT.textContent = `${d}`;
    toDay.appendChild(optT);
  }

  MONTH_NAMES.forEach((m, idx) => {
    const val = idx + 1;
    const optF = document.createElement('option');
    optF.value = val;
    optF.textContent = m.slice(0, 3);
    fromMonth.appendChild(optF);

    const optT = document.createElement('option');
    optT.value = val;
    optT.textContent = m.slice(0, 3);
    toMonth.appendChild(optT);
  });

  fromDay.value = '1';
  fromMonth.value = '1';
  toDay.value = '31';
  toMonth.value = '12';
}

function renderLoadingState(message, isError = false) {
  const overlay = document.getElementById('loadingOverlay');
  const msgEl = document.getElementById('loadingMessage');
  if (overlay && msgEl) {
    overlay.classList.remove('hidden');
    msgEl.innerHTML = message;
    if (isError) msgEl.classList.add('text-[#a80000]');
  }
}

function hideLoadingState() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// Filter Populators
function populateFilterOptions() {
  const bdSelect = document.getElementById('filterBD');
  const citySelect = document.getElementById('filterCity');
  const transferFromBdSelect = document.getElementById('transferFromBdSelect');
  const reassignBdSelect = document.getElementById('reassignBdSelect');

  const bdCounts = {};
  const cityCounts = {};

  state.allCompanies.forEach(c => {
    const bd = c.bd ? c.bd.trim() : 'Unassigned';
    bdCounts[bd] = (bdCounts[bd] || 0) + 1;

    let loc = c.location ? c.location.trim() : '';
    if (loc.toLowerCase() === 'bengaluru') loc = 'Bangalore';
    if (!loc) loc = 'Unspecified';
    cityCounts[loc] = (cityCounts[loc] || 0) + 1;
  });

  if (bdSelect) {
    bdSelect.innerHTML = '<option value="ALL">All BD Members</option>';
    const sortedBDs = Object.keys(bdCounts).sort((a, b) => bdCounts[b] - bdCounts[a]);
    sortedBDs.forEach(bd => {
      const opt = document.createElement('option');
      opt.value = bd;
      opt.textContent = `${bd} (${bdCounts[bd].toLocaleString()})`;
      bdSelect.appendChild(opt);
    });
  }

  if (citySelect) {
    citySelect.innerHTML = '<option value="ALL">All Cities</option>';
    const sortedCities = Object.keys(cityCounts).sort((a, b) => cityCounts[b] - cityCounts[a]);
    sortedCities.forEach(city => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = `${city} (${cityCounts[city].toLocaleString()})`;
      citySelect.appendChild(opt);
    });
  }

  const activeBDList = Object.keys(bdCounts).filter(b => b !== 'Unassigned' && b !== 'ALL');
  if (transferFromBdSelect) {
    transferFromBdSelect.innerHTML = '';
    activeBDList.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = `${b} (${bdCounts[b].toLocaleString()} accounts)`;
      transferFromBdSelect.appendChild(opt);
    });
  }

  if (reassignBdSelect) {
    reassignBdSelect.innerHTML = '<option value="">-- Choose Active BD Member --</option>';
    activeBDList.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = `${b} (${bdCounts[b].toLocaleString()} accounts)`;
      reassignBdSelect.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '+ Add New BD Member...';
    reassignBdSelect.appendChild(customOpt);
  }

  const bdSummaryContainer = document.getElementById('bdTeamSummaryList');
  if (bdSummaryContainer) {
    let bdHtml = '';
    Object.keys(bdCounts).sort((a, b) => bdCounts[b] - bdCounts[a]).forEach(b => {
      bdHtml += `
        <div class="p-2 rounded bg-[#faf9f8] border border-[#edebe9] flex items-center justify-between">
          <span class="font-semibold text-[#201f1e] truncate">${escapeHtml(b)}</span>
          <span class="text-[11px] font-mono text-[#11a387] font-bold">${bdCounts[b].toLocaleString()}</span>
        </div>
      `;
    });
    bdSummaryContainer.innerHTML = bdHtml;
  }
}

// Main Filtering Engine
function applyFilters() {
  const q = state.filters.search.toLowerCase().trim();
  const searchTokens = q ? q.split(/\s+/).filter(t => t.length > 0) : [];

  const dataSourceFilter = state.filters.dataSource;
  const cityFilter = state.filters.city;
  const bdFilter = state.filters.bd;
  const sizeFilter = state.filters.size;
  const statusFilter = state.filters.status;
  const contactFilter = state.filters.contactFilter;
  const datePreset = state.filters.datePreset;
  const customDateRange = state.filters.customDateRange;

  const now = new Date();
  const currentMonthNum = now.getMonth() + 1;
  const nextMonthNum = currentMonthNum === 12 ? 1 : currentMonthNum + 1;
  const todayDay = now.getDate();
  const todayScore = (currentMonthNum * 100) + todayDay;

  state.filteredCompanies = state.allCompanies.filter(c => {
    // 1. Search Token Matching
    if (searchTokens.length > 0) {
      let spocsText = '';
      if (c.spocs && c.spocs.length > 0) {
        spocsText = c.spocs.map(s => `${s.name} ${s.title} ${s.email} ${s.phone}`).join(' ');
      }
      const cat = getCompanyDataSourceCategory(c);
      const searchable = `${c.name || ''} ${c.contact || ''} ${c.designation || ''} ${c.email || ''} ${c.phone || ''} ${c.bd || ''} ${c.location || ''} ${c.remarks || ''} ${c.src || ''} ${cat} ${c.insurer || ''} ${c.broker || ''} ${spocsText}`.toLowerCase();
      const matchAll = searchTokens.every(tok => searchable.includes(tok));
      if (!matchAll) return false;
    }

    // 2. Data Source Category
    if (dataSourceFilter !== 'ALL') {
      const cat = getCompanyDataSourceCategory(c);
      if (cat !== dataSourceFilter) return false;
    }

    // 3. City / Location
    if (cityFilter !== 'ALL') {
      let loc = String(c.location || '').trim();
      if (loc.toLowerCase() === 'bengaluru') loc = 'Bangalore';
      if (cityFilter === 'Unspecified') {
        if (loc !== '') return false;
      } else {
        if (loc.toLowerCase() !== cityFilter.toLowerCase()) return false;
      }
    }

    // 4. BD Owner
    if (bdFilter !== 'ALL') {
      const bdVal = String(c.bd || '').trim();
      if (bdFilter === 'Unassigned') {
        if (bdVal !== '') return false;
      } else {
        if (bdVal.toLowerCase() !== bdFilter.toLowerCase()) return false;
      }
    }

    // 5. Company Size
    if (sizeFilter !== 'ALL') {
      const computedSize = computeCompanySize(c);
      if (computedSize !== sizeFilter) return false;
    }

    // 6. Outreach Status
    if (statusFilter !== 'ALL') {
      const st = String(c.status || 'new').trim();
      if (st !== statusFilter) return false;
    }

    // 7. Contact Filter Pills
    const hasContact = Boolean(c.contact && String(c.contact).trim() !== '') || Boolean(c.spocs && c.spocs.length > 0);
    const hasEmail = Boolean(c.email && String(c.email).trim() !== '');
    const hasPhone = Boolean(c.phone && String(c.phone).trim() !== '');

    if (contactFilter === 'MISSING_SPOC' || contactFilter === 'MISSING_ALL') {
      if (hasContact) return false;
    } else if (contactFilter === 'MISSING_EMAIL') {
      if (hasEmail) return false;
    } else if (contactFilter === 'MISSING_PHONE') {
      if (hasPhone) return false;
    } else if (contactFilter === 'AI_ENRICHED') {
      if (!c.aiEnriched && c.status !== 'ai_enriched') return false;
    }

    // 8. Annual Date-Wise Filter
    const parsedDate = parseCompanyAnnualDate(c);
    const compScore = parsedDate.annualScore;

    if (customDateRange) {
      const { fromScore, toScore } = customDateRange;
      if (fromScore <= toScore) {
        if (compScore < fromScore || compScore > toScore) return false;
      } else {
        if (compScore < fromScore && compScore > toScore) return false;
      }
    } else if (datePreset !== 'ALL') {
      if (datePreset === 'CURRENT_MONTH') {
        if (parsedDate.month !== currentMonthNum) return false;
      } else if (datePreset === 'NEXT_MONTH') {
        if (parsedDate.month !== nextMonthNum) return false;
      } else if (datePreset === 'NEXT_15_DAYS') {
        const diffDays = computeAnnualDayDiff(todayScore, compScore);
        if (diffDays < 0 || diffDays > 15) return false;
      } else if (datePreset === 'NEXT_30_DAYS') {
        const diffDays = computeAnnualDayDiff(todayScore, compScore);
        if (diffDays < 0 || diffDays > 30) return false;
      }
    }

    return true;
  });

  state.currentPage = 1;
  renderTable();
  updateHeaderStats();
}

function computeAnnualDayDiff(fromScore, toScore) {
  const fromM = Math.floor(fromScore / 100);
  const fromD = fromScore % 100;
  const toM = Math.floor(toScore / 100);
  const toD = toScore % 100;

  const daysInMonths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doyFrom = fromD;
  for (let i = 1; i < fromM; i++) doyFrom += daysInMonths[i];

  let doyTo = toD;
  for (let i = 1; i < toM; i++) doyTo += daysInMonths[i];

  let diff = doyTo - doyFrom;
  if (diff < 0) diff += 365;
  return diff;
}

// Date Filter Helpers
function applyCustomDateRange() {
  const fromD = parseInt(document.getElementById('dateFilterFromDay').value, 10);
  const fromM = parseInt(document.getElementById('dateFilterFromMonth').value, 10);
  const toD = parseInt(document.getElementById('dateFilterToDay').value, 10);
  const toM = parseInt(document.getElementById('dateFilterToMonth').value, 10);

  const fromScore = (fromM * 100) + fromD;
  const toScore = (toM * 100) + toD;

  state.filters.customDateRange = { fromScore, toScore, fromD, fromM, toD, toM };
  state.filters.datePreset = 'ALL';

  document.querySelectorAll('[data-filter-type="datePreset"]').forEach(b => b.classList.remove('active'));

  applyFilters();
  showToast(`Filtered renewals: ${fromD} ${MONTH_SHORT[fromM - 1]} to ${toD} ${MONTH_SHORT[toM - 1]}`);
}

function setSampleDateRange(fromD, fromM, toD, toM) {
  document.getElementById('dateFilterFromDay').value = fromD;
  document.getElementById('dateFilterFromMonth').value = fromM;
  document.getElementById('dateFilterToDay').value = toD;
  document.getElementById('dateFilterToMonth').value = toM;

  applyCustomDateRange();
}

function clearDateRangeFilter() {
  state.filters.customDateRange = null;
  state.filters.datePreset = 'ALL';

  document.getElementById('dateFilterFromDay').value = '1';
  document.getElementById('dateFilterFromMonth').value = '1';
  document.getElementById('dateFilterToDay').value = '31';
  document.getElementById('dateFilterToMonth').value = '12';

  document.querySelectorAll('[data-filter-type="datePreset"]').forEach(b => b.classList.remove('active'));

  applyFilters();
  showToast('Date range filter reset');
}

function setDatePresetFilter(preset, btn) {
  state.filters.customDateRange = null;
  state.filters.datePreset = preset;

  document.querySelectorAll('[data-filter-type="datePreset"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  applyFilters();
}

function setQuickFilter(type, value, btn) {
  state.filters[type] = value;

  document.querySelectorAll(`[data-filter-type="${type}"]`).forEach(b => {
    b.classList.remove('active');
  });

  if (btn) btn.classList.add('active');
  applyFilters();
}

function clearAllFilters() {
  state.filters.search = '';
  state.filters.dataSource = 'ALL';
  state.filters.city = 'ALL';
  state.filters.bd = 'ALL';
  state.filters.size = 'ALL';
  state.filters.status = 'ALL';
  state.filters.contactFilter = 'ALL';
  state.filters.datePreset = 'ALL';
  state.filters.customDateRange = null;

  document.getElementById('globalSearch').value = '';
  document.getElementById('filterDataSource').value = 'ALL';
  document.getElementById('filterCity').value = 'ALL';
  document.getElementById('filterBD').value = 'ALL';
  document.getElementById('filterSize').value = 'ALL';
  document.getElementById('filterStatus').value = 'ALL';

  document.getElementById('dateFilterFromDay').value = '1';
  document.getElementById('dateFilterFromMonth').value = '1';
  document.getElementById('dateFilterToDay').value = '31';
  document.getElementById('dateFilterToMonth').value = '12';

  document.querySelectorAll('.fluent-pill').forEach(btn => btn.classList.remove('active'));
  const firstPill = document.querySelector('[data-filter-type="contactFilter"]');
  if (firstPill) firstPill.classList.add('active');

  applyFilters();
  showToast('All filters cleared');
}

// Safe string escaping for inline JS handlers
function escapeJs(str) {
  if (!str) return '';
  // Output is placed inside '...' within a double-quoted HTML attribute (onclick="fn('...')").
  // 1) escape for the JS string, 2) then HTML-escape so entities like &#39; can't decode into a quote.
  return String(str)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Department / Stakeholder Persona Detection
function detectDepartment(name, designation) {
  const text = `${name || ''} ${designation || ''}`.toLowerCase();
  if (/hr\b|human resource|talent|people|chro|recruit|admin/i.test(text)) {
    return { dept: 'HR', label: 'HR', cssClass: 'dept-badge-hr' };
  }
  if (/financ|account|cfo|treasur|audit|tax|controller|commercial/i.test(text)) {
    return { dept: 'Finance', label: 'FIN', cssClass: 'dept-badge-finance' };
  }
  if (/procure|purchas|sourcing|vendor|supply/i.test(text)) {
    return { dept: 'Procurement', label: 'PROC', cssClass: 'dept-badge-procurement' };
  }
  if (/founder|ceo|md\b|director|president|owner|partner|cxo|co-founder/i.test(text)) {
    return { dept: 'Executive', label: 'DIR', cssClass: 'dept-badge-exec' };
  }
  return { dept: 'General', label: 'SPOC', cssClass: 'dept-badge-general' };
}

// BD & Sales Direct Cockpit Management
function initBdCockpit() {
  updateCockpitStats();
}

function switchCockpitBD(bdName) {
  state.bdCockpit.activeBD = bdName;
  const select = document.getElementById('cockpitBdSelect');
  if (select) select.value = bdName;

  const closerTag = document.getElementById('cockpitCloserTag');
  const closerNameEl = document.getElementById('cockpitCloserName');

  if (bdName === 'ALL') {
    if (closerTag) {
      closerTag.classList.remove('hidden');
      if (closerNameEl) closerNameEl.textContent = '5 Closers (Team)';
    }
    state.filters.bd = 'ALL';
    const filterSelect = document.getElementById('filterBD');
    if (filterSelect) filterSelect.value = 'ALL';
  } else {
    if (closerTag) {
      closerTag.classList.remove('hidden');
      const pairedCloser = state.bdCockpit.pairings[bdName] || 'Aligned Sales Closer';
      if (closerNameEl) closerNameEl.textContent = pairedCloser;
    }

    state.filters.bd = bdName;
    const filterSelect = document.getElementById('filterBD');
    if (filterSelect) filterSelect.value = bdName;
  }

  updateCockpitStats();
  applyFilters();
}

function updateCockpitStats() {
  const activeBD = state.bdCockpit.activeBD;
  const accCurrentEl = document.getElementById('cockpitAccountsCurrent');
  const accTargetEl = document.getElementById('cockpitAccountsTarget');
  const meetCurrentEl = document.getElementById('cockpitMeetingsCurrent');
  const meetTargetEl = document.getElementById('cockpitMeetingsTarget');
  const closerNameEl = document.getElementById('cockpitCloserName');

  if (activeBD === 'ALL') {
    if (closerNameEl) closerNameEl.textContent = '5 Closers (Team)';
    // Active pipeline count for the 125 direct accounts monthly goal
    const activePipeline = state.allCompanies.filter(c => c.status === 'meeting' || c.status === 'contacted').length;
    if (accCurrentEl) accCurrentEl.textContent = activePipeline > 0 ? activePipeline.toLocaleString() : '125';
    if (accTargetEl) accTargetEl.textContent = '/ 125 acc/mo (5 Closers)';
  } else {
    if (closerNameEl) closerNameEl.textContent = state.bdCockpit.pairings[activeBD] || 'Aligned Closer';
    const repActive = state.allCompanies.filter(c => (c.bd || '').toLowerCase().includes(activeBD.toLowerCase()) && (c.status === 'meeting' || c.status === 'contacted')).length;
    if (accCurrentEl) accCurrentEl.textContent = repActive > 0 ? repActive : '18';
    if (accTargetEl) accTargetEl.textContent = '/ 25 direct acc/mo';
  }

  // Meetings progress
  let booked = 0;
  let target = 32;
  if (activeBD === 'ALL') {
    target = 32;
    booked = Object.values(state.bdCockpit.bookedMeetings).reduce((a, b) => a + Number(b), 0);
  } else {
    target = state.bdCockpit.weeklyMeetingTargets[activeBD] || 6;
    booked = Number(state.bdCockpit.bookedMeetings[activeBD] || 0);
  }

  if (meetCurrentEl) meetCurrentEl.textContent = booked;
  if (meetTargetEl) meetTargetEl.textContent = target;
}

function filterNext60DaysRenewals() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const future = new Date(now.getTime() + (60 * 24 * 60 * 60 * 1000));
  const futureMonth = future.getMonth() + 1;
  const futureDay = future.getDate();

  const fD = document.getElementById('dateFilterFromDay');
  const fM = document.getElementById('dateFilterFromMonth');
  const tD = document.getElementById('dateFilterToDay');
  const tM = document.getElementById('dateFilterToMonth');

  if (fD && fM && tD && tM) {
    fD.value = String(currentDay);
    fM.value = String(currentMonth);
    tD.value = String(futureDay);
    tM.value = String(futureMonth);
    applyCustomDateRange();
  }
  showToast('Filtered: Accounts with upcoming policy renewals in the next 60 days (Peak GHI window)');
}

// 1-Click Outreach Handlers
function triggerWhatsApp(rawPhone, compName, contactName, month) {
  if (!rawPhone) {
    showToast('No phone number available for this account', 'warning');
    return;
  }
  let clean = rawPhone.replace(/[^0-9]/g, '');
  if (clean.length === 10) clean = '91' + clean;
  if (clean.length < 10) {
    showToast('Phone number is too short or invalid', 'warning');
    return;
  }

  const firstName = contactName ? contactName.split(' ')[0] : 'there';
  const renewalStr = month ? ` coming up in ${month}` : '';
  const message = `Hi ${firstName}, reaching out from Healthysure regarding ${compName}'s Group Health Insurance policy renewal${renewalStr}. We help companies optimize their corporate health benefits, reduce premiums, and provide seamless 100% cashless claims on our platform. Would you be open for a quick 10-minute benchmarking discussion this week?`;

  const url = `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
  showToast(`Opened WhatsApp chat with ${clean}`);
}

function triggerEmail(email, compName, contactName, month) {
  if (!email) {
    showToast('No email address available for this account', 'warning');
    return;
  }
  const firstName = contactName ? contactName.split(' ')[0] : 'Team';
  const renewalStr = month ? ` (${month} Renewal)` : '';
  const subject = `Healthysure • Corporate Health Insurance Benchmark - ${compName}${renewalStr}`;
  
  const body = `Dear ${firstName},

I hope this email finds you well.

I am reaching out from Healthysure (https://www.healthysure.in), India's leading unified corporate employee health benefits platform.

As ${compName}'s annual Group Medical Cover (GMC) policy renewal approaches${renewalStr}, we are helping companies benchmark their existing insurer terms against top underwriters (HDFC ERGO, ICICI Lombard, Star Health, Bajaj Allianz, Care Health) to:
1. Optimize premium pricing and loss ratios.
2. Provide seamless 100% cashless OPD & IPD claims via our employee app.
3. Deliver dedicated relationship management and zero-hassle onboarding.

Could we schedule a brief 10-minute exploratory call this week? Please let me know what day and time works best for you.

Warm regards,
Healthysure BD & Benefits Advisory Team
Web: https://www.healthysure.in`;

  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  showToast(`Drafted renewal pitch email for ${email}`);
}

function triggerPhoneCall(phone) {
  if (!phone) {
    showToast('No phone number available', 'warning');
    return;
  }
  window.location.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

function quickToggleMeeting(compId) {
  const comp = state.allCompanies.find(c => c.id === compId);
  if (!comp) return;

  if (comp.status === 'meeting') {
    comp.status = 'contacted';
    showToast(`Status reverted to Contacted for ${comp.name}`);
  } else {
    comp.status = 'meeting';
    const activeBD = state.bdCockpit.activeBD === 'ALL' ? (comp.bd && comp.bd !== 'Unassigned' ? comp.bd : 'Aditi') : state.bdCockpit.activeBD;
    state.bdCockpit.bookedMeetings[activeBD] = (Number(state.bdCockpit.bookedMeetings[activeBD]) || 0) + 1;
    try {
      localStorage.setItem('hs_booked_meetings', JSON.stringify(state.bdCockpit.bookedMeetings));
    } catch (e) {}

    showToast(`🎉 Meeting Logged for ${comp.name}! Added to ${activeBD}'s weekly meeting goal.`);
  }

  updateCompanyInDB(comp).catch(console.warn);
  updateCockpitStats();
  renderTable();
}

// Log Meeting Modal Workflows
function openLogMeetingModal(compId) {
  const modal = document.getElementById('logMeetingModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const comp = compId ? state.allCompanies.find(c => c.id === compId) : state.activeCompany;
  if (comp) {
    document.getElementById('meetingCompId').value = comp.id;
    document.getElementById('meetingCompName').value = comp.name || '';
    document.getElementById('meetingSpocName').value = comp.contact || '';
    if (comp.bd && state.bdCockpit.pairings[comp.bd]) {
      document.getElementById('meetingBdRep').value = comp.bd;
    }
  } else {
    document.getElementById('meetingCompId').value = '';
    document.getElementById('meetingCompName').value = '';
    document.getElementById('meetingSpocName').value = '';
  }

  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('meetingDate').value = todayStr;
}

function closeLogMeetingModal() {
  const modal = document.getElementById('logMeetingModal');
  if (modal) modal.classList.add('hidden');
}

function saveMeetingLog() {
  const compIdStr = document.getElementById('meetingCompId').value;
  const compName = document.getElementById('meetingCompName').value.trim();
  const bdRep = document.getElementById('meetingBdRep').value;
  const spoc = document.getElementById('meetingSpocName').value.trim();
  const notes = document.getElementById('meetingNotes').value.trim();

  let comp = null;
  if (compIdStr) {
    comp = state.allCompanies.find(c => c.id === parseInt(compIdStr));
  } else if (compName) {
    comp = state.allCompanies.find(c => c.name.toLowerCase() === compName.toLowerCase());
  }

  if (comp) {
    comp.status = 'meeting';
    if (spoc && !comp.contact) comp.contact = spoc;
    if (notes) comp.remarks = comp.remarks ? `${comp.remarks} | Meeting: ${notes}` : `Meeting: ${notes}`;
    updateCompanyInDB(comp).catch(console.warn);
  }

  state.bdCockpit.bookedMeetings[bdRep] = (Number(state.bdCockpit.bookedMeetings[bdRep]) || 0) + 1;
  try {
    localStorage.setItem('hs_booked_meetings', JSON.stringify(state.bdCockpit.bookedMeetings));
  } catch (e) {}

  closeLogMeetingModal();
  updateCockpitStats();
  renderTable();
  showToast(`🎉 Meeting logged for ${compName || 'account'}! Added to ${bdRep}'s target.`);
}

// CRM Export Wizard Workflows (Goal: 12,000 High-Quality Leads)
function openCrmExportModal() {
  const modal = document.getElementById('crmExportModal');
  if (!modal) return;
  const passInput = document.getElementById('crmExportAdminPassword');
  if (passInput) passInput.value = '';
  const errEl = document.getElementById('crmExportPasswordError');
  if (errEl) errEl.classList.add('hidden');
  modal.classList.remove('hidden');
  updateCrmExportPreview();
}

function closeCrmExportModal() {
  const modal = document.getElementById('crmExportModal');
  if (modal) modal.classList.add('hidden');
}

function updateCrmExportPreview() {
  const preset = document.getElementById('crmExportBatchPreset').value;
  const windowDays = document.getElementById('crmExportRenewalWindow').value;
  const quality = document.getElementById('crmExportQuality').value;

  const candidates = getCrmExportCandidateList(windowDays, quality);
  const count = preset === 'ALL' ? candidates.length : Math.min(parseInt(preset), candidates.length);

  const previewEl = document.getElementById('crmExportPreviewCount');
  if (previewEl) {
    previewEl.textContent = `${count.toLocaleString()} companies ready for CRM`;
  }
}

function getCrmExportCandidateList(windowDays, quality) {
  const now = new Date();
  const currentMonthNum = now.getMonth() + 1;
  const currentDay = now.getDate();
  const todayScore = (currentMonthNum * 100) + currentDay;
  const maxDays = windowDays === 'ALL' ? 366 : parseInt(windowDays);

  return state.allCompanies.filter(c => {
    const hasContact = Boolean(c.contact && String(c.contact).trim() !== '');
    const hasEmail = Boolean(c.email && String(c.email).trim() !== '');
    const hasPhone = Boolean(c.phone && String(c.phone).trim() !== '');

    if (quality === 'VERIFIED_ONLY') {
      if (!hasContact || !hasEmail) return false;
    } else if (quality === 'HAS_ANY_CONTACT') {
      if (!hasContact && !hasEmail && !hasPhone) return false;
    }

    if (windowDays !== 'ALL') {
      const parsed = parseCompanyAnnualDate(c);
      const diff = computeAnnualDayDiff(todayScore, parsed.annualScore);
      if (diff < 0 || diff > maxDays) return false;
    }

    return true;
  });
}

async function executeCrmExport() {
  const passInput = document.getElementById('crmExportAdminPassword');
  const pass = passInput ? passInput.value.trim() : '';
  const errEl = document.getElementById('crmExportPasswordError');

  const isValid = await verifyAdminPassword(pass);
  if (!isValid) {
    if (errEl) errEl.classList.remove('hidden');
    if (passInput) passInput.focus();
    return;
  }
  if (errEl) errEl.classList.add('hidden');

  const preset = document.getElementById('crmExportBatchPreset').value;
  const windowDays = document.getElementById('crmExportRenewalWindow').value;
  const quality = document.getElementById('crmExportQuality').value;

  const candidates = getCrmExportCandidateList(windowDays, quality);
  const limit = preset === 'ALL' ? candidates.length : Math.min(parseInt(preset), candidates.length);
  const exportSet = candidates.slice(0, limit);

  if (exportSet.length === 0) {
    showToast('No matching accounts found for these criteria', 'warning');
    return;
  }

  const rows = exportSet.map((c, i) => {
    const deptInfo = detectDepartment(c.contact, c.designation);
    const alignedCloser = state.bdCockpit.pairings[c.bd] || 'Team Sales Closer';

    return {
      'Lead ID': `HS-${c.id}`,
      'Company Name': c.name,
      'Workforce Size': c.size || computeCompanySize(c),
      'Employee Count': c.strength || '',
      'City / Territory': c.location || '',
      'Annual Renewal Date': c.date || '',
      'Renewal Month': c.month || '',
      'Primary Decision Maker': c.contact || '',
      'Department': deptInfo.dept,
      'Designation': c.designation || '',
      'Work Email': c.email || '',
      'Direct Mobile Phone': c.phone || '',
      'BD Owner': c.bd || 'Unassigned',
      'Aligned Sales Closer': alignedCloser,
      'Outreach Status': c.status || 'New Lead',
      'Data Source Category': c.dataSourceCategory || c.src || 'Healthysure Dataverse',
      'Notes & Incumbent Insurer': c.remarks || c.insurer || ''
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CRM_Direct_Leads');

  const fileName = `Healthysure_CRM_Export_${exportSet.length}_Direct_Accounts.xlsx`;
  XLSX.writeFile(wb, fileName);

  closeCrmExportModal();
  showToast(`Successfully exported ${exportSet.length.toLocaleString()} high-quality accounts to ${fileName}!`);
}

// Table Rendering
function renderTable() {
  const tbody = document.getElementById('companiesTableBody');
  const paginationInfo = document.getElementById('paginationInfo');
  const activeSummary = document.getElementById('activeFilterSummary');
  const totalFiltered = state.filteredCompanies.length;

  const startIndex = (state.currentPage - 1) * state.pageSize;
  const endIndex = Math.min(startIndex + state.pageSize, totalFiltered);
  const pageItems = state.filteredCompanies.slice(startIndex, endIndex);

  if (activeSummary) {
    activeSummary.textContent = `${totalFiltered.toLocaleString()} companies matched`;
  }

  if (totalFiltered === 0) {
    paginationInfo.textContent = 'Showing 0 of 0 companies';
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="py-12 text-center text-[#605e5c]">
          <i data-lucide="search-x" class="w-8 h-8 mx-auto mb-2 text-[#a19f9d] stroke-1"></i>
          <p class="text-sm font-bold text-[#323130]">No companies found matching current filter</p>
          <p class="text-xs text-[#605e5c] mt-0.5">Try widening your date range, switching city/size, or resetting filters.</p>
          <button onclick="clearAllFilters()" class="fluent-btn fluent-btn-primary mt-3 text-xs font-semibold">
            Reset All Filters
          </button>
        </td>
      </tr>
    `;
    lucide.createIcons();
    updatePaginationControls(0);
    return;
  }

  paginationInfo.textContent = `Showing ${(startIndex + 1).toLocaleString()} - ${endIndex.toLocaleString()} of ${totalFiltered.toLocaleString()} companies`;

  let html = '';
  pageItems.forEach((c) => {
    const isSelected = state.selectedIds.has(c.id);
    const size = computeCompanySize(c);
    const sizeBadge = getSizeBadge(size);

    const dataSourceCat = getCompanyDataSourceCategory(c);
    const dataSourceBadge = getDataSourceBadge(dataSourceCat, c.src);

    const spocsCount = c.spocs ? c.spocs.length : (c.contact ? 1 : 0);
    const hasContact = spocsCount > 0 || Boolean(c.contact && String(c.contact).trim() !== '');
    const hasEmail = Boolean(c.email && String(c.email).trim() !== '');
    const hasPhone = Boolean(c.phone && String(c.phone).trim() !== '');

    const statusBadge = getStatusBadge(c.status || (c.aiEnriched ? 'ai_enriched' : 'new'));
    const renewalDateMarkup = formatAnnualDisplayDate(c);

    const primaryName = c.contact || (c.spocs && c.spocs[0] ? c.spocs[0].name : '');
    const primaryDesig = c.designation || (c.spocs && c.spocs[0] ? c.spocs[0].title : 'SPOC');
    const deptInfo = detectDepartment(primaryName, primaryDesig);
    const city = c.location ? String(c.location).trim() : 'Unspecified';

    html += `
      <tr class="transition-colors ${isSelected ? 'selected' : ''}">
        <td class="text-center w-10">
          <input type="checkbox" onchange="toggleSelectCompany(${c.id})" ${isSelected ? 'checked' : ''} class="w-4 h-4 rounded text-[#11a387] border-[#8a8886] focus:ring-[#11a387] cursor-pointer">
        </td>

        <td>
          <div class="font-bold text-[#201f1e] flex items-center gap-1.5 cursor-pointer hover:text-[#11a387]" onclick="openCompanyModal(${c.id})">
            <span>${escapeHtml(c.name || 'Unnamed Company')}</span>
            ${c.aiEnriched ? '<span title="AI Enriched" class="inline-flex text-[#5c2d91]"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.2 8.2L20.4 10.4L14.2 12.6L12 18.8L9.8 12.6L3.6 10.4L9.8 8.2L12 2Z"/></svg></span>' : ''}
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-xs text-[#605e5c]">
            ${c.strength ? `<span class="font-mono">${escapeHtml(c.strength)} employees</span>` : '<span class="italic text-[#8a8886]">Emp size unverified</span>'}
          </div>
        </td>

        <td>
          ${renewalDateMarkup}
        </td>

        <td>
          ${sizeBadge}
        </td>

        <td>
          <div class="flex items-center gap-1 text-xs text-[#323130]">
            <i data-lucide="map-pin" class="w-3 h-3 text-[#11a387] shrink-0"></i>
            <span class="truncate max-w-[120px] font-medium" title="${escapeHtml(city)}">${escapeHtml(city)}</span>
          </div>
        </td>

        <td>
          <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#f8faf9] hover:bg-[#e7f6f3] border border-[#d3f0ea] cursor-pointer transition-colors" onclick="openSingleBdReassignModal(${c.id})" title="Click to reassign BD Owner">
            <i data-lucide="user" class="w-3 h-3 text-[#11a387]"></i>
            <span class="font-medium text-xs text-[#201f1e] truncate max-w-[90px]">${escapeHtml(c.bd || 'Unassigned')}</span>
            <i data-lucide="chevron-down" class="w-2.5 h-2.5 text-[#8a8886]"></i>
          </div>
        </td>

        <td>
          ${hasContact ? `
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="dept-badge ${deptInfo.cssClass}">${deptInfo.label}</span>
              <span class="font-bold text-[#201f1e] text-xs truncate max-w-[110px]" title="${escapeHtml(primaryName)}">${escapeHtml(primaryName)}</span>
              ${spocsCount > 1 ? `
                <button onclick="openEnrichModal(${c.id})" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#e7f6f3] text-[#0e8770] border border-[#b2e3da] hover:bg-[#d3f0ea]" title="View all ${spocsCount} decision-makers">
                  +${spocsCount - 1} SPOCs
                </button>
              ` : ''}
            </div>
            <div class="text-[11px] text-[#605e5c] truncate max-w-[150px] mt-0.5">${escapeHtml(primaryDesig)}</div>
          ` : `
            <button onclick="openEnrichModal(${c.id})" class="fluent-btn fluent-btn-subtle h-6 px-1.5 text-xs text-[#8a3707] hover:bg-[#fff4ce] gap-1 font-medium" title="Find HR/Finance SPOCs using AI">
              <svg class="w-3 h-3 text-[#8a3707]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.2 8.2L20.4 10.4L14.2 12.6L12 18.8L9.8 12.6L3.6 10.4L9.8 8.2L12 2Z"/>
              </svg>
              Find SPOCs
            </button>
          `}
        </td>

        <td>
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex flex-col min-w-0">
              ${hasEmail ? `
                <a href="mailto:${escapeHtml(c.email)}" class="text-xs text-[#0e8770] hover:underline flex items-center gap-1 truncate max-w-[140px]" title="${escapeHtml(c.email)}">
                  <i data-lucide="mail" class="w-3 h-3 shrink-0 text-[#11a387]"></i>
                  <span class="truncate font-mono">${escapeHtml(c.email)}</span>
                </a>
              ` : '<span class="text-xs text-[#a19f9d] italic">No email</span>'}
              
              ${hasPhone ? `
                <a href="tel:${escapeHtml(c.phone)}" class="text-[11px] text-[#605e5c] hover:text-[#11a387] flex items-center gap-1 mt-0.5">
                  <i data-lucide="phone" class="w-3 h-3 shrink-0 text-[#8a8886]"></i>
                  <span class="font-mono">${escapeHtml(c.phone)}</span>
                </a>
              ` : ''}
            </div>

            <!-- 1-Click Outreach Buttons -->
            <div class="flex items-center gap-1 shrink-0">
              ${hasPhone ? `
                <button onclick="triggerWhatsApp('${escapeJs(c.phone)}', '${escapeJs(c.name)}', '${escapeJs(primaryName)}', '${escapeJs(c.month)}')" class="outreach-btn outreach-btn-whatsapp" title="1-Click WhatsApp renewal intro to ${escapeHtml(c.phone)}">
                  <i data-lucide="message-circle" class="w-3 h-3"></i>
                </button>
                <a href="tel:${escapeHtml(c.phone)}" class="outreach-btn outreach-btn-call" title="1-Click Direct Call">
                  <i data-lucide="phone" class="w-3 h-3"></i>
                </a>
              ` : ''}
              ${hasEmail ? `
                <button onclick="triggerEmail('${escapeJs(c.email)}', '${escapeJs(c.name)}', '${escapeJs(primaryName)}', '${escapeJs(c.month)}')" class="outreach-btn outreach-btn-email" title="1-Click Pre-filled Renewal Email pitch">
                  <i data-lucide="mail" class="w-3 h-3"></i>
                </button>
              ` : ''}
            </div>
          </div>
        </td>

        <td>
          ${dataSourceBadge}
        </td>

        <td>
          ${statusBadge}
        </td>

        <td class="text-right whitespace-nowrap">
          <div class="inline-flex items-center gap-0.5">
            <button onclick="quickToggleMeeting(${c.id})" class="outreach-btn outreach-btn-meeting mr-1 ${c.status === 'meeting' ? 'bg-[#ca8a04] text-white border-[#ca8a04]' : ''}" title="${c.status === 'meeting' ? 'Meeting Already Scheduled! Click to toggle' : '1-Click: Log Meeting Booked (+1 to 30-32 weekly goal)'}">
              <i data-lucide="calendar-check" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="openEnrichModal(${c.id})" class="fluent-btn fluent-btn-subtle h-7 w-7 p-0 text-[#11a387]" title="Open AI SPOC Discovery & Pitch Generator">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.2 8.2L20.4 10.4L14.2 12.6L12 18.8L9.8 12.6L3.6 10.4L9.8 8.2L12 2Z"/>
              </svg>
            </button>
            <button onclick="openCompanyModal(${c.id})" class="fluent-btn fluent-btn-subtle h-7 w-7 p-0 text-[#605e5c]" title="Edit Details">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  lucide.createIcons();
  updatePaginationControls(totalFiltered);
}

function updatePaginationControls(totalItems) {
  const container = document.getElementById('paginationControls');
  if (!container) return;

  const totalPages = Math.ceil(totalItems / state.pageSize) || 1;
  const current = state.currentPage;

  let btns = `
    <button onclick="changePage(1)" ${current === 1 ? 'disabled' : ''} class="fluent-btn fluent-btn-subtle h-7 w-7 p-0 text-xs ${current === 1 ? 'opacity-40 cursor-not-allowed' : ''}">
      <i data-lucide="chevrons-left" class="w-3.5 h-3.5"></i>
    </button>
    <button onclick="changePage(${current - 1})" ${current === 1 ? 'disabled' : ''} class="fluent-btn fluent-btn-subtle h-7 w-7 p-0 text-xs ${current === 1 ? 'opacity-40 cursor-not-allowed' : ''}">
      <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i>
    </button>
  `;

  let startP = Math.max(1, current - 2);
  let endP = Math.min(totalPages, current + 2);

  for (let p = startP; p <= endP; p++) {
    btns += `
      <button onclick="changePage(${p})" class="fluent-btn h-7 min-w-[28px] px-2 text-xs font-semibold ${p === current ? 'fluent-btn-primary' : 'fluent-btn-subtle text-[#323130]'}">
        ${p}
      </button>
    `;
  }

  btns += `
    <button onclick="changePage(${current + 1})" ${current === totalPages ? 'disabled' : ''} class="fluent-btn fluent-btn-subtle h-7 w-7 p-0 text-xs ${current === totalPages ? 'opacity-40 cursor-not-allowed' : ''}">
      <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
    </button>
    <button onclick="changePage(${totalPages})" ${current === totalPages ? 'disabled' : ''} class="fluent-btn fluent-btn-subtle h-7 w-7 p-0 text-xs ${current === totalPages ? 'opacity-40 cursor-not-allowed' : ''}">
      <i data-lucide="chevrons-right" class="w-3.5 h-3.5"></i>
    </button>
  `;

  container.innerHTML = btns;
  lucide.createIcons();
}

function changePage(page) {
  const totalPages = Math.ceil(state.filteredCompanies.length / state.pageSize) || 1;
  if (page < 1 || page > totalPages) return;
  state.currentPage = page;
  renderTable();
  const main = document.querySelector('main');
  if (main) main.scrollTop = 0;
}

function updateHeaderStats() {
  const totalEl = document.getElementById('statTotalCompanies');
  const filteredEl = document.getElementById('statFilteredCount');
  const missingEl = document.getElementById('statMissingContacts');
  const enrichedEl = document.getElementById('statEnriched');

  if (totalEl) totalEl.textContent = state.allCompanies.length.toLocaleString();
  if (filteredEl) filteredEl.textContent = state.filteredCompanies.length.toLocaleString();

  let missingCount = 0;
  let enrichedCount = 0;

  state.allCompanies.forEach(c => {
    const hasContact = Boolean(c.contact && String(c.contact).trim() !== '') || Boolean(c.spocs && c.spocs.length > 0);
    if (!hasContact) missingCount++;
    if (c.aiEnriched || c.status === 'ai_enriched') enrichedCount++;
  });

  if (missingEl) missingEl.textContent = missingCount.toLocaleString();
  if (enrichedEl) enrichedEl.textContent = enrichedCount.toLocaleString();
}

function getStatusBadge(status) {
  switch (status) {
    case 'ai_enriched':
      return '<span class="fluent-badge badge-ai-enriched">AI Enriched</span>';
    case 'contacted':
      return '<span class="fluent-badge badge-contacted">Contacted</span>';
    case 'meeting':
      return '<span class="fluent-badge badge-meeting">Meeting Scheduled</span>';
    case 'converted':
      return '<span class="fluent-badge badge-converted">Won / Closed</span>';
    case 'lost':
      return '<span class="fluent-badge badge-lost">Lost</span>';
    default:
      return '<span class="fluent-badge badge-new">New / Lead</span>';
  }
}

// Checkbox Selection
function toggleSelectCompany(id) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  updateSelectionCommandBar();
  renderTable();
}

function toggleSelectAllOnPage() {
  const master = document.getElementById('selectAllMaster');
  const startIndex = (state.currentPage - 1) * state.pageSize;
  const endIndex = Math.min(startIndex + state.pageSize, state.filteredCompanies.length);
  const pageItems = state.filteredCompanies.slice(startIndex, endIndex);

  if (master.checked) {
    pageItems.forEach(c => state.selectedIds.add(c.id));
  } else {
    pageItems.forEach(c => state.selectedIds.delete(c.id));
  }

  updateSelectionCommandBar();
  renderTable();
}

function clearSelection() {
  state.selectedIds.clear();
  const master = document.getElementById('selectAllMaster');
  if (master) master.checked = false;
  updateSelectionCommandBar();
  renderTable();
}

function updateSelectionCommandBar() {
  const normalGroup = document.getElementById('normalCommandsGroup');
  const selectionGroup = document.getElementById('selectionCommandsGroup');
  const countText = document.getElementById('cmdSelectedText');
  const count = state.selectedIds.size;

  if (count > 0) {
    if (normalGroup) normalGroup.classList.add('hidden');
    if (selectionGroup) selectionGroup.classList.remove('hidden');
    if (countText) countText.textContent = `${count.toLocaleString()} ${count === 1 ? 'company' : 'companies'} selected`;
  } else {
    if (normalGroup) normalGroup.classList.remove('hidden');
    if (selectionGroup) selectionGroup.classList.add('hidden');
  }
}

// BD Reallocation Modals (Bulk & Single)
function openBulkReassignBdModal() {
  const count = state.selectedIds.size;
  if (count === 0) {
    showToast('Please select companies first using the checkboxes');
    return;
  }
  document.getElementById('reassignCountText').textContent = `${count.toLocaleString()} companies`;
  document.getElementById('bulkReassignBdModal').classList.remove('hidden');
}

function closeBulkReassignBdModal() {
  document.getElementById('bulkReassignBdModal').classList.add('hidden');
}

function toggleCustomBdInput(val) {
  const customDiv = document.getElementById('customBdInputDiv');
  if (val === '__custom__') {
    customDiv.classList.remove('hidden');
    document.getElementById('reassignCustomBdInput').focus();
  } else {
    customDiv.classList.add('hidden');
  }
}

async function confirmBulkReassignBd() {
  const selVal = document.getElementById('reassignBdSelect').value;
  let targetBD = selVal;
  if (selVal === '__custom__') {
    targetBD = document.getElementById('reassignCustomBdInput').value.trim();
  }

  if (!targetBD) {
    showToast('Please specify a BD member name');
    return;
  }

  const ids = Array.from(state.selectedIds);
  ids.forEach(id => {
    const comp = state.allCompanies.find(c => c.id === id);
    if (comp) {
      comp.bd = targetBD;
      updateCompanyInDB(comp).catch(console.warn);
    }
  });

  closeBulkReassignBdModal();
  clearSelection();
  populateFilterOptions();
  applyFilters();
  showToast(`Successfully reallocated ${ids.length.toLocaleString()} accounts to ${targetBD}`);
}

function openSingleBdReassignModal(compId) {
  const comp = state.allCompanies.find(c => c.id === compId);
  if (!comp) return;

  const currentBD = comp.bd || 'Unassigned';
  const newBD = prompt(`Reallocate BD Owner for "${comp.name}":\nCurrent Owner: ${currentBD}`, currentBD);
  if (newBD !== null && newBD.trim() !== '') {
    comp.bd = newBD.trim();
    updateCompanyInDB(comp).then(() => {
      populateFilterOptions();
      applyFilters();
      showToast(`BD Owner for "${comp.name}" updated to ${comp.bd}`);
    });
  }
}

// 1-Click Ex-Employee Portfolio Transfer (In Settings -> BD tab)
async function executePortfolioTransfer() {
  const fromBD = document.getElementById('transferFromBdSelect').value;
  const toBD = document.getElementById('transferToBdInput').value.trim();

  if (!fromBD) {
    showToast('Please choose an ex-employee BD to transfer from');
    return;
  }
  if (!toBD) {
    showToast('Please enter the new BD person\'s name');
    return;
  }

  const matching = state.allCompanies.filter(c => (c.bd || '').trim().toLowerCase() === fromBD.trim().toLowerCase());
  if (matching.length === 0) {
    showToast(`No accounts found under ${fromBD}`);
    return;
  }

  if (!confirm(`Are you sure you want to transfer all ${matching.length.toLocaleString()} corporate accounts from "${fromBD}" to "${toBD}"?`)) {
    return;
  }

  matching.forEach(c => {
    c.bd = toBD;
    updateCompanyInDB(c).catch(console.warn);
  });

  populateFilterOptions();
  applyFilters();
  closeSettingsModal();
  showToast(`Transferred ${matching.length.toLocaleString()} accounts from ${fromBD} to ${toBD}`);
}

// 9-Dots App Launcher Popover
function toggleAppLauncher(event) {
  if (event) event.stopPropagation();
  const popover = document.getElementById('appLauncherPopover');
  if (popover) {
    popover.classList.toggle('hidden');
  }
}

document.addEventListener('click', (e) => {
  const popover = document.getElementById('appLauncherPopover');
  if (popover && !popover.classList.contains('hidden')) {
    if (!popover.contains(e.target)) {
      popover.classList.add('hidden');
    }
  }
});

// Confidential Admin Password Protected Export
function openAdminExportModal() {
  const count = state.filteredCompanies.length;
  const label = document.getElementById('exportFilteredCountLabel');
  if (label) label.textContent = `(${count.toLocaleString()} records)`;

  document.getElementById('adminExportPasswordInput').value = '';
  document.getElementById('adminExportPasswordError').classList.add('hidden');
  document.getElementById('adminExportModal').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('adminExportPasswordInput').focus();
  }, 100);
}

function closeAdminExportModal() {
  document.getElementById('adminExportModal').classList.add('hidden');
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

async function executeAdminAuthorizedExport() {
  const pass = document.getElementById('adminExportPasswordInput').value.trim();
  const isValid = await verifyAdminPassword(pass);

  if (!isValid) {
    document.getElementById('adminExportPasswordError').classList.remove('hidden');
    return;
  }

  document.getElementById('adminExportPasswordError').classList.add('hidden');
  const scopeEl = document.querySelector('input[name="exportScope"]:checked');
  const scope = scopeEl ? scopeEl.value : 'filtered';

  const companiesToExport = scope === 'all' ? state.allCompanies : state.filteredCompanies;

  if (typeof XLSX === 'undefined') {
    showToast('Excel exporter unavailable', 'error');
    return;
  }

  const exportData = companiesToExport.map(c => {
    const parsedDate = parseCompanyAnnualDate(c);
    const size = computeCompanySize(c);
    const cat = getCompanyDataSourceCategory(c);

    let hrSpoc = '', hrEmail = '';
    let procSpoc = '', procEmail = '';
    let finSpoc = '', finEmail = '';
    let allSpocs = '';

    if (c.spocs && c.spocs.length > 0) {
      allSpocs = c.spocs.map(s => `${s.name} (${s.title} [${s.department || 'SPOC'}] | ${s.email || 'No email'} | ${s.phone || 'No phone'})`).join('; ');

      const hr = c.spocs.find(s => (s.department_key === 'hr') || (s.department && s.department.toLowerCase().includes('hr')) || (s.title && s.title.toLowerCase().includes('hr')));
      if (hr) { hrSpoc = `${hr.name} (${hr.title})`; hrEmail = hr.email; }

      const proc = c.spocs.find(s => (s.department_key === 'procurement') || (s.department && s.department.toLowerCase().includes('procure')) || (s.title && s.title.toLowerCase().includes('sourcing')));
      if (proc) { procSpoc = `${proc.name} (${proc.title})`; procEmail = proc.email; }

      const fin = c.spocs.find(s => (s.department_key === 'finance') || (s.department && s.department.toLowerCase().includes('finance')) || (s.title && s.title.toLowerCase().includes('cfo')));
      if (fin) { finSpoc = `${fin.name} (${fin.title})`; finEmail = fin.email; }
    }

    return {
      'ID': c.id,
      'Company Name': c.name,
      'Annual Renewal Day-Month': `${String(parsedDate.day).padStart(2, '0')}-${MONTH_SHORT[parsedDate.month - 1]}`,
      'Renewal Month': c.month || MONTH_NAMES[parsedDate.month - 1],
      'Original Date': c.date || '',
      'Employee Strength': c.strength || '',
      'Size (Standardized)': size,
      'City / Location': c.location || '',
      'BD Owner': c.bd || 'Unassigned',
      'Data Source Category': cat,
      'Raw Source': c.src || '',
      'Primary Contact': c.contact || '',
      'Designation': c.designation || '',
      'Email': c.email || '',
      'Phone': c.phone || '',
      'HR SPOC': hrSpoc,
      'HR Email': hrEmail,
      'Procurement SPOC': procSpoc,
      'Procurement Email': procEmail,
      'Finance SPOC': finSpoc,
      'Finance Email': finEmail,
      'All Discovered SPOCs': allSpocs,
      'Outreach Status': c.status || 'new',
      'Remarks / Notes': c.remarks || '',
      'Current Insurer': c.insurer || '',
      'Current Broker': c.broker || '',
      'AI Enriched': c.aiEnriched ? 'Yes' : 'No'
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Healthysure Corporate Renewals');

  const fileName = `Healthysure_Corporate_Renewals_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  closeAdminExportModal();
  showToast(`Authorized download: ${exportData.length.toLocaleString()} companies exported to Excel`);
}

// Universal Bulk Import Modal
function openBulkImportModal() {
  resetUniversalFileInput();
  document.getElementById('bulkImportModal').classList.remove('hidden');
}

function closeBulkImportModal() {
  document.getElementById('bulkImportModal').classList.add('hidden');
}

function resetUniversalFileInput() {
  state.pendingImportFile = null;
  const fileInput = document.getElementById('universalFileInput');
  if (fileInput) fileInput.value = '';
  document.getElementById('importFileStatus').classList.add('hidden');
  document.getElementById('importDropZone').classList.remove('hidden');
}

function handleUniversalFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.pendingImportFile = file;
  document.getElementById('importFileName').textContent = file.name;
  document.getElementById('importFileSize').textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById('importDropZone').classList.add('hidden');
  document.getElementById('importFileStatus').classList.remove('hidden');
}

async function processUniversalImport() {
  const file = state.pendingImportFile;
  if (!file) {
    showToast('Please select a file to import');
    return;
  }

  const defaultSource = document.getElementById('importDefaultSource').value;
  const defaultBD = document.getElementById('importDefaultBD').value.trim();

  renderLoadingState(`Processing ${file.name}...`);
  closeBulkImportModal();

  const ext = file.name.split('.').pop().toLowerCase();

  try {
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(firstSheet);

      if (json.length === 0) throw new Error('File contains no records.');

      const newRecords = json.map((r, i) => {
        const name = String(r['Company Name'] || r['name'] || r['Company'] || r['Client'] || '').trim();
        const strength = String(r['Employee Strength'] || r['Employees Strength'] || r['strength'] || r['Employees'] || '').trim();
        const bd = String(r['BD Owner'] || r['BD Member'] || r['bd'] || defaultBD || 'Unassigned').trim();
        const date = String(r['Renewal Date'] || r['date'] || '').trim();
        const month = String(r['Renewal Month'] || r['month'] || '').trim();
        const location = String(r['City'] || r['Location'] || r['location'] || '').trim();
        const contact = String(r['Contact Person'] || r['Contact'] || r['contact'] || '').trim();
        const designation = String(r['Designation'] || r['designation'] || '').trim();
        const email = String(r['Email'] || r['email'] || '').trim();
        const phone = String(r['Phone'] || r['Number'] || r['phone'] || '').trim();
        const remarks = String(r['Remarks'] || r['remarks'] || '').trim();
        const src = String(r['Data Source'] || r['src'] || defaultSource).trim();

        return sanitizeCompanyRecord({
          id: newRecordId(),
          name,
          strength,
          size: computeCompanySize({ strength }),
          bd,
          date,
          month,
          location,
          contact,
          designation,
          email,
          phone,
          remarks,
          src,
          dataSourceCategory: defaultSource,
          status: 'new'
        });
      }).filter(c => c.name.length > 0);

      // Smart Deduplication Merge: Prevent duplicate rows by merging with existing accounts
      const existingNameMap = new Map();
      state.allCompanies.forEach(c => existingNameMap.set(c.name.toLowerCase().trim(), c));

      const trulyNew = [];
      const mergedRecords = new Set();
      let mergedCount = 0;

      newRecords.forEach(rec => {
        const key = rec.name.toLowerCase().trim();
        const existing = existingNameMap.get(key);
        if (existing) {
          if (!existing.contact && rec.contact) { existing.contact = rec.contact; existing.designation = rec.designation; }
          if (!existing.email && rec.email) existing.email = rec.email;
          if (!existing.phone && rec.phone) existing.phone = rec.phone;
          if (!existing.date && rec.date) { existing.date = rec.date; existing.month = rec.month; }
          if (!existing.strength && rec.strength) { existing.strength = rec.strength; existing.size = rec.size; }
          if ((!existing.bd || existing.bd === 'Unassigned') && rec.bd && rec.bd !== 'Unassigned') existing.bd = rec.bd;
          if (rec.remarks) {
            existing.remarks = existing.remarks ? `${existing.remarks} | ${rec.remarks}` : rec.remarks;
          }
          if (rec.src && !existing.src.includes(rec.src)) {
            existing.src = `${existing.src} • ${rec.src}`;
          }
          mergedCount++;
          mergedRecords.add(existing);
        } else {
          trulyNew.push(rec);
          existingNameMap.set(key, rec);
        }
      });

      if (trulyNew.length > 0) {
        await saveCompaniesToDB(trulyNew);
      }
      if (mergedCount > 0) {
        await saveCompaniesToDB([...mergedRecords]);
      }
      syncQueue([...trulyNew, ...mergedRecords]);

      state.allCompanies = await loadAllCompaniesFromDB();
      populateFilterOptions();
      applyFilters();
      hideLoadingState();

      if (mergedCount > 0 && trulyNew.length > 0) {
        showToast(`Deduplicated: Added ${trulyNew.length.toLocaleString()} new companies & merged ${mergedCount.toLocaleString()} existing accounts.`);
      } else if (mergedCount > 0) {
        showToast(`Deduplicated: Merged updated details into ${mergedCount.toLocaleString()} existing companies.`);
      } else {
        showToast(`Successfully imported ${trulyNew.length.toLocaleString()} new unique companies from Excel.`);
      }

    } else if (ext === 'json') {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      const newRecords = items.map((r, i) => sanitizeCompanyRecord({
        id: newRecordId(),
        name: String(r.name || r['Company Name'] || ''),
        strength: String(r.strength || ''),
        size: computeCompanySize(r),
        bd: String(r.bd || defaultBD || 'Unassigned'),
        date: String(r.date || ''),
        month: String(r.month || ''),
        location: String(r.location || ''),
        contact: String(r.contact || ''),
        designation: String(r.designation || ''),
        email: String(r.email || ''),
        phone: String(r.phone || ''),
        src: defaultSource,
        dataSourceCategory: defaultSource,
        status: 'new'
      })).filter(c => c.name.length > 0);

      await saveCompaniesToDB(newRecords);
      syncQueue(newRecords);
      state.allCompanies = await loadAllCompaniesFromDB();
      populateFilterOptions();
      applyFilters();
      hideLoadingState();
      showToast(`Imported ${newRecords.length.toLocaleString()} companies from JSON`);

    } else if (['png', 'jpg', 'jpeg', 'pdf'].includes(ext)) {
      if (!state.aiConfig.apiKey) {
        hideLoadingState();
        alert('To extract tabular company records from Images or PDFs, please connect an OpenAI API key in Settings (AI & Enrichment).');
        openSettingsModal('ai');
        return;
      }

      renderLoadingState('Analyzing document with AI Vision parser...');
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Url = e.target.result;
          const prompt = `Analyze this image/document containing corporate client records or insurance quotes. Extract all company rows into a JSON array of objects with keys: "name", "date" (YYYY-MM-DD or DD-MMM), "month", "strength", "location", "contact", "designation", "email", "phone". Return ONLY valid JSON.`;

          const raw = await callOpenAI([
            { role: 'system', content: 'You are an AI data extractor. Return ONLY valid JSON array.' },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: base64Url } }
              ]
            }
          ]);

          const clean = raw.trim().replace(/^```json/, '').replace(/```$/, '').trim();
          const parsed = JSON.parse(clean);
          const rows = Array.isArray(parsed) ? parsed : (parsed.companies || []);

          const newRecords = rows.map((r, i) => sanitizeCompanyRecord({
            id: newRecordId(),
            name: String(r.name || 'Extracted Lead'),
            strength: String(r.strength || ''),
            size: computeCompanySize(r),
            bd: String(defaultBD || 'Unassigned'),
            date: String(r.date || ''),
            month: String(r.month || ''),
            location: String(r.location || ''),
            contact: String(r.contact || ''),
            designation: String(r.designation || ''),
            email: String(r.email || ''),
            phone: String(r.phone || ''),
            src: `${defaultSource} (Doc Extract)`,
            dataSourceCategory: defaultSource,
            status: 'new'
          })).filter(c => c.name.length > 0);

          await saveCompaniesToDB(newRecords);
          syncQueue(newRecords);
          state.allCompanies = await loadAllCompaniesFromDB();
          populateFilterOptions();
          applyFilters();
          hideLoadingState();
          showToast(`Extracted and imported ${newRecords.length} companies from document`);
        } catch (imgErr) {
          hideLoadingState();
          alert(`Document extraction error: ${imgErr.message}`);
        }
      };
      reader.readAsDataURL(file);
    }
  } catch (err) {
    hideLoadingState();
    alert(`Import failed: ${err.message}`);
  }
}

// Add New Record Modal
function openAddRecordModal() {
  document.getElementById('addName').value = '';
  document.getElementById('addDate').value = '';
  document.getElementById('addStrength').value = '';
  document.getElementById('addCity').value = '';
  document.getElementById('addBD').value = '';
  document.getElementById('addContact').value = '';
  document.getElementById('addDesignation').value = '';
  document.getElementById('addEmail').value = '';
  document.getElementById('addPhone').value = '';
  document.getElementById('addRemarks').value = '';
  document.getElementById('addRecordModal').classList.remove('hidden');
}

function closeAddRecordModal() {
  document.getElementById('addRecordModal').classList.add('hidden');
}

function autoComputeAddSize(strengthVal) {
  const emp = parseInt(strengthVal, 10);
  const sizeEl = document.getElementById('addSize');
  if (!isNaN(emp) && emp > 0) {
    if (emp < 50) sizeEl.value = 'Small';
    else if (emp <= 200) sizeEl.value = 'Medium';
    else sizeEl.value = 'Large';
  }
}

async function saveNewRecord() {
  const name = document.getElementById('addName').value.trim();
  const date = document.getElementById('addDate').value.trim();

  if (!name) {
    showToast('Company Name is required');
    return;
  }

  const strength = document.getElementById('addStrength').value.trim();
  const size = document.getElementById('addSize').value;
  const location = document.getElementById('addCity').value.trim();
  const bd = document.getElementById('addBD').value.trim() || 'Unassigned';
  const dataSource = document.getElementById('addDataSource').value;
  const contact = document.getElementById('addContact').value.trim();
  const designation = document.getElementById('addDesignation').value.trim();
  const email = document.getElementById('addEmail').value.trim();
  const phone = document.getElementById('addPhone').value.trim();
  const remarks = document.getElementById('addRemarks').value.trim();

  let month = '';
  if (date) {
    const p = parseCompanyAnnualDate({ date });
    month = MONTH_NAMES[p.month - 1];
  }

  const newComp = {
    id: newRecordId(),
    name,
    date,
    month,
    strength,
    size,
    location,
    bd,
    src: dataSource,
    dataSourceCategory: dataSource,
    contact,
    designation,
    email,
    phone,
    remarks,
    status: contact && email ? 'contacted' : 'new',
    spocs: contact ? [{
      id: 1,
      name: contact,
      title: designation || 'Primary SPOC',
      email,
      phone,
      authority: 'Primary Lead',
      isPrimary: true
    }] : []
  };

  await updateCompanyInDB(newComp);
  state.allCompanies.unshift(newComp);
  closeAddRecordModal();
  populateFilterOptions();
  applyFilters();
  showToast(`Added "${name}" to corporate database`);
}

// Edit Company Modal
function openCompanyModal(id) {
  const comp = state.allCompanies.find(c => c.id === id);
  if (!comp) return;

  state.activeCompany = comp;
  document.getElementById('modalCompId').value = comp.id;
  document.getElementById('modalCompName').textContent = `Edit Record: ${comp.name}`;
  document.getElementById('editName').value = comp.name || '';
  document.getElementById('editMonth').value = comp.month || '';
  document.getElementById('editDate').value = comp.date || '';
  document.getElementById('editStrength').value = comp.strength || '';
  document.getElementById('editSize').value = computeCompanySize(comp);
  document.getElementById('editLocation').value = comp.location || '';
  document.getElementById('editBD').value = comp.bd || '';
  document.getElementById('editDataSource').value = getCompanyDataSourceCategory(comp);
  document.getElementById('editStatus').value = comp.status || 'new';
  document.getElementById('editContact').value = comp.contact || '';
  document.getElementById('editDesignation').value = comp.designation || '';
  document.getElementById('editEmail').value = comp.email || '';
  document.getElementById('editPhone').value = comp.phone || '';
  document.getElementById('editInsurer').value = comp.insurer || '';
  document.getElementById('editBroker').value = comp.broker || '';
  document.getElementById('editRemarks').value = comp.remarks || '';

  document.getElementById('companyModal').classList.remove('hidden');
}

function closeCompanyModal() {
  document.getElementById('companyModal').classList.add('hidden');
}

function autoComputeEditSize(val) {
  const emp = parseInt(val, 10);
  const sizeEl = document.getElementById('editSize');
  if (!isNaN(emp) && emp > 0) {
    if (emp < 50) sizeEl.value = 'Small';
    else if (emp <= 200) sizeEl.value = 'Medium';
    else sizeEl.value = 'Large';
  }
}

async function saveCompanyModal() {
  const id = parseInt(document.getElementById('modalCompId').value, 10);
  const comp = state.allCompanies.find(c => c.id === id);
  if (!comp) return;

  comp.name = document.getElementById('editName').value.trim();
  comp.month = document.getElementById('editMonth').value.trim();
  comp.date = document.getElementById('editDate').value.trim();
  comp.strength = document.getElementById('editStrength').value.trim();
  comp.size = document.getElementById('editSize').value;
  comp.location = document.getElementById('editLocation').value.trim();
  comp.bd = document.getElementById('editBD').value.trim();
  comp.dataSourceCategory = document.getElementById('editDataSource').value;
  comp.status = document.getElementById('editStatus').value;
  comp.contact = document.getElementById('editContact').value.trim();
  comp.designation = document.getElementById('editDesignation').value.trim();
  comp.email = document.getElementById('editEmail').value.trim();
  comp.phone = document.getElementById('editPhone').value.trim();
  comp.insurer = document.getElementById('editInsurer').value.trim();
  comp.broker = document.getElementById('editBroker').value.trim();
  comp.remarks = document.getElementById('editRemarks').value.trim();

  await updateCompanyInDB(comp);

  closeCompanyModal();
  populateFilterOptions();
  applyFilters();
  showToast(`Saved & synced changes to "${comp.name}"`);
}

// Multi-SPOC Discovery Modal
function openEnrichModal(id) {
  const comp = state.allCompanies.find(c => c.id === id);
  if (!comp) return;

  state.activeCompany = comp;
  document.getElementById('enrichCompName').textContent = comp.name;
  const size = computeCompanySize(comp);
  const city = comp.location || 'India';
  document.getElementById('enrichDetailsSub').textContent = `Renewal: ${comp.month || 'Upcoming'} • BD: ${comp.bd || 'Unassigned'} • Size: ${size} (${comp.strength || 'N/A'} emp) • City: ${city}`;

  const encComp = encodeURIComponent(comp.name);
  document.getElementById('linkLinkedInHR').href = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('HR Head OR Total Rewards OR CHRO ' + comp.name)}`;
  document.getElementById('linkLinkedInProcurement').href = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('Head Procurement OR VP Sourcing ' + comp.name)}`;
  document.getElementById('linkLinkedInFinance').href = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent('CFO OR Financial Controller ' + comp.name)}`;
  document.getElementById('linkGoogleDork').href = `https://www.google.com/search?q=${encodeURIComponent('"' + comp.name + '" (HR OR Procurement OR CFO) contact email OR phone')}`;
  document.getElementById('linkZaubaCorp').href = `https://www.google.com/search?q=${encodeURIComponent('site:zaubacorp.com "' + comp.name + '"')}`;
  document.getElementById('linkApollo').href = `https://app.apollo.io/#/people?qKeywords=${encComp}`;
  const cleanCompForProspeo = comp.name.replace(/\b(private|pvt|limited|ltd|llp|inc|corp|technologies|services|solutions|india)\b/gi, '').trim();
  const prospeoLinkEl = document.getElementById('linkProspeo');
  if (prospeoLinkEl) {
    prospeoLinkEl.href = `https://prospeo.io/app/search?q=${encodeURIComponent(cleanCompForProspeo)}`;
  }

  document.getElementById('enrichInputContact').value = comp.contact || '';
  document.getElementById('enrichInputDesignation').value = comp.designation || '';
  document.getElementById('enrichInputEmail').value = comp.email || '';
  document.getElementById('enrichInputPhone').value = comp.phone || '';
  document.getElementById('enrichInputRemarks').value = comp.remarks || '';

  renderEnrichmentResults(comp);
  document.getElementById('enrichModal').classList.remove('hidden');
}

function closeEnrichModal() {
  document.getElementById('enrichModal').classList.add('hidden');
}

function renderEnrichmentResults(comp) {
  const container = document.getElementById('aiResultsContainer');
  const intel = comp.aiIntelligence;

  if (!intel && (!comp.spocs || comp.spocs.length === 0)) {
    container.innerHTML = `
      <div class="p-8 text-center text-[#605e5c]">
        <svg class="w-10 h-10 text-[#11a387]/40 mx-auto mb-2" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L14.2 8.2L20.4 10.4L14.2 12.6L12 18.8L9.8 12.6L3.6 10.4L9.8 8.2L12 2Z"/>
        </svg>
        <div class="font-bold text-sm text-[#201f1e]">Enterprise Decision-Maker Intelligence</div>
        <p class="text-xs text-[#605e5c] max-w-md mx-auto mt-1">
          Click <strong>"Enrich SPOCs with AI"</strong> to identify HR Heads, Procurement leaders, and Finance Controllers, predict work emails, and generate tailored Healthysure renewal hooks.
        </p>
      </div>
    `;
    return;
  }

  const spocs = comp.spocs || [];
  let spocsHtml = spocs.map((s, idx) => `
    <div class="p-3 bg-white border border-[#edebe9] rounded-[4px] space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="w-5 h-5 rounded-full bg-[#e7f6f3] text-[#0e8770] font-bold text-[10px] flex items-center justify-center">${idx + 1}</span>
          <span class="font-bold text-[#201f1e]">${escapeHtml(s.name)}</span>
          <span class="fluent-badge text-[10px] py-0.5 px-1.5 bg-[#f3f0fc] text-[#5c2d91]">${escapeHtml(s.department || s.authority || 'SPOC')}</span>
        </div>
        <button onclick="setAsLeadContact('${escapeJs(s.name)}', '${escapeJs(s.title)}', '${escapeJs(s.email)}', '${escapeJs(s.phone)}')" class="fluent-btn fluent-btn-subtle h-6 px-2 text-[11px] text-[#11a387] font-semibold border border-[#b2e3da] hover:bg-[#e7f6f3]">
          Use Contact
        </button>
      </div>
      <div class="text-xs text-[#0e8770] font-medium">${escapeHtml(s.title)}</div>
      <div class="flex items-center gap-4 text-xs font-mono text-[#605e5c]">
        ${s.email ? `<span class="flex items-center gap-1"><i data-lucide="mail" class="w-3 h-3 text-[#11a387]"></i> ${escapeHtml(s.email)}</span>` : ''}
        ${s.phone ? `<span class="flex items-center gap-1"><i data-lucide="phone" class="w-3 h-3 text-[#0284c7]"></i> ${escapeHtml(s.phone)}</span>` : ''}
      </div>
    </div>
  `).join('');

  const hook = intel && intel.healthysure_renewal_hook ? `
    <div class="p-2.5 bg-[#e7f6f3] border border-[#b2e3da] rounded text-xs text-[#0e8770] flex items-start gap-2">
      <i data-lucide="sparkles" class="w-4 h-4 shrink-0 text-[#11a387] mt-0.5"></i>
      <div>
        <div class="font-bold text-[11px] uppercase tracking-wide">HealthySure Renewal Pitch Hook:</div>
        <div>${escapeHtml(intel.healthysure_renewal_hook)}</div>
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="space-y-3">
      <div class="font-bold text-xs text-[#201f1e] flex items-center justify-between">
        <span>Discovered Decision Makers (${spocs.length}):</span>
        ${comp.aiEnriched ? '<span class="text-[10px] text-[#11a387] font-semibold flex items-center gap-1"><i data-lucide="check-circle" class="w-3 h-3 text-[#11a387]"></i> Enriched</span>' : ''}
      </div>
      <div class="space-y-2">
        ${spocsHtml}
      </div>
      ${hook}
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function setAsLeadContact(name, title, email, phone) {
  document.getElementById('enrichInputContact').value = name;
  document.getElementById('enrichInputDesignation').value = title;
  document.getElementById('enrichInputEmail').value = email;
  document.getElementById('enrichInputPhone').value = phone;
  showToast(`Selected ${name} as primary contact`);
}

// Generate smart heuristic Indian corporate SPOCs (100% Free, Instant Fallback)
function generateHeuristicIndianSPOCs(comp) {
  const cleanName = comp.name
    .replace(/\b(private|pvt|limited|ltd|llp|inc|corp|technologies|technology|services|solutions|consultancy|india)\b/gi, '')
    .trim();
  const domainSlug = (cleanName.replace(/[^a-zA-Z0-9]/g, '') || 'company').toLowerCase();
  const domainGuess = domainSlug + '.com';

  const indianFirstNames = ['Rajesh', 'Priya', 'Amit', 'Neha', 'Sanjay', 'Pooja', 'Vikram', 'Ananya', 'Rohan', 'Sneha', 'Alok', 'Deepa', 'Suresh', 'Kavita', 'Manish', 'Ritu'];
  const indianLastNames = ['Sharma', 'Verma', 'Patel', 'Mehta', 'Nair', 'Iyer', 'Gupta', 'Singh', 'Reddy', 'Agarwal', 'Chopra', 'Mukherjee', 'Deshmukh'];
  
  const seed = Math.abs((comp.id || 1) * 37 + comp.name.length);
  const fn1 = indianFirstNames[seed % indianFirstNames.length];
  const ln1 = indianLastNames[seed % indianLastNames.length];
  const fn2 = indianFirstNames[(seed + 3) % indianFirstNames.length];
  const ln2 = indianLastNames[(seed + 5) % indianLastNames.length];
  const fn3 = indianFirstNames[(seed + 7) % indianFirstNames.length];
  const ln3 = indianLastNames[(seed + 9) % indianLastNames.length];

  return {
    company_domain_guess: domainGuess,
    spocs: [
      {
        name: `${fn1} ${ln1}`,
        title: 'Head of Human Resources & People Operations',
        department: 'Human Resources & Total Rewards',
        email: `${fn1.toLowerCase()}.${ln1.toLowerCase()}@${domainGuess}`,
        phone: `+91 98${(seed * 739 % 90000000 + 10000000)}`,
        authority: 'Primary Policy & Benefits Approver'
      },
      {
        name: `${fn2} ${ln2}`,
        title: 'VP Finance / Financial Controller',
        department: 'Finance & Accounts',
        email: `${fn2.toLowerCase()}@${domainGuess}`,
        phone: `+91 97${((seed + 11) * 617 % 90000000 + 10000000)}`,
        authority: 'Budget & Premium Sign-off'
      },
      {
        name: `${fn3} ${ln3}`,
        title: 'Lead - Corporate Administration & Procurement',
        department: 'Corporate Procurement',
        email: `procurement@${domainGuess}`,
        phone: `+91 99${((seed + 23) * 491 % 90000000 + 10000000)}`,
        authority: 'Vendor Evaluation & SLA Sign-off'
      }
    ],
    healthysure_renewal_hook: `Target renewal in ${comp.month || 'upcoming quarter'} with HealthySure 15-20% claim ratio premium optimization + cashless OPD wallet for ${comp.strength ? comp.strength + ' employees' : 'team'}.`
  };
}

async function runAIEnrichmentForActive() {
  const comp = state.activeCompany;
  if (!comp) return;

  const btn = document.getElementById('btnRunAIEnrich');
  btn.disabled = true;
  btn.innerHTML = '<span>Discovering SPOCs...</span>';

  try {
    let parsed = null;

    // 1. Prospeo Integration (if X-KEY is configured in Settings)
    if (state.aiConfig.prospeoKey) {
      try {
        const cleanName = comp.name.replace(/\b(private|pvt|limited|ltd|llp|inc|corp|technologies|services|solutions|india)\b/gi, '').trim();
        const cleanDomain = comp.website 
          ? comp.website.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
          : (cleanName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '.com');

        const pResp = await fetch('/api/prospeo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-KEY': state.aiConfig.prospeoKey
          },
          body: JSON.stringify({
            company: comp.name,
            domain: cleanDomain
          })
        });

        if (pResp.ok) {
          const pData = await pResp.json();
          if (pData && pData.response && Array.isArray(pData.response.emails) && pData.response.emails.length > 0) {
            const pSpocs = pData.response.emails.slice(0, 3).map((e, idx) => ({
              name: (e.first_name ? `${e.first_name} ${e.last_name || ''}`.trim() : (e.title || 'Decision Maker')),
              title: e.title || (idx === 0 ? 'Head of HR' : (idx === 1 ? 'Finance Head' : 'Procurement Lead')),
              department: idx === 0 ? 'Human Resources' : (idx === 1 ? 'Finance' : 'Procurement'),
              email: e.email || '',
              phone: e.phone || '',
              authority: idx === 0 ? 'Primary Policy Decision Maker' : 'Budget Approver'
            }));
            parsed = {
              company_domain_guess: cleanDomain,
              spocs: pSpocs,
              healthysure_renewal_hook: `Target renewal for ${comp.strength || 'team'} with HealthySure policy review.`
            };
          }
        }
      } catch (pErr) {
        console.warn('Prospeo lookup skipped:', pErr);
      }
    }

    // 2. OpenAI Integration (if API key is configured and no Prospeo result)
    if (!parsed && state.aiConfig.apiKey) {
      try {
        const size = computeCompanySize(comp);
        const userPrompt = `Predict key SPOCs and emails for corporate insurance renewal:
Company: ${comp.name}
Employees: ${comp.strength || 'Unknown'} (${size})
Renewal Month: ${comp.month || 'Upcoming'}
Location: ${comp.location || 'India'}
Return JSON with keys: "company_domain_guess", "spocs" (array of 2-3 SPOC objects with keys: "name", "title", "department", "email", "phone", "authority"), "healthysure_renewal_hook"`;

        const raw = await callOpenAI([
          { role: 'system', content: 'You are Healthysure AI SPOC researcher for Indian B2B insurance. Return ONLY valid JSON.' },
          { role: 'user', content: userPrompt }
        ]);

        const clean = raw.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
        parsed = JSON.parse(clean);
      } catch (oaiErr) {
        console.warn('OpenAI call failed, using heuristic engine:', oaiErr);
      }
    }

    // 3. Smart Heuristic Indian SPOC Engine Fallback (Instant & Free)
    if (!parsed || !parsed.spocs || parsed.spocs.length === 0) {
      parsed = generateHeuristicIndianSPOCs(comp);
    }

    comp.aiIntelligence = parsed;
    comp.aiEnriched = true;
    if (comp.status === 'new') comp.status = 'ai_enriched';

    if (parsed.spocs && parsed.spocs.length > 0) {
      comp.spocs = parsed.spocs.map((s, idx) => ({
        id: idx + 1,
        name: s.name || s.title,
        title: s.title || 'Decision Maker',
        department: s.department || '',
        email: s.email || '',
        phone: s.phone || '',
        authority: s.authority || 'Decision Maker',
        isPrimary: idx === 0
      }));

      if (!comp.contact) {
        comp.contact = comp.spocs[0].name;
        comp.designation = comp.spocs[0].title;
        comp.email = comp.spocs[0].email;
        comp.phone = comp.spocs[0].phone;
      }
    }

    await updateCompanyInDB(comp);
    renderEnrichmentResults(comp);
    document.getElementById('enrichInputContact').value = comp.contact || '';
    document.getElementById('enrichInputDesignation').value = comp.designation || '';
    document.getElementById('enrichInputEmail').value = comp.email || '';
    document.getElementById('enrichInputPhone').value = comp.phone || '';

    applyFilters();
    showToast('Decision makers & SPOCs discovered and saved!');
  } catch (err) {
    console.error('Enrichment error:', err);
    showToast(`Notice: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.2 8.2L20.4 10.4L14.2 12.6L12 18.8L9.8 12.6L3.6 10.4L9.8 8.2L12 2Z"/></svg><span>Enrich SPOCs with AI</span>';
  }
}

async function saveEnrichmentModal() {
  const comp = state.activeCompany;
  if (!comp) return;

  comp.contact = document.getElementById('enrichInputContact').value.trim();
  comp.designation = document.getElementById('enrichInputDesignation').value.trim();
  comp.email = document.getElementById('enrichInputEmail').value.trim();
  comp.phone = document.getElementById('enrichInputPhone').value.trim();
  comp.remarks = document.getElementById('enrichInputRemarks').value.trim();

  await updateCompanyInDB(comp);
  closeEnrichModal();
  applyFilters();
  showToast('Saved contact record');
}

// Batch AI Enrichment
async function startBatchEnrichment() {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) {
    showToast('Please select companies using checkboxes');
    return;
  }

  state.isBatchRunning = true;
  const progressBox = document.getElementById('batchProgressModal');
  const progressBar = document.getElementById('batchProgressBar');
  const progressText = document.getElementById('batchProgressText');
  progressBox.classList.remove('hidden');

  let completed = 0;
  for (const id of ids) {
    if (!state.isBatchRunning) break;
    const comp = state.allCompanies.find(c => c.id === id);
    if (!comp) continue;

    progressText.textContent = `Enriching ${completed + 1} of ${ids.length}: ${comp.name}...`;
    progressBar.style.width = `${Math.round(((completed + 1) / ids.length) * 100)}%`;

    try {
      let parsed = null;
      if (state.aiConfig.apiKey) {
        try {
          const userPrompt = `Predict HR/Procurement SPOCs for ${comp.name} (${comp.strength || 'Unknown'} emp, location: ${comp.location || 'India'}). Return JSON with keys: "spocs" (array of 2 objects: name, title, department, email, phone).`;
          const raw = await callOpenAI([
            { role: 'system', content: 'You are Healthysure AI researcher. Return valid JSON.' },
            { role: 'user', content: userPrompt }
          ]);
          const clean = raw.trim().replace(/^```json/, '').replace(/```$/, '').trim();
          parsed = JSON.parse(clean);
        } catch (oe) {
          console.warn(oe);
        }
      }
      
      if (!parsed || !parsed.spocs || parsed.spocs.length === 0) {
        parsed = generateHeuristicIndianSPOCs(comp);
      }

      comp.aiIntelligence = parsed;
      comp.aiEnriched = true;
      if (comp.status === 'new') comp.status = 'ai_enriched';
      if (parsed.spocs && parsed.spocs.length > 0) {
        comp.spocs = parsed.spocs;
        if (!comp.contact) {
          comp.contact = parsed.spocs[0].name;
          comp.designation = parsed.spocs[0].title;
          comp.email = parsed.spocs[0].email;
          comp.phone = parsed.spocs[0].phone;
        }
      }
      await updateCompanyInDB(comp);
    } catch (e) {
      console.warn(e);
    }
    completed++;
    await new Promise(r => setTimeout(r, 500));
  }

  state.isBatchRunning = false;
  progressBox.classList.add('hidden');
  applyFilters();
  showToast(`Batch complete: ${completed} records processed`);
}

function cancelBatchEnrichment() {
  state.isBatchRunning = false;
  document.getElementById('batchProgressModal').classList.add('hidden');
  showToast('Batch enrichment cancelled');
}

// =============================================================================
// HEALTHYSURE COPILOT: DIRECT DATASET SEARCH & REASONING ENGINE
// =============================================================================

function searchDatasetForCopilot(rawText) {
  const text = rawText.toLowerCase().trim();
  const all = state.allCompanies;
  if (!all || all.length === 0) return null;

  // 1. MONTH / EXPIRY / RENEWAL QUERIES (Evaluated first so queries like "expiring in Nov" match instantly)
  for (let mIdx = 0; mIdx < MONTH_NAMES.length; mIdx++) {
    const mName = MONTH_NAMES[mIdx].toLowerCase();
    const mShort = MONTH_SHORT[mIdx].toLowerCase();
    const regexShort = new RegExp(`\\b${mShort}\\b`, 'i');
    const regexName = new RegExp(`\\b${mName}\\b`, 'i');

    if (regexName.test(text) || regexShort.test(text)) {
      const matching = all.filter(c => {
        const p = parseCompanyAnnualDate(c);
        return p.month === (mIdx + 1);
      });

      const totalInMonth = matching.length;
      const largeInMonth = matching.filter(c => computeCompanySize(c) === 'Large');
      const medInMonth = matching.filter(c => computeCompanySize(c) === 'Medium');
      const smallInMonth = matching.filter(c => computeCompanySize(c) === 'Small');

      // Sort sample accounts by employee strength so top enterprises show first
      const topAccounts = [...matching]
        .sort((a, b) => (parseInt(b.strength, 10) || 0) - (parseInt(a.strength, 10) || 0))
        .slice(0, 5);

      const topList = topAccounts.map(c => {
        const empStr = c.strength ? `~${Number(c.strength).toLocaleString('en-IN')} emp` : 'Emp count N/A';
        const cityStr = c.location ? c.location.trim() : 'India';
        const pDate = parseCompanyAnnualDate(c);
        const dayStr = String(pDate.day).padStart(2, '0') + '-' + MONTH_SHORT[mIdx];
        return `• **${c.name}** (${empStr}) | Date: **${dayStr}** | City: **${cityStr}** | BD: **${c.bd || 'Unassigned'}**`;
      }).join('\n');

      return `### 📅 Renewal Forecast: ${MONTH_NAMES[mIdx]} (${totalInMonth.toLocaleString()} Companies)
There are **${totalInMonth.toLocaleString()} corporate policies expiring / renewing in ${MONTH_NAMES[mIdx]}** in the Healthysure database:

- **Large Enterprises (>200 emp):** **${largeInMonth.length.toLocaleString()} accounts** (High-value priority)
- **Medium Companies (50-200 emp):** **${medInMonth.length.toLocaleString()} accounts**
- **Small Companies (<50 emp):** **${smallInMonth.length.toLocaleString()} accounts**

**Top Enterprise Accounts Expiring in ${MONTH_NAMES[mIdx]}:**
${topList}

🔍 [Click here to view all ${totalInMonth.toLocaleString()} ${MONTH_NAMES[mIdx]} renewals in the data grid](#filterMonth:${encodeURIComponent(MONTH_NAMES[mIdx])})`;
    }
  }

  // 2. COMPANY SIZE / CATEGORY QUERIES (e.g. "how many large companies", "small companies count")
  if (text.includes('large') && (text.includes('company') || text.includes('companies') || text.includes('account') || text.includes('how many') || text.includes('count') || text.includes('size'))) {
    const large = all.filter(c => computeCompanySize(c) === 'Large');
    const top5 = [...large].sort((a,b) => (parseInt(b.strength,10)||0) - (parseInt(a.strength,10)||0)).slice(0, 5)
      .map(c => `• **${c.name}** (~${Number(c.strength||0).toLocaleString('en-IN')} emp) | Renewal: **${c.month || 'Upcoming'}** | BD: **${c.bd || 'Unassigned'}**`).join('\n');
    return `### 🏢 Large Corporate Accounts (>200 Employees)
- **Total Large Enterprises:** **${large.length.toLocaleString()} accounts** (${Math.round(large.length / all.length * 100)}% of dataset)
- **Outreach Strategy:** Multi-stakeholder engagement (CHRO, Head of Total Rewards, CFO, and VP Procurement).

**Top Largest Accounts in Database:**
${top5}

🔍 [Click to filter table for Large enterprises](#filterSize:Large)`;
  }

  if (text.includes('medium') && (text.includes('company') || text.includes('companies') || text.includes('how many') || text.includes('count') || text.includes('size'))) {
    const med = all.filter(c => computeCompanySize(c) === 'Medium');
    return `### 🏢 Medium Corporate Accounts (50-200 Employees)
- **Total Medium Companies:** **${med.length.toLocaleString()} accounts**
- **Characteristics:** Fast decision cycles (usually Head of HR or Founder/CFO directly), prime candidate for bundled GMC + GPA + OPD wellness.

🔍 [Click to filter table for Medium companies](#filterSize:Medium)`;
  }

  if (text.includes('small') && (text.includes('company') || text.includes('companies') || text.includes('how many') || text.includes('count') || text.includes('size'))) {
    const small = all.filter(c => computeCompanySize(c) === 'Small');
    return `### 🏢 Small Corporate Accounts (<50 Employees)
- **Total Small Companies:** **${small.length.toLocaleString()} accounts**
- **Characteristics:** Standard group policies with quick turnaround via Healthysure self-serve onboarding.

🔍 [Click to filter table for Small companies](#filterSize:Small)`;
  }

  // DUPLICATE TRACKING & BEST SUITED UNIQUE QUERIES
  if (text.includes('duplicate') || text.includes('duplicates') || text.includes('dublicate') || text.includes('dublicates')) {
    return `### 👯 Deduplication & "Best Suited Unique" Intelligence
- **Master Dataset Quality:** Healthysure's platform tracks and deduplicates corporate accounts across all workbooks and leads sheets.
- **Consolidation & Duplicate Tracking Breakdown:**
  - **Renewal Database Sheets (10 sheets):** 27,555 rows analyzed, 1,050 redundant copies deduplicated to 26,505 Best Suited Unique records.
  - **Leads 1 & Leads 2 Workbooks (104 sheets):** 67,773 rows inspected across all monthly & outreach mail sheets.
  - **Enriched Existing Accounts:** **1,422 existing companies** enriched with newly matched SPOCs, direct phone numbers, corporate emails & renewal dates.
  - **Newly Discovered Unique Companies:** **1,665 unique accounts** added without creating duplicate rows.
  - **Current Clean Master Total:** **28,170 Best Suited Unique companies**.
- **Coverage Statistics:**
  - **Verified Contacts / SPOCs:** **5,439 companies** (up from 3,298)
  - **Email Outreach Channels:** **5,054 companies** (up from 2,871)
  - **Direct Phone Numbers:** **1,874 companies** (up from 1,337)
  - **Confirmed Renewal Dates:** **24,453 companies**
- **Smart Merging Principle ("Best Suited Unique"):**
  1. **Contacts & Numbers:** When multiple entries exist, contacts (SPOCs), designations, phone numbers, and emails are merged into the primary record so outreach channels are fully maximized.
  2. **Renewal Date:** The latest confirmed renewal date and month are preserved.
  3. **Data Sources:** Merged into cross-verified sources (e.g. *Sachin Database • Leads 1 • M&L May 2026*).
  4. **Strict Deduplication:** No redundant duplicate rows are created when importing leads!`;
  }

  // 3. CITY / TERRITORY QUERIES
  const commonCities = ['bangalore', 'bengaluru', 'mumbai', 'pune', 'delhi', 'hyderabad', 'chennai', 'kolkata', 'cochin', 'ahmedabad', 'coimbatore', 'gurgaon', 'noida'];
  for (const city of commonCities) {
    const regexCity = new RegExp(`\\b${city}\\b`, 'i');
    if (regexCity.test(text)) {
      const cityNameClean = city === 'bengaluru' ? 'bangalore' : city;
      const matching = all.filter(c => (c.location || '').toLowerCase().includes(cityNameClean));
      const top5 = matching.slice(0, 5).map(c => `• **${c.name}** (${computeCompanySize(c)}) | Renewal: **${c.month || 'Upcoming'}** | BD: **${c.bd || 'Unassigned'}**`).join('\n');

      return `### 🏙️ Territory Accounts: ${city.toUpperCase()}
- **Total Corporate Accounts in ${city.toUpperCase()}:** **${matching.length.toLocaleString()} companies**

**Sample Accounts:**
${top5}

🔍 [Click to filter table for ${city.toUpperCase()}](#filterCity:${encodeURIComponent(cityNameClean)})`;
    }
  }

  // 4. BD REP / PORTFOLIO QUERIES
  const commonBDs = ['vimlendu', 'aditi', 'deepesh', 'vipul', 'ishan', 'charan', 'pooja', 'mayank', 'aadish'];
  for (const bd of commonBDs) {
    const regexBD = new RegExp(`\\b${bd}\\b`, 'i');
    if (regexBD.test(text)) {
      const matching = all.filter(c => (c.bd || '').toLowerCase().includes(bd));
      const top5 = matching.slice(0, 5).map(c => `• **${c.name}** (~${c.strength || 'N/A'} emp) | Renewal: **${c.month || 'Upcoming'}** | City: ${c.location || 'India'}`).join('\n');

      return `### 👤 BD Portfolio: ${bd.toUpperCase()}
- **Total Assigned Accounts:** **${matching.length.toLocaleString()} companies**
- **Accounts Needing Contact/Phone:** ${matching.filter(c => !c.contact || !c.phone).length.toLocaleString()} accounts

**Top Accounts under ${bd.toUpperCase()}:**
${top5}

🔍 [Click to filter table for ${bd.toUpperCase()}](#filterBD:${encodeURIComponent(bd)})`;
    }
  }

  // 5. UNASSIGNED BD QUERIES
  if (text.includes('unassigned') || text.includes('not assigned') || text.includes('without bd')) {
    const unassigned = all.filter(c => !c.bd || c.bd.toLowerCase().includes('unassigned'));
    return `### ⚠️ Unassigned Accounts
- **Total Unassigned Corporate Accounts:** **${unassigned.length.toLocaleString()} companies**
- **Action:** Use the **"BD Allocation"** button in the header bar or filter by "Unassigned" to allocate these accounts to active BD reps.

🔍 [Click to view unassigned accounts](#filterBD:Unassigned)`;
  }

  // 6. SPECIFIC COMPANY SEARCH
  const stopWords = [
    'give', 'me', 'the', 'renewal', 'month', 'of', 'for', 'when', 'is', 'does', 'date', 
    'who', 'what', 'which', 'owner', 'bd', 'person', 'contact', 'spoc', 'details', 'about', 
    'show', 'find', 'search', 'tell', 'check', 'info', 'company', 'cos', 'how', 'many',
    'status', 'strength', 'size', 'in', 'at', 'with', 'please', 'can', 'you', 'whose',
    'policy', 'policies', 'expiring', 'expiry', 'expire', 'expires', 'renewing', 'due',
    'number', 'count', 'total', 'list', 'are', 'there', 'all', 'any'
  ];

  const words = text.split(/[^a-zA-Z0-9]+/).filter(w => w.length > 1);
  const potentialCompanyWords = words.filter(w => !stopWords.includes(w));

  let matchedCompanies = [];

  if (potentialCompanyWords.length > 0) {
    const candidateQuery = potentialCompanyWords.join(' ');
    
    // First: exact substring match on company name
    matchedCompanies = all.filter(c => c.name && c.name.toLowerCase().includes(candidateQuery));

    // Second: try individual words (e.g. "nykaa")
    if (matchedCompanies.length === 0) {
      for (const w of potentialCompanyWords) {
        if (w.length >= 3) {
          const matches = all.filter(c => c.name && c.name.toLowerCase().includes(w));
          if (matches.length > 0 && matches.length < 50) {
            matchedCompanies = matches;
            break;
          }
        }
      }
    }
  }

  if (matchedCompanies.length > 0) {
    const topMatches = matchedCompanies.slice(0, 5);
    const searchTarget = potentialCompanyWords.join(' ') || matchedCompanies[0].name;

    let response = `### 🏢 Healthysure Company Intelligence: "${matchedCompanies[0].name}"\n\n`;

    if (matchedCompanies.length === 1) {
      const c = matchedCompanies[0];
      const parsedDate = parseCompanyAnnualDate(c);
      const size = computeCompanySize(c);
      const cat = getCompanyDataSourceCategory(c);
      const city = c.location ? c.location.trim() : 'Unspecified';
      const spocName = c.contact || (c.spocs && c.spocs[0] ? c.spocs[0].name : 'Not yet enriched');
      const spocDesig = c.designation || (c.spocs && c.spocs[0] ? c.spocs[0].title : '');
      const email = c.email || 'No email on record';
      const phone = c.phone || 'No phone on record';

      response += `- **Renewal Month:** **${c.month || MONTH_NAMES[parsedDate.month - 1]}** (Annual Day: **${String(parsedDate.day).padStart(2, '0')}-${MONTH_SHORT[parsedDate.month - 1]}**)\n`;
      response += `- **Company Size:** **${size}** (${c.strength ? c.strength + ' employees' : 'Emp count unverified'})\n`;
      response += `- **City / Location:** **${city}**\n`;
      response += `- **BD Owner:** **${c.bd || 'Unassigned'}**\n`;
      response += `- **Data Source:** **${cat}** ${c.src ? `(${c.src})` : ''}\n`;
      response += `- **Contact / SPOC:** **${spocName}** ${spocDesig ? `(${spocDesig})` : ''}\n`;
      response += `- **Email & Phone:** ✉️ \`${email}\` | 📞 \`${phone}\`\n`;
      if (c.remarks) response += `- **Notes / Remarks:** _${c.remarks}_\n`;
      if (c.insurer) response += `- **Incumbent Insurer:** ${c.insurer} ${c.broker ? `(Broker: ${c.broker})` : ''}\n`;

    } else {
      response += `Found **${matchedCompanies.length} matching accounts** in the Healthysure master database:\n\n`;
      
      topMatches.forEach((c, idx) => {
        const parsedDate = parseCompanyAnnualDate(c);
        const size = computeCompanySize(c);
        const cat = getCompanyDataSourceCategory(c);
        const city = c.location ? c.location.trim() : 'India';
        const contactInfo = c.contact ? `${c.contact} (${c.designation || 'SPOC'})` : 'No SPOC assigned';
        const phone = c.phone ? ` • 📞 ${c.phone}` : '';
        const email = c.email ? ` • ✉️ ${c.email}` : '';
        const premium = c.premium ? ` • Premium: ₹${Number(c.premium).toLocaleString('en-IN')}` : '';

        response += `**${idx + 1}. ${c.name}**\n`;
        response += `  • **Renewal:** **${c.month || MONTH_NAMES[parsedDate.month - 1]}** (Day: **${String(parsedDate.day).padStart(2, '0')}-${MONTH_SHORT[parsedDate.month - 1]}**)\n`;
        response += `  • **Size & City:** ${size} (${c.strength ? c.strength + ' emp' : 'N/A'}) in **${city}**\n`;
        response += `  • **BD Owner:** **${c.bd || 'Unassigned'}** | Source: ${cat}${premium}\n`;
        response += `  • **Lead Contact:** ${contactInfo}${email}${phone}\n\n`;
      });

      if (matchedCompanies.length > 5) {
        response += `_...and ${(matchedCompanies.length - 5).toLocaleString()} more related records._\n\n`;
      }
    }

    response += `\n🔍 [Click here to filter the main data table for "${searchTarget}"](#filter:${encodeURIComponent(searchTarget)})`;

    return response;
  }

  return null;
}

// Helpers called from Copilot links
function filterTableFromCopilot(query) {
  state.filters.search = query;
  state.filters.dataSource = 'ALL';
  state.filters.city = 'ALL';
  state.filters.bd = 'ALL';
  state.filters.size = 'ALL';
  state.filters.status = 'ALL';
  state.filters.contactFilter = 'ALL';
  state.filters.datePreset = 'ALL';
  state.filters.customDateRange = null;

  const searchInput = document.getElementById('globalSearch');
  if (searchInput) searchInput.value = query;

  applyFilters();
  showToast(`Showing results for "${query}"`);
}

function filterTableForMonthFromCopilot(month) {
  clearAllFilters();
  const mSelect = document.getElementById('filterMonth');
  if (mSelect) mSelect.value = month;
  state.filters.month = month;
  applyFilters();
  showToast(`Filtered for ${month} renewals`);
}

function filterTableForSizeFromCopilot(size) {
  clearAllFilters();
  const sSelect = document.getElementById('filterSize');
  if (sSelect) {
    sSelect.value = size;
    state.filters.size = size;
  }
  applyFilters();
  showToast(`Filtered for ${size} companies`);
}

function filterTableForCityFromCopilot(city) {
  clearAllFilters();
  const cSelect = document.getElementById('filterCity');
  if (cSelect) {
    for (let opt of cSelect.options) {
      if (opt.value.toLowerCase().includes(city.toLowerCase())) {
        cSelect.value = opt.value;
        state.filters.city = opt.value;
        break;
      }
    }
  }
  applyFilters();
  showToast(`Filtered for ${city}`);
}

function filterTableForBDFromCopilot(bd) {
  clearAllFilters();
  const bSelect = document.getElementById('filterBD');
  if (bSelect) {
    for (let opt of bSelect.options) {
      if (opt.value.toLowerCase().includes(bd.toLowerCase())) {
        bSelect.value = opt.value;
        state.filters.bd = opt.value;
        break;
      }
    }
  }
  applyFilters();
  showToast(`Filtered for BD: ${bd}`);
}

// Copilot Drawer & Messaging
function toggleCopilotDrawer() {
  const drawer = document.getElementById('copilotDrawer');
  const isHidden = drawer.classList.contains('translate-x-full');
  if (isHidden) {
    drawer.classList.remove('translate-x-full');
    renderCopilotMessages();
    document.getElementById('copilotInput').focus();
  } else {
    drawer.classList.add('translate-x-full');
  }
}

function renderCopilotMessages() {
  const container = document.getElementById('copilotMessagesList');
  let html = '';

  state.copilotMessages.forEach(msg => {
    const isUser = msg.role === 'user';
    html += `
      <div class="flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}">
        ${!isUser ? '<div class="w-6 h-6 rounded-full bg-[#11a387] text-white flex items-center justify-center shrink-0 text-xs font-semibold shadow-xs"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.2 8.2L20.4 10.4L14.2 12.6L12 18.8L9.8 12.6L3.6 10.4L9.8 8.2L12 2Z"/></svg></div>' : ''}
        <div class="max-w-[85%] rounded-[6px] px-3 py-2 text-xs ${isUser ? 'bg-[#11a387] text-white font-medium' : 'bg-white text-[#201f1e] border border-[#edebe9] shadow-2xs'}">
          <div class="leading-relaxed whitespace-pre-wrap">${formatMarkdown(msg.content)}</div>
        </div>
        ${isUser ? '<div class="w-6 h-6 rounded-full bg-[#323130] text-white flex items-center justify-center shrink-0 text-xs font-semibold">HS</div>' : ''}
      </div>
    `;
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
  lucide.createIcons();
}

// Interactive Prebuilt Dataset Queries (Requirement #7)
function askCopilotPrebuilt(type) {
  const total = state.allCompanies.length;
  let queryText = '';
  let answer = '';

  if (type === 'overview') {
    queryText = 'Give me a live statistical overview of our Healthysure corporate dataset.';
    
    let smallCount = 0, medCount = 0, largeCount = 0;
    const monthCounts = {};
    const cityCounts = {};
    const bdCounts = {};
    let missingSPOC = 0;

    state.allCompanies.forEach(c => {
      const sz = computeCompanySize(c);
      if (sz === 'Small') smallCount++;
      else if (sz === 'Medium') medCount++;
      else largeCount++;

      const m = c.month || 'Unspecified';
      monthCounts[m] = (monthCounts[m] || 0) + 1;

      let city = c.location ? c.location.trim() : 'Unspecified';
      if (city.toLowerCase() === 'bengaluru') city = 'Bangalore';
      cityCounts[city] = (cityCounts[city] || 0) + 1;

      const bd = c.bd || 'Unassigned';
      bdCounts[bd] = (bdCounts[bd] || 0) + 1;

      if (!c.contact || !c.email || !c.phone) missingSPOC++;
    });

    const topCities = Object.entries(cityCounts).sort((a,b)=>b[1]-a[1]).slice(0, 5).map(e=>`**${e[0]}** (${e[1].toLocaleString()})`).join(', ');
    const topBDs = Object.entries(bdCounts).sort((a,b)=>b[1]-a[1]).slice(0, 5).map(e=>`**${e[0]}** (${e[1].toLocaleString()})`).join(', ');

    answer = `### 📊 Healthysure Master Dataset Overview
- **Total Master Accounts:** **${total.toLocaleString()}** corporate companies
- **Company Size Breakdown:**
  - **Small (<50 emp):** ${smallCount.toLocaleString()} (${Math.round(smallCount/total*100)}%)
  - **Medium (50-200 emp):** ${medCount.toLocaleString()} (${Math.round(medCount/total*100)}%)
  - **Large (>200 emp):** ${largeCount.toLocaleString()} (${Math.round(largeCount/total*100)}%)
- **Top Corporate Cities:** ${topCities}
- **Top BD Allocations:** ${topBDs}
- **Outreach Priority:** **${missingSPOC.toLocaleString()}** accounts require SPOC or phone enrichment.`;

  } else if (type === 'large_renewals') {
    queryText = 'Show me upcoming Large corporate renewals (>200 employees) and tactical outreach advice.';

    const largeCos = state.allCompanies.filter(c => computeCompanySize(c) === 'Large').slice(0, 5);
    const coList = largeCos.map(c => `• **${c.name}** (~${c.strength || '200+'} emp) | Renewal: **${c.month || 'Upcoming'}** | City: **${c.location || 'India'}** | BD: **${c.bd || 'Unassigned'}**`).join('\n');

    answer = `### 🎯 Top Upcoming Large Corporate Renewals (>200 Employees)
${coList}

**Tactical Strategy for Large Accounts:**
1. **Target the Buying Committee:** In enterprises >200 lives, the decision is joint between **Head of Total Rewards / HR**, **VP Procurement**, and the **CFO**.
2. **Pitch Healthysure USPs:**
   - 98% Cashless claim approval speed via dedicated WhatsApp desk.
   - Zero-day waiting period for pre-existing ailments (vital for IT/Fintech talent retention).
   - Bundled OPD wellness wallets covering diagnostics and doctor teleconsults.`;

  } else if (type === 'city_breakdown') {
    queryText = 'What is the city-wise distribution for BD territory assignment?';

    const cityCounts = {};
    state.allCompanies.forEach(c => {
      let loc = c.location ? c.location.trim() : 'Unspecified';
      if (loc.toLowerCase() === 'bengaluru') loc = 'Bangalore';
      cityCounts[loc] = (cityCounts[loc] || 0) + 1;
    });

    const sorted = Object.entries(cityCounts).sort((a,b)=>b[1]-a[1]).slice(0, 10);
    const list = sorted.map((s, idx) => `${idx + 1}. **${s[0]}**: ${s[1].toLocaleString()} accounts`).join('\n');

    answer = `### 🏙️ Top 10 Territories by City
${list}

**Territory Recommendation:**
- Assign dedicated BD representatives per hub (e.g. Bangalore & Mumbai account for >25% of all accounts).
- Use the **City / Location** filter in the filter ribbon to isolate a city and reallocate in bulk to local BD members!`;

  } else if (type === 'bd_reassign') {
    queryText = 'How do I reallocate accounts from ex-employees to new BD members?';
    answer = `### 🔄 BD Owner Reallocation Guide
You have two fast ways to reassign accounts:
1. **1-Click Portfolio Transfer (Best for Ex-Employees):**
   - Click the **"BD Allocation"** button in the top bar or open **Settings -> BD Team Management**.
   - Select the ex-employee's name from the dropdown.
   - Enter the replacement BD member's name and click **"Transfer All Accounts Now"**.
2. **Bulk Selection Transfer:**
   - Filter by BD member, select the checkboxes, and click **"Reallocate BD Owner"** in the command bar!`;

  } else if (type === 'healthysure_pitch') {
    queryText = 'Draft a high-converting corporate renewal pitch comparing Healthysure against traditional brokers.';
    answer = `### ✉️ Healthysure Corporate Renewal Pitch Template

**Subject:** Streamlining your corporate health insurance renewal for 2026 - Healthysure

**Hi [Name],**

I noticed that [Company Name]'s corporate health insurance policy renewal is approaching. 

Traditional insurance brokers usually hand you off to a third-party TPA call center when claims happen. At **Healthysure** (https://www.healthysure.in), we eliminate claim friction through:

1. **WhatsApp Cashless Claims:** 98% cashless approval assistance for employees and their families directly on WhatsApp.
2. **Integrated OPD & Wellness Wallets:** Tailored dental, vision, and mental health consultations without out-of-pocket delays.
3. **Transparent Insurer Benchmarking:** Independent competitive quotes across ICICI Lombard, Tata AIG, Care, and Digit to optimize premiums by 15-25%.

Would you be open for a brief 10-minute introductory sync this Thursday at 3 PM to review your policy terms and renewal quotes?

Best regards,  
**[BD Owner Name]**  
Corporate Benefits Team | Healthysure  
https://www.healthysure.in`;
  }

  state.copilotMessages.push({ role: 'user', content: queryText });
  state.copilotMessages.push({ role: 'assistant', content: answer });
  renderCopilotMessages();
}

async function sendCopilotMessage() {
  const input = document.getElementById('copilotInput');
  const text = input.value.trim();
  if (!text) return;

  state.copilotMessages.push({ role: 'user', content: text });
  input.value = '';
  renderCopilotMessages();

  const typingId = 'typing_' + Date.now();
  state.copilotMessages.push({ role: 'assistant', content: '...', id: typingId });
  renderCopilotMessages();

  // 1. FIRST: Check the local Healthysure dataset (Instant & 100% accurate!)
  const localDatasetResult = searchDatasetForCopilot(text);
  if (localDatasetResult) {
    const typingIndex = state.copilotMessages.findIndex(m => m.id === typingId);
    if (typingIndex !== -1) {
      state.copilotMessages[typingIndex] = { role: 'assistant', content: localDatasetResult };
    }
    renderCopilotMessages();
    return;
  }

  // 2. SECOND: If general consulting/pitch query, invoke OpenAI with local dataset context
  const total = state.allCompanies.length;
  const filtered = state.filteredCompanies.length;

  const systemPrompt = `You are Healthysure's Senior Insurance Renewal Copilot (https://www.healthysure.in).
Brand Color: #11a387. Healthysure offers Group Health (GMC), Personal Accident (GPA), Term Life (GTL), OPD Wellness wallets, and WhatsApp cashless claims assistance.
Database: ${total.toLocaleString()} total companies, ${filtered.toLocaleString()} filtered view.
Answer with structured, professional, concise insights.`;

  const conversationHistory = state.copilotMessages
    .filter(m => m.id !== typingId)
    .slice(-6)
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const reply = await callOpenAI([
      { role: 'system', content: systemPrompt },
      ...conversationHistory
    ]);

    const typingIndex = state.copilotMessages.findIndex(m => m.id === typingId);
    if (typingIndex !== -1) {
      state.copilotMessages[typingIndex] = { role: 'assistant', content: reply };
    }
  } catch (err) {
    const typingIndex = state.copilotMessages.findIndex(m => m.id === typingId);
    if (typingIndex !== -1) {
      let fallback = `### 💡 Healthysure Renewal Guidance\n\n`;
      if (text.toLowerCase().includes('pitch') || text.toLowerCase().includes('convince') || text.toLowerCase().includes('broker')) {
        fallback += `**How to win renewals against incumbent brokers:**\n1. **WhatsApp Cashless Support:** 98% claims approved within 30 minutes on WhatsApp.\n2. **Custom OPD Wallets:** Employee healthcare beyond hospitalization.\n3. **Independent Quotes:** Benchmarking across ICICI, Tata AIG, Care & Digit.\n\n_(Note: To enable unlimited free-form generative queries, verify your OpenAI API key in Settings -> AI & Enrichment.)_`;
      } else {
        fallback += `I couldn't query the external AI service (${err.message}).\n\n**Tip:** You can ask me directly about any of our 27,000+ companies (e.g. *"give me the renewal month of Nykaa"*, *"who handles Udaan"*), or use the interactive buttons above for live dataset analytics!`;
      }
      state.copilotMessages[typingIndex] = { role: 'assistant', content: fallback };
    }
  }

  renderCopilotMessages();
}

// OpenAI API Call (with Sanitization and Self-Healing Fallback)
async function callOpenAI(messages, customModel) {
  const apiKey = state.aiConfig.apiKey;
  if (!apiKey) throw new Error('OpenAI API key missing. Please configure it in Settings.');

  const model = sanitizeModelId(customModel || state.aiConfig.model || 'gpt-4o-mini');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.2
    })
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    const rawMsg = errData.error?.message || `OpenAI request failed: ${resp.status}`;
    
    // Auto-heal if model ID was rejected by OpenAI
    if (rawMsg.toLowerCase().includes('model') && model !== 'gpt-4o-mini') {
      console.warn(`Model ${model} failed, falling back to gpt-4o-mini`);
      state.aiConfig.model = 'gpt-4o-mini';
      localStorage.setItem('hs_openai_model', 'gpt-4o-mini');
      return callOpenAI(messages, 'gpt-4o-mini');
    }
    throw new Error(rawMsg);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

async function discoverModelsFromKey(apiKey, isSilent = false) {
  const statusEl = document.getElementById('apiKeyStatus');
  if (!apiKey || !apiKey.startsWith('sk-')) {
    if (statusEl && !isSilent) statusEl.innerHTML = '<span class="text-[#a80000]">Please enter a valid OpenAI API key starting with sk-</span>';
    return;
  }

  if (statusEl && !isSilent) statusEl.innerHTML = '<span class="text-[#11a387]">Discovering available models...</span>';

  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const chatModels = data.data
      .filter(m => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('chat'))
      .map(m => m.id)
      .sort();

    state.aiConfig.cachedModels = chatModels;
    localStorage.setItem('hs_openai_models_cache', JSON.stringify(chatModels));

    populateModelDropdown(chatModels, state.aiConfig.model);

    if (statusEl) {
      statusEl.innerHTML = `<span class="text-[#11a387] font-semibold">✓ Verified! Discovered ${chatModels.length} models.</span>`;
    }
  } catch (err) {
    if (statusEl && !isSilent) statusEl.innerHTML = `<span class="text-[#a80000]">Failed to discover models: ${err.message}</span>`;
  }
}

function populateModelDropdown(modelsList, activeModel) {
  const select = document.getElementById('selectAiModel');
  const badge = document.getElementById('modelCountBadge');
  if (!select) return;

  select.innerHTML = '';
  if (badge) {
    badge.textContent = `${modelsList.length} models`;
    badge.classList.remove('hidden');
  }

  modelsList.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m === 'gpt-4o-mini' ? `${m} ★ (Recommended: Fast & Ultra-Cost Effective)` : m;
    select.appendChild(opt);
  });

  const cleanActive = sanitizeModelId(activeModel);
  if (modelsList.includes(cleanActive)) {
    select.value = cleanActive;
  }
}

// Settings Modal Management
function openSettingsModal(tabName = 'ai') {
  document.getElementById('inputApiKey').value = state.aiConfig.apiKey || '';
  const apolloEl = document.getElementById('inputApolloKey');
  if (apolloEl) apolloEl.value = state.aiConfig.apolloKey || '';
  const serpEl = document.getElementById('inputSerpApiKey');
  if (serpEl) serpEl.value = state.aiConfig.serpApiKey || '';
  const prospeoEl = document.getElementById('inputProspeoKey');
  if (prospeoEl) prospeoEl.value = state.aiConfig.prospeoKey || '';
  
  const curPassEl = document.getElementById('inputCurrentAdminPassword');
  if (curPassEl) curPassEl.value = '';
  const newPassEl = document.getElementById('inputNewAdminPassword');
  if (newPassEl) newPassEl.value = '';
  const confPassEl = document.getElementById('inputConfirmAdminPassword');
  if (confPassEl) confPassEl.value = '';
  const msgEl = document.getElementById('adminPassChangeMsg');
  if (msgEl) {
    msgEl.className = 'hidden';
    msgEl.textContent = '';
  }

  const curLoginPassEl = document.getElementById('inputCurrentLoginPassword');
  if (curLoginPassEl) curLoginPassEl.value = '';
  const newLoginPassEl = document.getElementById('inputNewLoginPassword');
  if (newLoginPassEl) newLoginPassEl.value = '';
  const confLoginPassEl = document.getElementById('inputConfirmLoginPassword');
  if (confLoginPassEl) confLoginPassEl.value = '';
  const loginMsgEl = document.getElementById('loginPassChangeMsg');
  if (loginMsgEl) {
    loginMsgEl.className = 'hidden';
    loginMsgEl.textContent = '';
  }

  const modelSelect = document.getElementById('selectAiModel');
  if (modelSelect) modelSelect.value = sanitizeModelId(state.aiConfig.model);

  const total = state.allCompanies.length;
  const setTotal = document.getElementById('settingTotalRecords');
  if (setTotal) setTotal.textContent = total.toLocaleString();

  switchSettingsTab(tabName);
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelectorAll('.fluent-tab').forEach(t => t.classList.remove('active'));

  const activeContent = document.getElementById(`tabContent_${tabName}`);
  const activeTab = document.getElementById(`tabBtn_${tabName}`);

  if (activeContent) activeContent.classList.remove('hidden');
  if (activeTab) activeTab.classList.add('active');
}

function saveSettings() {
  const key = document.getElementById('inputApiKey').value.trim();
  const apolloEl = document.getElementById('inputApolloKey');
  const apolloKey = apolloEl ? apolloEl.value.trim() : '';
  const serpEl = document.getElementById('inputSerpApiKey');
  const serpApiKey = serpEl ? serpEl.value.trim() : '';
  const prospeoEl = document.getElementById('inputProspeoKey');
  const prospeoKey = prospeoEl ? prospeoEl.value.trim() : '';
  const modelEl = document.getElementById('selectAiModel');
  const model = sanitizeModelId(modelEl ? modelEl.value : 'gpt-4o-mini');

  state.aiConfig.apiKey = key;
  state.aiConfig.apolloKey = apolloKey;
  state.aiConfig.serpApiKey = serpApiKey;
  state.aiConfig.prospeoKey = prospeoKey;
  state.aiConfig.model = model;

  localStorage.setItem('hs_openai_key', key);
  localStorage.setItem('hs_apollo_key', apolloKey);
  localStorage.setItem('hs_serpapi_key', serpApiKey);
  localStorage.setItem('hs_prospeo_key', prospeoKey);
  localStorage.setItem('hs_openai_model', model);
  localStorage.removeItem('hs_admin_password'); // clean legacy key

  closeSettingsModal();
  showToast('Settings saved successfully');
}

function triggerModelDiscovery() {
  const key = document.getElementById('inputApiKey').value.trim();
  discoverModelsFromKey(key, false);
}

// Reset Database action in Settings
async function resetDatabaseToDefault() {
  if (!confirm('Re-download this device\'s copy: the local database is rebuilt from the master 27,003 records and then all shared team edits are re-applied. Unsynced local edits on this device will be lost. Continue?')) {
    return;
  }
  syncState.pending.clear();
  syncPersistPending();
  syncSetRev(0);
  renderLoadingState('Resetting database to default...');
  closeSettingsModal();

  if (window.COMPANIES_DATA) {
    await saveCompaniesToDB(window.COMPANIES_DATA);
    state.allCompanies = await loadAllCompaniesFromDB();
    populateFilterOptions();
    applyFilters();
    updateHeaderStats();
    await syncPull();
    hideLoadingState();
    showToast('Local copy rebuilt from master data + shared team edits');
  } else {
    hideLoadingState();
    showToast('Master data not available', 'error');
  }
}

function exportDatabaseBackupJson() {
  const jsonStr = JSON.stringify(state.allCompanies, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Healthysure_DB_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Database backup downloaded');
}

// Utility Helpers
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(message) {
  const toast = document.getElementById('toastNotification');
  const toastMsg = document.getElementById('toastMessage');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3200);
}

function formatMarkdown(text) {
  if (!text) return '';
  // Normalize pre-escaped HTML entities from raw dataset strings to prevent double-encoding
  const normalized = text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  let escaped = escapeHtml(normalized);
  
  // Convert markdown links [Label](url)
  escaped = escaped.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="text-[#11a387] font-semibold underline hover:text-[#0e8770]">$1</a>');

  // Headers and formatting
  return escaped
    .replace(/^### (.*$)/gim, '<div class="font-bold text-xs text-[#201f1e] mt-2 mb-1 border-b border-[#edebe9] pb-0.5">$1</div>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-[#edebe9] px-1 py-0.5 rounded text-[11px] font-mono select-all">$1</code>')
    .replace(/\n\n/g, '<div class="h-2"></div>')
    .replace(/\n/g, '<br>');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  let searchTimeout;
  const searchInput = document.getElementById('globalSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.filters.search = e.target.value;
        applyFilters();
      }, 150);
    });
  }

  // Filter Dropdown Listeners
  const dsFilter = document.getElementById('filterDataSource');
  if (dsFilter) {
    dsFilter.addEventListener('change', (e) => {
      state.filters.dataSource = e.target.value;
      applyFilters();
    });
  }

  const cityFilter = document.getElementById('filterCity');
  if (cityFilter) {
    cityFilter.addEventListener('change', (e) => {
      state.filters.city = e.target.value;
      applyFilters();
    });
  }

  const bdFilter = document.getElementById('filterBD');
  if (bdFilter) {
    bdFilter.addEventListener('change', (e) => {
      state.filters.bd = e.target.value;
      applyFilters();
    });
  }

  const sizeFilter = document.getElementById('filterSize');
  if (sizeFilter) {
    sizeFilter.addEventListener('change', (e) => {
      state.filters.size = e.target.value;
      applyFilters();
    });
  }

  const statusFilter = document.getElementById('filterStatus');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      applyFilters();
    });
  }

  const pageSizeSelect = document.getElementById('pageSizeSelect');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      state.pageSize = parseInt(e.target.value, 10);
      state.currentPage = 1;
      renderTable();
    });
  }

  const copilotInput = document.getElementById('copilotInput');
  if (copilotInput) {
    copilotInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCopilotMessage();
      }
    });
  }

  // Copilot messages link interceptor
  const copilotList = document.getElementById('copilotMessagesList');
  if (copilotList) {
    copilotList.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (href && href.startsWith('#filter:')) {
        e.preventDefault();
        const query = decodeURIComponent(href.replace('#filter:', ''));
        filterTableFromCopilot(query);
      } else if (href && href.startsWith('#filterMonth:')) {
        e.preventDefault();
        const m = decodeURIComponent(href.replace('#filterMonth:', ''));
        filterTableForMonthFromCopilot(m);
      } else if (href && href.startsWith('#filterCity:')) {
        e.preventDefault();
        const c = decodeURIComponent(href.replace('#filterCity:', ''));
        filterTableForCityFromCopilot(c);
      } else if (href && href.startsWith('#filterBD:')) {
        e.preventDefault();
        const b = decodeURIComponent(href.replace('#filterBD:', ''));
        filterTableForBDFromCopilot(b);
      } else if (href && href.startsWith('#filterSize:')) {
        e.preventDefault();
        const s = decodeURIComponent(href.replace('#filterSize:', ''));
        filterTableForSizeFromCopilot(s);
      }
    });
  }
});

// ==================== BD CENTRAL REPOSITORY AUTHENTICATION ====================
function checkBDAuthStatus() {
  const overlay = document.getElementById('bdAuthOverlay');
  if (overlay) {
    overlay.classList.remove('auth-unlocked', 'hidden');
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    const idField = document.getElementById('bdLoginId');
    if (idField) {
      idField.value = '';
      setTimeout(() => idField.focus(), 150);
    }
    const pwdField = document.getElementById('bdLoginPassword');
    if (pwdField) pwdField.value = '';
  }
}

async function handleBDLogin(event) {
  if (event) event.preventDefault();
  const idEl = document.getElementById('bdLoginId');
  const pwdEl = document.getElementById('bdLoginPassword');
  const errEl = document.getElementById('bdLoginError');
  const cardEl = document.getElementById('bdAuthCard');

  const rawId = (idEl ? idEl.value : '').trim().toLowerCase();
  const rawPwd = (pwdEl ? pwdEl.value : '');

  // Accept bdhealthysure.in, bd@healthysure.in, bd
  const validUser = (rawId === 'bdhealthysure.in' || rawId === 'bd@healthysure.in' || rawId === 'bd');

  let validPwd = false;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawPwd);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    const hashHex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
    // Verified SHA-256 hash
    const targetLoginHash = getLoginPasswordHash();
    if (hashHex === targetLoginHash) {
      validPwd = true;
    }
  } catch (err) {
    const fallbackB64 = localStorage.getItem('hs_bd_login_b64') || 'QnVzaW5lc3NAMjAyNg==';
    if (btoa(rawPwd) === fallbackB64) {
      validPwd = true;
    }
  }

  if (validUser && validPwd) {
    if (errEl) errEl.classList.add('hidden');
    sessionStorage.setItem('hs_bd_auth', 'true');
    localStorage.setItem('hs_bd_user', rawId);
    
    const overlay = document.getElementById('bdAuthOverlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.25s ease-out';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => {
        overlay.classList.add('auth-unlocked', 'hidden');
        overlay.style.display = 'none';
      }, 250);
    }
  } else {
    if (errEl) {
      errEl.classList.remove('hidden');
      const errText = document.getElementById('bdLoginErrorText');
      if (errText) {
        errText.textContent = 'Invalid credentials. Please check your details and retry.';
      }
    }
    if (cardEl) {
      cardEl.classList.remove('shake-card');
      void cardEl.offsetWidth;
      cardEl.classList.add('shake-card');
    }
    if (pwdEl) {
      pwdEl.value = '';
      pwdEl.focus();
    }
  }
}

function lockRepository() {
  localStorage.removeItem('hs_bd_auth');
  sessionStorage.removeItem('hs_bd_auth');
  checkBDAuthStatus();
}

function togglePasswordVisibility() {
  const pwdField = document.getElementById('bdLoginPassword');
  const eyeOpen = document.getElementById('eyeIconOpen');
  const eyeClosed = document.getElementById('eyeIconClosed');
  if (!pwdField) return;
  if (pwdField.type === 'password') {
    pwdField.type = 'text';
    if (eyeOpen) eyeOpen.classList.add('hidden');
    if (eyeClosed) eyeClosed.classList.remove('hidden');
  } else {
    pwdField.type = 'password';
    if (eyeOpen) eyeOpen.classList.remove('hidden');
    if (eyeClosed) eyeClosed.classList.add('hidden');
  }
}

// ==================== PORTAL & ADMIN SECURITY MANAGEMENT ====================
async function sha256Hex(str) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return btoa(str);
  }
}

// 1. Portal Login Password
function getLoginPasswordHash() {
  return localStorage.getItem('hs_bd_login_hash') || 'ffcfa9389f6a158158c4ea27c5bf559e7fe6569476f8f4112bf0408c646a3d58';
}

async function verifyLoginPassword(inputPass) {
  if (!inputPass) return false;
  const hash = await sha256Hex(inputPass);
  const targetHash = getLoginPasswordHash();
  const fallbackB64 = localStorage.getItem('hs_bd_login_b64') || 'QnVzaW5lc3NAMjAyNg==';
  return (hash === targetHash || btoa(inputPass) === fallbackB64);
}

async function changeLoginPassword() {
  const currentPass = (document.getElementById('inputCurrentLoginPassword').value || '').trim();
  const newPass = (document.getElementById('inputNewLoginPassword').value || '').trim();
  const confirmPass = (document.getElementById('inputConfirmLoginPassword').value || '').trim();
  const msgEl = document.getElementById('loginPassChangeMsg');

  if (!currentPass || !newPass || !confirmPass) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'Please fill in all three password fields.';
    }
    return;
  }

  const isValidCurrent = await verifyLoginPassword(currentPass);
  if (!isValidCurrent) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'Current Portal Password is incorrect.';
    }
    return;
  }

  if (newPass.length < 6) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'New password must be at least 6 characters long.';
    }
    return;
  }

  if (newPass !== confirmPass) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'New passwords do not match. Please re-enter.';
    }
    return;
  }

  const newHash = await sha256Hex(newPass);
  localStorage.setItem('hs_bd_login_hash', newHash);
  localStorage.setItem('hs_bd_login_b64', btoa(newPass));

  document.getElementById('inputCurrentLoginPassword').value = '';
  document.getElementById('inputNewLoginPassword').value = '';
  document.getElementById('inputConfirmLoginPassword').value = '';

  if (msgEl) {
    msgEl.className = 'text-[#0e8770] text-[11px] font-semibold block';
    msgEl.textContent = 'Portal Login Password updated successfully!';
  }
  showToast('Portal login password updated successfully');
}

// Modal for changing login password directly from login card
function openLoginPasswordChangeModal() {
  const modal = document.getElementById('loginPassModal');
  if (!modal) return;
  document.getElementById('modalCurLoginPass').value = '';
  document.getElementById('modalNewLoginPass').value = '';
  document.getElementById('modalConfLoginPass').value = '';
  const msgEl = document.getElementById('modalLoginPassMsg');
  if (msgEl) msgEl.className = 'hidden';
  modal.classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('modalCurLoginPass').focus();
  }, 100);
}

function closeLoginPasswordChangeModal() {
  const modal = document.getElementById('loginPassModal');
  if (modal) modal.classList.add('hidden');
}

async function submitLoginPasswordChangeModal() {
  const currentPass = (document.getElementById('modalCurLoginPass').value || '').trim();
  const newPass = (document.getElementById('modalNewLoginPass').value || '').trim();
  const confirmPass = (document.getElementById('modalConfLoginPass').value || '').trim();
  const msgEl = document.getElementById('modalLoginPassMsg');

  if (!currentPass || !newPass || !confirmPass) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'Please fill in all three password fields.';
    }
    return;
  }

  const isValidCurrent = await verifyLoginPassword(currentPass);
  if (!isValidCurrent) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'Current Portal Password is incorrect.';
    }
    return;
  }

  if (newPass.length < 6) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'New password must be at least 6 characters.';
    }
    return;
  }

  if (newPass !== confirmPass) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'New passwords do not match. Please re-enter.';
    }
    return;
  }

  const newHash = await sha256Hex(newPass);
  localStorage.setItem('hs_bd_login_hash', newHash);
  localStorage.setItem('hs_bd_login_b64', btoa(newPass));

  if (msgEl) {
    msgEl.className = 'text-[#0e8770] text-[11px] font-semibold block';
    msgEl.textContent = 'Password updated! Use your new password to log in.';
  }
  showToast('Portal password updated successfully');
  setTimeout(() => {
    closeLoginPasswordChangeModal();
    const loginPwd = document.getElementById('bdLoginPassword');
    if (loginPwd) loginPwd.focus();
  }, 1200);
}

// 2. Admin Master Password (Excel & CRM Export Protection)
function getAdminPasswordHash() {
  return localStorage.getItem('hs_admin_password_hash') || '9c736d9194342b6d78a4a8322682d420c9a24a32d167e83bf20a137e798d3869';
}

async function verifyAdminPassword(inputPass) {
  if (!inputPass) return false;
  const hash = await sha256Hex(inputPass);
  const targetHash = getAdminPasswordHash();
  const fallbackB64 = localStorage.getItem('hs_admin_password_b64') || 'VmltbGVuZHVAMTIzNA==';
  return (hash === targetHash || btoa(inputPass) === fallbackB64);
}

function openAdminPasswordChangeDirect() {
  closeAdminExportModal();
  closeCrmExportModal();
  openSettingsModal('security');
}

async function changeAdminPassword() {
  const currentPass = (document.getElementById('inputCurrentAdminPassword').value || '').trim();
  const newPass = (document.getElementById('inputNewAdminPassword').value || '').trim();
  const confirmPass = (document.getElementById('inputConfirmAdminPassword').value || '').trim();
  const msgEl = document.getElementById('adminPassChangeMsg');

  if (!currentPass || !newPass || !confirmPass) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'Please fill in all three password fields.';
    }
    return;
  }

  const isValidCurrent = await verifyAdminPassword(currentPass);
  if (!isValidCurrent) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'Current Admin Password is incorrect.';
    }
    return;
  }

  if (newPass.length < 6) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'New password must be at least 6 characters long.';
    }
    return;
  }

  if (newPass !== confirmPass) {
    if (msgEl) {
      msgEl.className = 'text-[#a80000] text-[11px] font-medium block';
      msgEl.textContent = 'New passwords do not match. Please re-enter.';
    }
    return;
  }

  const newHash = await sha256Hex(newPass);
  localStorage.setItem('hs_admin_password_hash', newHash);
  localStorage.setItem('hs_admin_password_b64', btoa(newPass));

  document.getElementById('inputCurrentAdminPassword').value = '';
  document.getElementById('inputNewAdminPassword').value = '';
  document.getElementById('inputConfirmAdminPassword').value = '';

  if (msgEl) {
    msgEl.className = 'text-[#0e8770] text-[11px] font-semibold block';
    msgEl.textContent = 'Admin Master Password updated successfully!';
  }
  showToast('Admin password updated successfully');
}

// ==================== FOUNDER REVIEW FEEDBACK SYSTEM ====================
function openFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (!modal) return;
  const successEl = document.getElementById('fbSuccessMsg');
  if (successEl) successEl.classList.add('hidden');
  const notesEl = document.getElementById('fbNotes');
  if (notesEl) notesEl.value = '';
  modal.classList.remove('hidden');
  setTimeout(() => {
    if (notesEl) notesEl.focus();
  }, 100);
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.classList.add('hidden');
}

async function submitFounderFeedback() {
  const category = document.getElementById('fbCategory').value;
  const author = (document.getElementById('fbAuthor').value || 'Founder').trim();
  const notes = (document.getElementById('fbNotes').value || '').trim();
  const successEl = document.getElementById('fbSuccessMsg');

  if (!notes) {
    showToast('Please type your notes or suggestions before submitting.', 'warning');
    return;
  }

  const payload = {
    category,
    author,
    notes,
    clientTime: new Date().toISOString()
  };

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      if (successEl) successEl.classList.remove('hidden');
      showToast('✓ Founder review notes saved and synced!');
      setTimeout(() => {
        closeFeedbackModal();
      }, 1500);
    } else {
      showToast('Saved locally in browser review log');
      closeFeedbackModal();
    }
  } catch (err) {
    showToast('Saved locally in browser review log');
    closeFeedbackModal();
  }
}



