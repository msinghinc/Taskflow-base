// ============================================================
// TaskFlow Background Service Worker v4.0
// Added: LOI generation via Google Docs + Drive APIs
// ============================================================

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents"
];

// ---- AUTH ----
function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function fetchWithAuth(url, options = {}) {
  let token = await getAuthToken(false);
  const headers = { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(options.headers || {}) };
  let response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    await new Promise(r => chrome.identity.removeCachedAuthToken({ token }, r));
    token = await getAuthToken(true);
    headers["Authorization"] = "Bearer " + token;
    response = await fetch(url, { ...options, headers });
  }
  return response;
}

// ---- GOOGLE SHEETS ----
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function getSpreadsheetId() {
  return new Promise(r => { chrome.storage.local.get("spreadsheetId", result => r(result.spreadsheetId || null)); });
}
async function setSpreadsheetId(id) {
  return new Promise(r => chrome.storage.local.set({ spreadsheetId: id }, r));
}

async function createSpreadsheet() {
  const body = {
    properties: { title: "TaskFlow Data" },
    sheets: [
      {
        properties: { title: "Acquisitions", index: 0 },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values:
          ["id","name","address","propertyType","stage","priority","askingPrice","noi","capRate","sqft","acreage","numTenants","walt","broker","brokerContact","brokerPhone","brokerEmail","notes","listingLink","uwLink","costarLink","loiLink","omLink","vehiclesPerDay","pop3mi","ahi3mi","score","uwRentPsf","uwVacancy","uwExpenseRatio","uwTargetCap","createdAt","lastActivity"]
          .map(v => ({ userEnteredValue: { stringValue: v } })) }] }]
      },
      {
        properties: { title: "DueDiligence", index: 1 },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values:
          ["id","dealName","closingDate","tasks"]
          .map(v => ({ userEnteredValue: { stringValue: v } })) }] }]
      },
      {
        properties: { title: "AssetManagement", index: 2 },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values:
          ["id","name","address","propertyType","tenant","noi","leaseExpiry","tasks"]
          .map(v => ({ userEnteredValue: { stringValue: v } })) }] }]
      }
    ]
  };
  const resp = await fetchWithAuth(SHEETS_BASE, { method: "POST", body: JSON.stringify(body) });
  const data = await resp.json();
  if (data.spreadsheetId) { await setSpreadsheetId(data.spreadsheetId); return data.spreadsheetId; }
  throw new Error("Failed to create spreadsheet");
}

async function readSheet(sheetName) {
  const ssId = await getSpreadsheetId();
  if (!ssId) return null;
  const resp = await fetchWithAuth(SHEETS_BASE + "/" + ssId + "/values/" + sheetName);
  const data = await resp.json();
  if (!data.values || data.values.length < 2) return [];
  const headers = data.values[0];
  return data.values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ""; });
    return obj;
  });
}

async function writeSheet(sheetName, headers, rows) {
  const ssId = await getSpreadsheetId();
  if (!ssId) return;
  const values = [headers, ...rows.map(row => headers.map(h => {
    const val = row[h];
    if (val === undefined || val === null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  }))];
  await fetchWithAuth(SHEETS_BASE + "/" + ssId + "/values/" + sheetName + ":clear", { method: "POST", body: "{}" });
  await fetchWithAuth(SHEETS_BASE + "/" + ssId + "/values/" + sheetName + "?valueInputOption=RAW", { method: "PUT", body: JSON.stringify({ values }) });
}

const ACQ_H = ["id","name","address","propertyType","stage","priority","askingPrice","noi","capRate","sqft","acreage","numTenants","walt","broker","brokerContact","brokerPhone","brokerEmail","notes","listingLink","uwLink","costarLink","loiLink","omLink","vehiclesPerDay","pop3mi","ahi3mi","score","uwRentPsf","uwVacancy","uwExpenseRatio","uwTargetCap","createdAt","lastActivity"];
const DD_H = ["id","dealName","closingDate","tasks"];
const AM_H = ["id","name","address","propertyType","tenant","noi","leaseExpiry","tasks"];

async function syncToSheets(section, data) {
  if (section === "acquisitions") { await writeSheet("Acquisitions", ACQ_H, data); }
  else if (section === "dd") { await writeSheet("DueDiligence", DD_H, data.map(d => ({ ...d, tasks: JSON.stringify(d.tasks || []) }))); }
  else if (section === "am") { await writeSheet("AssetManagement", AM_H, data.map(p => ({ ...p, tasks: JSON.stringify(p.tasks || []) }))); }
}

async function loadFromSheets(section) {
  if (section === "acquisitions") {
    const rows = await readSheet("Acquisitions");
    if (!rows) return null;
    return rows.map(r => ({ ...r, askingPrice:parseFloat(r.askingPrice)||0, noi:parseFloat(r.noi)||0, capRate:parseFloat(r.capRate)||0, sqft:parseFloat(r.sqft)||0, createdAt:parseInt(r.createdAt)||Date.now(), lastActivity:parseInt(r.lastActivity)||Date.now() }));
  } else if (section === "dd") {
    const rows = await readSheet("DueDiligence");
    if (!rows) return null;
    return rows.map(r => ({ ...r, tasks: r.tasks ? JSON.parse(r.tasks) : [] }));
  } else if (section === "am") {
    const rows = await readSheet("AssetManagement");
    if (!rows) return null;
    return rows.map(r => ({ ...r, noi:parseFloat(r.noi)||0, tasks: r.tasks ? JSON.parse(r.tasks) : [] }));
  }
  return null;
}

// ---- GOOGLE CALENDAR ----
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

async function createCalendarEvent(summary, description, startHour, startMinute) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMinute, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const event = {
    summary, description,
    start: { dateTime: start.toISOString(), timeZone: "America/New_York" },
    end: { dateTime: end.toISOString(), timeZone: "America/New_York" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] }
  };
  const resp = await fetchWithAuth(CAL_BASE + "/calendars/primary/events", { method: "POST", body: JSON.stringify(event) });
  return resp.json();
}

async function pushDDToCalendar() {
  const ddData = await loadFromSheets("dd");
  if (!ddData || !ddData.length) return;
  let txt = "📋 DUE DILIGENCE — Today's Focus\n\n";
  let hasItems = false;
  ddData.forEach(dd => {
    const active = (dd.tasks||[]).filter(t => !t.completed);
    if (active.length) {
      hasItems = true;
      txt += "🏢 " + dd.dealName + "\n";
      if (dd.closingDate) { const d = Math.ceil((new Date(dd.closingDate)-new Date())/864e5); txt += "   ⏰ " + (d>0?d+" days to close":"PAST CLOSING DATE") + "\n"; }
      active.forEach(t => { const od = t.dueDate && new Date(t.dueDate)<new Date(new Date().toDateString()); txt += "   " + (od?"🔴":"⬜") + " " + t.text + (t.dueDate?" (due "+t.dueDate+")":"") + "\n"; });
      txt += "\n";
    }
  });
  if (hasItems) await createCalendarEvent("TaskFlow: Due Diligence", txt, 11, 0);
}

async function pushAcqToCalendar() {
  const acqData = await loadFromSheets("acquisitions");
  if (!acqData || !acqData.length) return;
  const active = acqData.filter(d => d.stage!=="dead" && d.stage!=="closed");
  if (!active.length) return;
  let txt = "🎯 ACQUISITIONS — Pipeline Review\n\n";
  const stale = active.filter(d => { const la=parseInt(d.lastActivity)||parseInt(d.createdAt)||0; return(Date.now()-la)>7*864e5; });
  if (stale.length) { txt += "⚠️ STALE DEALS (no activity 7+ days):\n"; stale.forEach(d => { const days=Math.floor((Date.now()-(parseInt(d.lastActivity)||parseInt(d.createdAt)))/864e5); txt += "   🔴 "+d.name+" — "+days+" days idle ("+d.stage+")\n"; }); txt += "\n"; }
  const stages = [["prospecting","Prospecting"],["underwriting","Underwriting"],["loi","LOI Submitted"],["loi_accepted","LOI Accepted"],["psa","Under PSA"]];
  stages.forEach(([id,lb]) => { const deals=active.filter(d=>d.stage===id); if(deals.length){ txt+=lb+" ("+deals.length+"):\n"; deals.forEach(d=>{txt+="   • "+d.name+" — $"+(parseFloat(d.askingPrice)/1e6).toFixed(2)+"M @ "+d.capRate+"% cap\n";}); txt+="\n"; } });
  await createCalendarEvent("TaskFlow: Acquisitions", txt, 16, 0);
}

async function pushAMToCalendar() {
  const amData = await loadFromSheets("am");
  if (!amData || !amData.length) return;
  let txt = "🏠 ASSET MANAGEMENT — EOD Tasks\n\n";
  let hasItems = false;
  amData.forEach(p => {
    const active = (p.tasks||[]).filter(t => !t.completed);
    if (active.length) {
      hasItems = true;
      txt += "🏢 " + p.name + "\n";
      active.forEach(t => { const od=t.dueDate&&new Date(t.dueDate)<new Date(new Date().toDateString()); txt+="   "+(od?"🔴":"⬜")+" "+t.text+(t.dueDate?" (due "+t.dueDate+")":"")+"\n"; });
      txt += "\n";
    }
  });
  if (hasItems) await createCalendarEvent("TaskFlow: Asset Management", txt, 19, 0);
}

async function pushMorningSummary() {
  const [acqData, ddData, amData] = await Promise.all([loadFromSheets("acquisitions"), loadFromSheets("dd"), loadFromSheets("am")]);
  const activeDeals = (acqData||[]).filter(d => d.stage!=="dead"&&d.stage!=="closed");
  let totalDD=0, completedDD=0;
  (ddData||[]).forEach(dd => { (dd.tasks||[]).forEach(t => { totalDD++; if(t.completed)completedDD++; }); });
  let amTasks=0, amOverdue=0;
  (amData||[]).forEach(p => { (p.tasks||[]).filter(t=>!t.completed).forEach(t => { amTasks++; if(t.dueDate&&new Date(t.dueDate)<new Date(new Date().toDateString()))amOverdue++; }); });
  chrome.notifications.create("morning-summary", {
    type: "basic", iconUrl: "icons/icon128.png", title: "TaskFlow — Good Morning",
    message: activeDeals.length+" deals | "+(totalDD-completedDD)+" DD tasks | "+amTasks+" AM tasks"+(amOverdue>0?" ("+amOverdue+" overdue)":""),
    priority: 2
  });
}

// ---- ALARMS ----
function setupAlarms() {
  chrome.alarms.clearAll();
  // Single daily push at 10am EST — sends DD + Acquisitions + AM all at once
  chrome.alarms.create("daily-calendar-push", { when: nextAlarm(10,0), periodInMinutes: 1440 });
  chrome.alarms.create("morning-summary", { when: nextAlarm(8,0), periodInMinutes: 1440 });
  chrome.alarms.create("stale-deal-check", { periodInMinutes: 360 });
}

function nextAlarm(hour, minute) {
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const diff = now.getTime() - est.getTime();
  const target = new Date(est.getFullYear(), est.getMonth(), est.getDate(), hour, minute, 0);
  if (target <= est) target.setDate(target.getDate() + 1);
  return target.getTime() + diff;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log("Alarm:", alarm.name);
  try {
    if (alarm.name === "morning-summary") await pushMorningSummary();
    else if (alarm.name === "daily-calendar-push") {
      await pushDDToCalendar();
      await pushAcqToCalendar();
      await pushAMToCalendar();
    }
    else if (alarm.name === "stale-deal-check") await checkStaleDeals();
    // LOI follow-up alarms
    else if (alarm.name.startsWith("loi-followup-")) {
      const parts = alarm.name.split("-");
      const dealId = parts.slice(2, -1).join("-");
      const days = parts[parts.length - 1];
      await pushLOIFollowUp(dealId, days);
    }
  } catch (err) { console.error("Alarm error:", err); }
});

async function checkStaleDeals() {
  const acqData = await loadFromSheets("acquisitions");
  if (!acqData) return;
  const stale = acqData.filter(d => d.stage!=="dead"&&d.stage!=="closed").filter(d => { const la=parseInt(d.lastActivity)||parseInt(d.createdAt)||0; return(Date.now()-la)>7*864e5; });
  if (stale.length) {
    chrome.notifications.create("stale-deals", { type:"basic", iconUrl:"icons/icon128.png", title:"TaskFlow — Stale Deals", message:stale.length+" deal"+(stale.length>1?"s":"")+" with no activity in 7+ days.", priority:1 });
  }
}

// ---- LOI FOLLOW-UP ----
function scheduleLOIFollowUps(dealId, dealName) {
  const now = Date.now();
  // 3-day follow-up
  chrome.alarms.create("loi-followup-" + dealId + "-3", { when: now + 3 * 24 * 60 * 60 * 1000 });
  // 7-day follow-up
  chrome.alarms.create("loi-followup-" + dealId + "-7", { when: now + 7 * 24 * 60 * 60 * 1000 });
  console.log("LOI follow-ups scheduled for:", dealName);
}

async function pushLOIFollowUp(dealId, days) {
  const acqData = await loadFromSheets("acquisitions");
  const deal = acqData ? acqData.find(d => d.id === dealId) : null;
  const dealName = deal ? deal.name : "Unknown Deal";
  chrome.notifications.create("loi-followup-" + dealId + "-" + days, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "TaskFlow — LOI Follow Up (" + days + " days)",
    message: "Follow up on LOI for " + dealName + ". It's been " + days + " days since submission.",
    priority: 2
  });
}

// ---- DAILY PUSH ON STARTUP (catch missed pushes) ----
async function checkDailyPushOnStartup() {
  const lastPush = await new Promise(r => chrome.storage.local.get("lastDailyPush", res => r(res.lastDailyPush || 0)));
  const today = new Date().toDateString();
  const lastDate = lastPush ? new Date(lastPush).toDateString() : "";
  if (today !== lastDate) {
    const now = new Date();
    const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    if (est.getHours() >= 10) {
      console.log("Missed daily push — sending now");
      await pushDDToCalendar();
      await pushAcqToCalendar();
      await pushAMToCalendar();
      await new Promise(r => chrome.storage.local.set({ lastDailyPush: Date.now() }, r));
    }
  }
}

// ============================================================
// IMPORT STORAGE — CoStar + Crexi
// ============================================================

async function storePendingImport(key, data) {
  return new Promise(r => chrome.storage.local.set({ [key]: data }, r));
}
async function getPendingImport(key) {
  return new Promise(r => chrome.storage.local.get(key, result => r(result[key] || null)));
}
async function clearPendingImport(key) {
  return new Promise(r => chrome.storage.local.remove(key, r));
}

// ============================================================
// LOI GENERATION — Google Docs + Drive
// ============================================================

const LOI_TEMPLATE_ID = "10OJeSQOkhdiXcJIBgafNwBo2cly6r0kJVgp-UKTvfzQ";
const LOI_FOLDER_ID = "1Ufua50u8Bpgr0K9aaVEBLuoZjBudLaPe";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DOCS_BASE = "https://docs.googleapis.com/v1/documents";

async function generateLOI(payload) {
  const { dealName, address, offerDate, loiPrice, loiPriceText, deposit } = payload;

  // Step 1: Copy the template into the target folder
  const docName = "LOI - " + (dealName || "Deal") + " - " + (offerDate || new Date().toLocaleDateString("en-US"));
  const copyResp = await fetchWithAuth(DRIVE_BASE + "/files/" + LOI_TEMPLATE_ID + "/copy", {
    method: "POST",
    body: JSON.stringify({
      name: docName,
      parents: [LOI_FOLDER_ID]
    })
  });
  const copyData = await copyResp.json();
  if (!copyData.id) {
    throw new Error("Failed to copy template: " + JSON.stringify(copyData));
  }
  const newDocId = copyData.id;

  // Step 2: Format values
  const formattedPrice = formatMoney(loiPrice);
  const formattedDeposit = formatMoney(deposit);

  // Step 3: Replace all placeholders
  const replaceRequests = [
    { replaceAllText: { containsText: { text: "{{Offer Date}}", matchCase: true }, replaceText: offerDate || "" } },
    { replaceAllText: { containsText: { text: "{{property address}}", matchCase: true }, replaceText: address || "" } },
    { replaceAllText: { containsText: { text: "{{Purchase price number}}", matchCase: true }, replaceText: formattedPrice } },
    { replaceAllText: { containsText: { text: "{{Purchase price text}}", matchCase: true }, replaceText: loiPriceText || "" } },
    { replaceAllText: { containsText: { text: "{{ deposit}}", matchCase: true }, replaceText: formattedDeposit } },
  ];

  const batchResp = await fetchWithAuth(DOCS_BASE + "/" + newDocId + ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: replaceRequests })
  });
  const batchData = await batchResp.json();
  if (batchData.error) {
    throw new Error("Failed to replace placeholders: " + JSON.stringify(batchData.error));
  }

  // Return the new doc URL
  const docUrl = "https://docs.google.com/document/d/" + newDocId + "/edit";
  return { success: true, docUrl, docId: newDocId };
}

function formatMoney(n) {
  n = parseFloat(n);
  if (!n && n !== 0) return "$0";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

async function handleMessage(msg) {
  switch (msg.type) {
    case "AUTH_LOGIN": {
      const token = await getAuthToken(true);
      return { success: true, token };
    }
    case "AUTH_CHECK": {
      try { const token = await getAuthToken(false); return { success: true, token }; }
      catch (e) { return { success: false }; }
    }
    case "INIT_SPREADSHEET": {
      let ssId = await getSpreadsheetId();
      if (!ssId) ssId = await createSpreadsheet();
      return { success: true, spreadsheetId: ssId };
    }
    case "SET_SPREADSHEET_ID": {
      await setSpreadsheetId(msg.spreadsheetId);
      return { success: true };
    }
    case "SYNC_TO_SHEETS": {
      await syncToSheets(msg.section, msg.data);
      return { success: true };
    }
    case "LOAD_FROM_SHEETS": {
      const data = await loadFromSheets(msg.section);
      return { success: true, data };
    }
    case "LOAD_ALL": {
      const [acq, dd, am] = await Promise.all([loadFromSheets("acquisitions"), loadFromSheets("dd"), loadFromSheets("am")]);
      return { success: true, acquisitions: acq, dd, am };
    }
    case "PUSH_CALENDAR_NOW": {
      if (msg.section === "dd") await pushDDToCalendar();
      else if (msg.section === "acquisitions") await pushAcqToCalendar();
      else if (msg.section === "am") await pushAMToCalendar();
      else { await pushDDToCalendar(); await pushAcqToCalendar(); await pushAMToCalendar(); }
      await new Promise(r => chrome.storage.local.set({ lastDailyPush: Date.now() }, r));
      return { success: true };
    }
    case "SETUP_ALARMS": {
      setupAlarms();
      return { success: true };
    }
    case "SCHEDULE_LOI_FOLLOWUP": {
      scheduleLOIFollowUps(msg.dealId, msg.dealName);
      return { success: true };
    }

    // ---- CoStar Import ----
    case "COSTAR_IMPORT": {
      await storePendingImport("pendingCostarImport", { extracted: msg.extracted, uw: msg.uw, timestamp: Date.now() });
      return { success: true };
    }
    case "CHECK_COSTAR_IMPORT": {
      const pending = await getPendingImport("pendingCostarImport");
      return { success: true, data: pending };
    }
    case "CLEAR_COSTAR_IMPORT": {
      await clearPendingImport("pendingCostarImport");
      return { success: true };
    }

    // ---- Crexi Import ----
    case "CREXI_IMPORT": {
      await storePendingImport("pendingCrexiImport", { extracted: msg.extracted, timestamp: Date.now() });
      return { success: true };
    }
    case "CHECK_CREXI_IMPORT": {
      const pending = await getPendingImport("pendingCrexiImport");
      return { success: true, data: pending };
    }
    case "CLEAR_CREXI_IMPORT": {
      await clearPendingImport("pendingCrexiImport");
      return { success: true };
    }

    // ---- LOI Generation ----
    case "GENERATE_LOI": {
      const result = await generateLOI(msg.payload);
      return result;
    }

    default:
      return { success: false, error: "Unknown message type" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(response => sendResponse(response))
    .catch(err => { console.error("Handler error:", err); sendResponse({ success: false, error: err.message }); });
  return true;
});

// ---- INSTALL / STARTUP ----
chrome.runtime.onInstalled.addListener(() => {
  console.log("TaskFlow v4.1 installed — demographics, traffic, LOI follow-ups, 10am daily push");
  setupAlarms();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  checkDailyPushOnStartup().catch(err => console.error("Startup push check failed:", err));
});