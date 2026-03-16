// ============================================================
// CREFlow Background Service Worker v4.0
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
    properties: { title: "CREFlow Data" },
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

const ACQ_H = ["id","name","address","propertyType","stage","priority","askingPrice","noi","capRate","sqft","acreage","numTenants","walt","broker","brokerContact","brokerPhone","brokerEmail","notes","listingLink","uwLink","costarLink","loiLink","omLink","folderLink","vehiclesPerDay","pop3mi","ahi3mi","score","uwRentPsf","uwVacancy","uwExpenseRatio","uwTargetCap","createdAt","lastActivity","hotList","listingDate","loiSentDate","brokerReached","callLog","uwGeneratedDate","loiGeneratedDate","stageChangedDate","sfLoiLink","listingStatus","loiResponseStatus","loiCounteredDate","stageHistory"];
const DD_H = ["id","dealId","dealName","address","closingDate","stage","folderLink","uwLink","tasks","tenants"];
const AM_H = ["id","name","address","propertyType","tenant","noi","leaseExpiry","tasks"];

async function syncToSheets(section, data) {
  if (section === "acquisitions") { await writeSheet("Acquisitions", ACQ_H, data); }
  else if (section === "dd") { await writeSheet("DueDiligence", DD_H, data.map(d => ({ ...d, tasks: JSON.stringify(d.tasks || []), tenants: JSON.stringify(d.tenants || []) }))); }
  else if (section === "am") { await writeSheet("AssetManagement", AM_H, data.map(p => ({ ...p, tasks: JSON.stringify(p.tasks || []) }))); }
}

async function loadFromSheets(section) {
  if (section === "acquisitions") {
    const rows = await readSheet("Acquisitions");
    if (!rows) return null;
    return rows.map(r => { let sh=[]; try{sh=r.stageHistory?JSON.parse(r.stageHistory):[];}catch(e){sh=[];} return { ...r, askingPrice:parseFloat(r.askingPrice)||0, noi:parseFloat(r.noi)||0, capRate:parseFloat(r.capRate)||0, sqft:parseFloat(r.sqft)||0, createdAt:parseInt(r.createdAt)||Date.now(), lastActivity:parseInt(r.lastActivity)||Date.now(), hotList:r.hotList==="true"||r.hotList===true, brokerReached:r.brokerReached==="true"||r.brokerReached===true, callLog:r.callLog?JSON.parse(r.callLog):[], uwGeneratedDate:parseInt(r.uwGeneratedDate)||0, loiGeneratedDate:parseInt(r.loiGeneratedDate)||0, stageChangedDate:parseInt(r.stageChangedDate)||0, sfLoiLink:r.sfLoiLink||"", listingStatus:r.listingStatus||"active", loiResponseStatus:r.loiResponseStatus||"", loiCounteredDate:parseInt(r.loiCounteredDate)||0, stageHistory:sh }; });
  } else if (section === "dd") {
    const rows = await readSheet("DueDiligence");
    if (!rows) return null;
    return rows.map(r => {
      let tasks = []; let tenants = [];
      try { tasks = r.tasks ? JSON.parse(r.tasks) : []; } catch(e) { tasks = []; }
      try { tenants = r.tenants ? JSON.parse(r.tenants) : []; } catch(e) { tenants = []; }
      return { ...r, tasks, tenants };
    });
  } else if (section === "am") {
    const rows = await readSheet("AssetManagement");
    if (!rows) return null;
    return rows.map(r => ({ ...r, noi:parseFloat(r.noi)||0, tasks: r.tasks ? JSON.parse(r.tasks) : [] }));
  }
  return null;
}

// ---- GOOGLE CALENDAR ----
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

async function createCalendarEvent(summary, description, startHour, startMinute, durationMinutes = 30) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, startMinute, 0);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
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
  if (hasItems) await createCalendarEvent("CREFlow: Due Diligence", txt, 11, 0);
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
  await createCalendarEvent("CREFlow: Acquisitions", txt, 16, 0);
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
  if (hasItems) await createCalendarEvent("CREFlow: Asset Management", txt, 19, 0);
}

async function pushMorningSummary() {
  const [acqData, ddData, amData] = await Promise.all([loadFromSheets("acquisitions"), loadFromSheets("dd"), loadFromSheets("am")]);
  const activeDeals = (acqData||[]).filter(d => d.stage!=="dead"&&d.stage!=="closed");
  let totalDD=0, completedDD=0;
  (ddData||[]).forEach(dd => { (dd.tasks||[]).forEach(t => { totalDD++; if(t.completed)completedDD++; }); });
  let amTasks=0, amOverdue=0;
  (amData||[]).forEach(p => { (p.tasks||[]).filter(t=>!t.completed).forEach(t => { amTasks++; if(t.dueDate&&new Date(t.dueDate)<new Date(new Date().toDateString()))amOverdue++; }); });
  chrome.notifications.create("morning-summary", {
    type: "basic", iconUrl: "icons/icon128.png", title: "CREFlow — Good Morning",
    message: activeDeals.length+" deals | "+(totalDD-completedDD)+" DD tasks | "+amTasks+" AM tasks"+(amOverdue>0?" ("+amOverdue+" overdue)":""),
    priority: 2
  });
}

// ---- DEAL HEALTH FLAGS ----
function calculateDealFlags(deals) {
  const now = Date.now();
  const DAY = 864e5;
  const PRE_LOI = ["prospecting", "underwriting"];
  const flags = [];

  deals.forEach(d => {
    if (d.stage === "dead" || d.stage === "loi_accepted") return;

    const age = (now - (d.createdAt || now)) / DAY;
    const callCount = (d.callLog || []).length;
    const lastCall = callCount ? Math.max(...d.callLog.map(c => c.time || 0)) : 0;
    const daysSinceLastCall = lastCall ? (now - lastCall) / DAY : age;
    const stageAge = d.stageChangedDate ? (now - d.stageChangedDate) / DAY : age;
    const uwAge = d.uwGeneratedDate ? (now - d.uwGeneratedDate) / DAY : 0;
    const loiAge = d.loiGeneratedDate ? (now - d.loiGeneratedDate) / DAY : 0;
    const loiSentAge = d.loiSentDate ? (now - new Date(d.loiSentDate + "T00:00:00").getTime()) / DAY : 0;

    // Flag 1: No broker call within 2 days
    if (age > 2 && callCount === 0) flags.push({ deal: d, msg: `📞 Call Broker — ${d.name} (no call ${Math.floor(age)}d)` });

    // Flag 2: Broker not reached after 5 days
    if (!d.brokerReached && age > 5 && callCount > 0 && callCount < 3) flags.push({ deal: d, msg: `📞 Follow up — ${d.name} (not reached ${Math.floor(age)}d)` });

    // Flag 3: Stale prospecting
    if (d.stage === "prospecting" && stageAge > 4) flags.push({ deal: d, msg: `📋 Review — ${d.name} (prospecting ${Math.floor(stageAge)}d)` });

    // Flag 4: No UW in underwriting
    if (d.stage === "underwriting" && !d.uwLink && stageAge > 2) flags.push({ deal: d, msg: `📊 Generate UW — ${d.name} (underwriting ${Math.floor(stageAge)}d)` });

    // Flag 5: UW done no LOI
    if (d.uwLink && !d.loiLink && uwAge > 2) flags.push({ deal: d, msg: `📝 Generate LOI — ${d.name} (UW done ${Math.floor(uwAge)}d)` });

    // Flag 6: LOI not sent
    if (d.loiLink && d.stage !== "loi" && d.stage !== "loi_accepted" && loiAge > 1) flags.push({ deal: d, msg: `📤 Update stage — ${d.name} (LOI ready ${Math.floor(loiAge)}d)` });

    // Flag 7: LOI no response
    if (d.stage === "loi" && loiSentAge > 3) flags.push({ deal: d, msg: `📞 LOI follow up — ${d.name} (sent ${Math.floor(loiSentAge)}d ago)` });

    // Flag 8: Score decayed below 5
    if (PRE_LOI.includes(d.stage)) {
      const raw = parseFloat(d.score);
      if (raw) {
        const weeks = Math.floor((now - (parseInt(d.createdAt) || now)) / (7 * DAY));
        const decayedScore = Math.max(0, raw - weeks * 0.5);
        if (decayedScore < 5) flags.push({ deal: d, msg: `⚠️ Low score — ${d.name} (score ${Math.round(decayedScore * 10) / 10})` });
      }
    }

    // Flag 9: Can't reach broker
    if (callCount >= 3 && !d.brokerReached && daysSinceLastCall > 5) flags.push({ deal: d, msg: `🔄 Try new contact — ${d.name} (${callCount} calls, no reach)` });
  });

  return flags;
}

async function pushFlaggedDealsToCalendar(flags) {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return; // Skip weekends

  // Custom schedule: Mon/Wed/Thu 12-20, Tue 12-20, Fri 12-17
  let windowStart = 12, windowEnd = 20;
  if (day === 5) windowEnd = 17; // Friday

  // Group flags by deal
  const grouped = {};
  flags.forEach(f => {
    const dId = f.deal.id;
    if (!grouped[dId]) grouped[dId] = { deal: f.deal, msgs: [] };
    grouped[dId].msgs.push(f.msg);
  });
  const dealFlags = Object.values(grouped);

  // Get free slots using freebusy API
  let busySlots = [];
  try {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), windowStart, 0, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), windowEnd, 0, 0);
    const fbResp = await fetchWithAuth("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: "America/New_York",
        items: [{ id: "primary" }]
      })
    });
    const fbData = await fbResp.json();
    if (fbData.calendars && fbData.calendars.primary) {
      busySlots = fbData.calendars.primary.busy || [];
    }
  } catch (e) { console.error("FreeBusy check failed:", e); }

  // Build list of free 15-min slots with 1hr buffer after busy events
  const slots = [];
  const now = new Date();
  for (let h = windowStart; h < windowEnd; h++) {
    for (let m = 0; m < 60; m += 15) {
      const slotStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
      const slotEnd = new Date(slotStart.getTime() + 15 * 60000);
      // Check if slot conflicts with any busy period + 1hr buffer
      let isFree = true;
      for (const busy of busySlots) {
        const busyStart = new Date(busy.start);
        const busyEndPlusBuffer = new Date(new Date(busy.end).getTime() + 60 * 60000); // 1hr buffer
        if (slotStart < busyEndPlusBuffer && slotEnd > busyStart) { isFree = false; break; }
      }
      if (isFree) slots.push({ hour: h, min: m });
    }
  }

  // Push grouped deal events into free slots
  const maxEvents = Math.min(dealFlags.length, slots.length);
  for (let i = 0; i < maxEvents; i++) {
    const df = dealFlags[i];
    const slot = slots[i];
    const title = df.deal.name + " | " + df.msgs.join(" · ");
    const desc = [df.deal.brokerContact||df.deal.broker||"", df.deal.brokerPhone||"", df.deal.listingLink||""].filter(Boolean).join("\n");
    try {
      await createCalendarEvent(title, desc || "Deal health flag", slot.hour, slot.min, 15);
    } catch (err) { console.error("Flag calendar event failed:", err); }
  }
  console.log(`Pushed ${maxEvents} grouped deal events to calendar (${slots.length} free slots available)`);
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
      const day = new Date().getDay();
      if (day === 0 || day === 6) return; // Skip weekends
      // Only push flagged deals as individual events — no more summary blocks
      const acqData = await loadFromSheets("acquisitions");
      if (acqData && acqData.length) {
        const flags = calculateDealFlags(acqData);
        if (flags.length) await pushFlaggedDealsToCalendar(flags);
      }
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
    chrome.notifications.create("stale-deals", { type:"basic", iconUrl:"icons/icon128.png", title:"CREFlow — Stale Deals", message:stale.length+" deal"+(stale.length>1?"s":"")+" with no activity in 7+ days.", priority:1 });
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
    title: "CREFlow — LOI Follow Up (" + days + " days)",
    message: "Follow up on LOI for " + dealName + ". It's been " + days + " days since submission.",
    priority: 2
  });
}

// ---- DAILY PUSH ON STARTUP (catch missed pushes) ----
async function checkDailyPushOnStartup() {
  const startupDay = new Date().getDay();
  if (startupDay === 0 || startupDay === 6) return; // Skip weekends
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
const SF_LOI_TEMPLATE_ID = "1TaEzmmI3Cd5KdyhspQlmkpoqBdaNDpgvzxZfPYHYt6E";
const LOI_FOLDER_ID = "1Ufua50u8Bpgr0K9aaVEBLuoZjBudLaPe";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DOCS_BASE = "https://docs.googleapis.com/v1/documents";

async function generateLOI(payload) {
  const { dealName, address, offerDate, loiPrice, loiPriceText, deposit, templateType,
    interestRate, downPaymentPct } = payload;

  const isSF = templateType === "seller_finance";
  const templateId = isSF ? SF_LOI_TEMPLATE_ID : LOI_TEMPLATE_ID;

  // Step 1: Copy the template into the target folder
  const typeLabel = isSF ? "SF LOI" : "LOI";
  const docName = typeLabel + " - " + (dealName || "Deal") + " - " + (offerDate || new Date().toLocaleDateString("en-US"));
  const copyResp = await fetchWithAuth(DRIVE_BASE + "/files/" + templateId + "/copy", {
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

  // SF-specific placeholders
  if (isSF) {
    const rate = parseFloat(interestRate) || 0;
    const downPct = parseFloat(downPaymentPct) || 5;
    const purchasePrice = parseFloat(loiPrice) || 0;
    const downPayment = purchasePrice * (downPct / 100);
    const loanAmount = purchasePrice - downPayment;
    const monthlyPayment = loanAmount * (rate / 100 / 12);
    const annualPayment = monthlyPayment * 12;
    const balloonPayment = loanAmount;
    const totalInterest = monthlyPayment * 60; // 5 years
    const totalProceeds = purchasePrice + totalInterest;

    replaceRequests.push(
      { replaceAllText: { containsText: { text: "{{Total proceeds number}}", matchCase: true }, replaceText: formatMoney(totalProceeds) } },
      { replaceAllText: { containsText: { text: "{{Total proceeds text}}", matchCase: true }, replaceText: loiPriceText ? "approximately " + loiPriceText : "" } },
      { replaceAllText: { containsText: { text: "{{Interest Rate}}", matchCase: true }, replaceText: rate + "%" } },
      { replaceAllText: { containsText: { text: "{{Down Payment}}", matchCase: true }, replaceText: formatMoney(downPayment) } },
      { replaceAllText: { containsText: { text: "{{Down payment percent}}", matchCase: true }, replaceText: downPct + "%" } },
      { replaceAllText: { containsText: { text: "{{Monthly Payment}}", matchCase: true }, replaceText: formatMoney(monthlyPayment) } },
      { replaceAllText: { containsText: { text: "{{Annual Payment}}", matchCase: true }, replaceText: formatMoney(annualPayment) } },
      { replaceAllText: { containsText: { text: "{{Balloon Payment}}", matchCase: true }, replaceText: formatMoney(balloonPayment) } },
      { replaceAllText: { containsText: { text: "{{loan amount}}", matchCase: true }, replaceText: formatMoney(loanAmount) } }
    );
  }

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
      // Only push flagged deal events — no more summary blocks
      const acqData = await loadFromSheets("acquisitions");
      if (acqData && acqData.length) {
        const flags = calculateDealFlags(acqData);
        if (flags.length) await pushFlaggedDealsToCalendar(flags);
      }
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

    case "CHECK_IF_IMPORTED": {
      // Check if a URL has already been imported as a deal
      const url = msg.url || "";
      if (!url) return { success: true, imported: false };
      try {
        const acqData = await loadFromSheets("acquisitions");
        if (acqData && acqData.length) {
          const found = acqData.some(d => {
            const links = [d.listingLink||"", d.costarLink||"", d.uwLink||""].map(l => l.toLowerCase().trim());
            const checkUrl = url.toLowerCase().trim();
            return links.some(l => l && (l.includes(checkUrl) || checkUrl.includes(l)));
          });
          return { success: true, imported: found };
        }
      } catch(e) { console.error("Check imported error:", e); }
      return { success: true, imported: false };
    }

    case "CREATE_DD_FOLDER": {
      try {
        const deal = msg.deal;
        let folderId = deal.existingFolderId || "";
        let folderLink = "";
        
        // Use existing folder or create new one
        if (folderId) {
          folderLink = "https://drive.google.com/drive/folders/" + folderId;
        } else {
          const folderResp = await fetchWithAuth("https://www.googleapis.com/drive/v3/files", {
            method: "POST",
            body: JSON.stringify({ name: "DD - " + (deal.name || "Untitled"), mimeType: "application/vnd.google-apps.folder" })
          });
          const folder = await folderResp.json();
          folderId = folder.id;
          folderLink = "https://drive.google.com/drive/folders/" + folderId;
        }

        // Build deal data doc content
        let docBody = "DEAL DATA — " + (deal.name || "") + "\n\n";
        docBody += "Address: " + (deal.address || "") + "\n";
        docBody += "Asking Price: $" + (deal.askingPrice || "") + "\n";
        docBody += "NOI: $" + (deal.noi || "") + "\n";
        docBody += "Cap Rate: " + (deal.capRate || "") + "%\n";
        docBody += "Building SF: " + (deal.sqft || "") + "\n";
        docBody += "Acreage: " + (deal.acreage || "") + "\n";
        docBody += "# Tenants: " + (deal.numTenants || "") + "\n";
        docBody += "WALT: " + (deal.walt || "") + " years\n";
        docBody += "Score: " + (deal.score || "") + "/10\n\n";
        docBody += "--- DEMOGRAPHICS ---\n";
        docBody += "3mi Population: " + (deal.pop3mi || "") + "\n";
        docBody += "3mi AHI: $" + (deal.ahi3mi || "") + "\n";
        docBody += "Vehicles/Day: " + (deal.vehiclesPerDay || "") + "\n\n";
        docBody += "--- BROKER ---\n";
        docBody += "Broker: " + (deal.broker || "") + "\n";
        docBody += "Contact: " + (deal.brokerContact || "") + "\n";
        docBody += "Phone: " + (deal.brokerPhone || "") + "\n";
        docBody += "Email: " + (deal.brokerEmail || "") + "\n\n";
        docBody += "--- LINKS ---\n";
        docBody += "Listing: " + (deal.listingLink || "") + "\n";
        docBody += "UW: " + (deal.uwLink || "") + "\n";
        docBody += "CoStar: " + (deal.costarLink || "") + "\n";
        docBody += "OM: " + (deal.omLink || "") + "\n";
        docBody += "LOI: " + (deal.loiLink || "") + "\n";
        docBody += "LOI Sent: " + (deal.loiSentDate || "") + "\n";
        docBody += "Listing Date: " + (deal.listingDate || "") + "\n\n";
        docBody += "--- NOTES ---\n";
        docBody += (deal.notes || "");

        // Create Google Doc in the folder
        const docResp = await fetchWithAuth("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          body: JSON.stringify({ name: "Deal Data - " + (deal.name || ""), mimeType: "application/vnd.google-apps.document", parents: [folderId] })
        });
        const doc = await docResp.json();

        // Write content to the doc
        await fetchWithAuth("https://docs.googleapis.com/v1/documents/" + doc.id + ":batchUpdate", {
          method: "POST",
          body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: docBody } }] })
        });

        return { success: true, folderLink, folderId };
      } catch(e) {
        console.error("Create DD folder error:", e);
        return { success: false, error: e.message };
      }
    }

    // ---- LOI Generation ----
    // ---- Sync Tenants from UW ----
    case "SYNC_FROM_UW": {
      try {
        const uwLink = msg.uwLink;
        const folderId = msg.folderId;
        if (!uwLink) return { success: false, error: "No UW link provided" };
        
        // Extract sheet ID from URL
        const sheetMatch = uwLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!sheetMatch) return { success: false, error: "Invalid UW link" };
        const uwSheetId = sheetMatch[1];
        
        // Read rent roll data — headers in row 13, tenants start at row 14
        const rrResp = await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${uwSheetId}/values/'Rent Roll'!A13:P50`);
        const rrData = await rrResp.json();
        if (!rrData.values || rrData.values.length < 2) return { success: false, error: "No rent roll data found" };
        
        const rows = rrData.values;
        const tenants = [];
        
        // Skip header row (index 0), read until we hit "Total" row
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const tenantName = (row[1] || "").trim();
          if (!tenantName || tenantName === "Total" || tenantName === "Vacant " || tenantName === "Occupied") break;
          
          const leaseType = (row[0] || "").trim().toLowerCase();
          const suite = (row[2] || "").trim();
          const gla = parseFloat(row[3]) || 0;
          const leaseStart = (row[5] || "").toString().split("T")[0].split(" ")[0];
          const leaseEnd = (row[6] || "").toString().split("T")[0].split(" ")[0];
          const annualRent = parseFloat(row[7]) || 0;
          const rentPerSf = parseFloat(row[9]) || 0;
          const annualRecovery = parseFloat(row[10]) || 0;
          const recoveryPerSf = parseFloat(row[12]) || 0;
          const totalRevenue = parseFloat(row[13]) || 0;
          const isVacant = leaseType === "vacant" || tenantName.toLowerCase() === "vacant";
          
          const tenant = {
            id: Math.random().toString(36).slice(2,10),
            name: tenantName,
            suite: suite,
            sqft: gla,
            leaseType: isVacant ? "vacant" : (leaseType.includes("nnn") ? "nnn" : leaseType.includes("gross") ? "gross" : leaseType),
            leaseStart: leaseStart,
            leaseEnd: leaseEnd === "MTM" ? "MTM" : leaseEnd,
            rentPerSf: rentPerSf,
            annualRent: annualRent,
            annualRecovery: annualRecovery,
            recoveryPerSf: recoveryPerSf,
            totalRevenue: totalRevenue,
            isVacant: isVacant,
            creditType: "",
            contactName: "",
            contactTitle: "",
            contactPhone: "",
            contactEmail: "",
            notes: "",
            documents: [],
            subfolderLink: "",
            escalations: []
          };
          
          // Create subfolder in Drive if we have a folder ID
          if (folderId && !isVacant) {
            try {
              const folderName = tenantName + (suite ? " - Suite " + suite : "");
              const subResp = await fetchWithAuth("https://www.googleapis.com/drive/v3/files", {
                method: "POST",
                body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [folderId] })
              });
              const subFolder = await subResp.json();
              if (subFolder.id) {
                tenant.subfolderLink = "https://drive.google.com/drive/folders/" + subFolder.id;
              }
            } catch(e) { console.error("Subfolder creation failed for " + tenantName, e); }
          }
          
          tenants.push(tenant);
        }
        
        return { success: true, tenants };
      } catch(e) {
        console.error("Sync from UW error:", e);
        return { success: false, error: e.message };
      }
    }

    // ---- Lender UW Copy ----
    case "GENERATE_LENDER_UW": {
      try {
        const uwLink = msg.uwLink;
        const folderId = msg.folderId;
        const dealName = msg.dealName || "Untitled";
        if (!uwLink || !folderId) return { success: false, error: "Missing uwLink or folderId" };
        const sheetMatch = uwLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!sheetMatch) return { success: false, error: "Invalid UW link" };
        const uwSheetId = sheetMatch[1];
        // Copy the UW sheet into the deal folder
        const copyResp = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${uwSheetId}/copy`, {
          method: "POST",
          body: JSON.stringify({ name: "L - " + dealName, parents: [folderId] })
        });
        const copy = await copyResp.json();
        if (!copy.id) return { success: false, error: "Copy failed" };
        // Get sheet tabs to find IDs of tabs to delete
        const sheetsResp = await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${copy.id}?fields=sheets.properties`);
        const sheetsData = await sheetsResp.json();
        const tabsToDelete = ["Call to Broker", "How to counter offer", "Amortization table"];
        const deleteRequests = [];
        (sheetsData.sheets || []).forEach(s => {
          if (tabsToDelete.includes(s.properties.title)) {
            deleteRequests.push({ deleteSheet: { sheetId: s.properties.sheetId } });
          }
        });
        if (deleteRequests.length) {
          await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${copy.id}:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({ requests: deleteRequests })
          });
        }
        return { success: true, lenderUwLink: "https://docs.google.com/spreadsheets/d/" + copy.id };
      } catch(e) {
        console.error("Lender UW generation error:", e);
        return { success: false, error: e.message };
      }
    }

    case "GENERATE_LOI": {
      const result = await generateLOI(msg.payload);
      return result;
    }

    case "GENERATE_SF_LOI": {
      const result = await generateLOI({ ...msg.payload, templateType: "seller_finance" });
      return result;
    }

    // ---- UW Generation ----
    case "GENERATE_UW": {
      try {
        const deal = msg.deal;
        const TEMPLATE_ID = "1MMadWqO_hDosvbdnJ0mzB4dkcTwdMGhoThtrXrAZ_QU";
        const UW_FOLDER_ID = "1gwuIiE8idszoCF-MqeKttLr7807BA95d";
        const numTenants = parseInt(deal.numTenants) || 1;

        // 1. Create deal folder inside the main UW folder
        const folderResp = await fetchWithAuth("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          body: JSON.stringify({
            name: deal.name || deal.address || "Untitled",
            mimeType: "application/vnd.google-apps.folder",
            parents: [UW_FOLDER_ID]
          })
        });
        const folder = await folderResp.json();
        const dealFolderId = folder.id;
        const folderLink = "https://drive.google.com/drive/folders/" + dealFolderId;

        // 2. Copy the UW template into the deal folder
        const copyResp = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${TEMPLATE_ID}/copy`, {
          method: "POST",
          body: JSON.stringify({
            name: "UW - " + (deal.name || deal.address || "Untitled"),
            parents: [dealFolderId]
          })
        });
        const copyData = await copyResp.json();
        if (!copyData.id) return { success: false, error: "Failed to copy template: " + JSON.stringify(copyData) };
        const newSheetId = copyData.id;
        const sheetUrl = "https://docs.google.com/spreadsheets/d/" + newSheetId + "/edit";

        // 2. Get sheet metadata to find sheet GIDs
        const metaResp = await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}?fields=sheets.properties`);
        const metaData = await metaResp.json();
        const sheetsList = metaData.sheets || [];
        const getGid = (name) => {
          const s = sheetsList.find(sh => sh.properties.title.toLowerCase().includes(name.toLowerCase()));
          return s ? s.properties.sheetId : null;
        };

        const rentRollGid = getGid("Rent Roll");
        const recoveriesGid = getGid("Recoveries");

        // 3. Calculate pro forma date (3 years from now)
        const now = new Date();
        const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const currentMonthYear = months[now.getMonth()] + " " + now.getFullYear();
        const proFormaMonthYear = months[now.getMonth()] + " " + (now.getFullYear() + 3);
        const proFormaShort = (now.getMonth()+1) + "/1/" + (now.getFullYear() + 3);

        // 4. Pre-fill deal data via Sheets API
        const price = parseFloat(deal.askingPrice) || 0;
        const sqft = parseFloat(deal.sqft) || 0;
        const noi = parseFloat(deal.noi) || 0;
        const acreage = parseFloat(deal.acreage) || 0;

        const valueUpdates = [
          // Call to Broker
          { range: "'Call to Broker'!C3", values: [[deal.address || ""]] },
          { range: "'Call to Broker'!C4", values: [[price]] },
          { range: "'Call to Broker'!C5", values: [[sqft]] },
          { range: "'Call to Broker'!C7", values: [[acreage]] },
          { range: "'Call to Broker'!C11", values: [[deal.listingLink || ""]] },
          { range: "'Call to Broker'!C12", values: [[deal.costarLink || ""]] },
          // Analysis
          { range: "'Analysis'!C4", values: [[deal.address || ""]] },
          { range: "'Analysis'!F4", values: [[price]] },
          { range: "'Analysis'!F5", values: [[sqft]] },
          { range: "'Analysis'!F8", values: [[noi]] },
          { range: "'Analysis'!C5", values: [[deal.vehiclesPerDay || ""]] },
          { range: "'Analysis'!C6", values: [[deal.pop3mi || ""]] },
          { range: "'Analysis'!C7", values: [[deal.ahi3mi || ""]] },
          // Rent Roll
          { range: "'Rent Roll'!C2", values: [[price]] },
          { range: "'Rent Roll'!C5", values: [[sqft]] },
          // Expenses
          { range: "'Expenses'!C1", values: [[price]] },
          { range: "'Expenses'!C6", values: [[currentMonthYear]] },
          { range: "'Expenses'!F6", values: [[proFormaMonthYear + " Proforma"]] },
        ];

        const fillResp = await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: valueUpdates })
        });
        const fillResult = await fillResp.json();
        console.log("UW fill result:", JSON.stringify(fillResult));

        // 5. Adjust tenant rows — template has 12, we need numTenants
        // Process from bottom to top for deletes, top to bottom for inserts
        // Rent Roll: current rows 14-25 (0-indexed 13-24), pro forma rows 34-45 (0-indexed 33-44)
        // Recoveries: current rows 5-16 (0-indexed 4-15), pro forma rows 22-33 (0-indexed 21-32)
        const TEMPLATE_ROWS = 12;
        const diff = numTenants - TEMPLATE_ROWS;

        if (diff !== 0) {
          const batchRequests = [];

          if (diff < 0) {
            const del = Math.abs(diff);
            // Delete bottom-to-top: Recoveries pro forma, Recoveries current, Rent Roll pro forma, Rent Roll current
            if (recoveriesGid !== null) {
              batchRequests.push({ deleteDimension: { range: { sheetId: recoveriesGid, dimension: "ROWS", startIndex: 33 - del, endIndex: 33 } } });
              batchRequests.push({ deleteDimension: { range: { sheetId: recoveriesGid, dimension: "ROWS", startIndex: 16 - del, endIndex: 16 } } });
            }
            if (rentRollGid !== null) {
              batchRequests.push({ deleteDimension: { range: { sheetId: rentRollGid, dimension: "ROWS", startIndex: 45 - del, endIndex: 45 } } });
              batchRequests.push({ deleteDimension: { range: { sheetId: rentRollGid, dimension: "ROWS", startIndex: 25 - del, endIndex: 25 } } });
            }
          } else {
            const add = diff;
            // Insert top-to-bottom: Rent Roll current, Rent Roll pro forma, Recoveries current, Recoveries pro forma
            if (rentRollGid !== null) {
              batchRequests.push({ insertDimension: { range: { sheetId: rentRollGid, dimension: "ROWS", startIndex: 25, endIndex: 25 + add } } });
              batchRequests.push({ insertDimension: { range: { sheetId: rentRollGid, dimension: "ROWS", startIndex: 45 + add, endIndex: 45 + add + add } } });
            }
            if (recoveriesGid !== null) {
              batchRequests.push({ insertDimension: { range: { sheetId: recoveriesGid, dimension: "ROWS", startIndex: 16, endIndex: 16 + add } } });
              batchRequests.push({ insertDimension: { range: { sheetId: recoveriesGid, dimension: "ROWS", startIndex: 33 + add, endIndex: 33 + add + add } } });
            }
          }

          if (batchRequests.length) {
            const rowResp = await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}:batchUpdate`, {
              method: "POST",
              body: JSON.stringify({ requests: batchRequests })
            });
            const rowResult = await rowResp.json();
            console.log("UW row adjustment result:", JSON.stringify(rowResult));
          }
        }

        // 6. Update Rent Roll pro forma header with dynamic date
        const proFormaHeaderRow = 30 + (diff < 0 ? diff : diff > 0 ? diff : 0);
        await fetchWithAuth(`https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            valueInputOption: "USER_ENTERED",
            data: [{ range: "'Rent Roll'!B" + proFormaHeaderRow, values: [["Proforma " + proFormaShort]] }]
          })
        });

        return { success: true, sheetUrl, sheetId: newSheetId, folderLink, dealFolderId };
      } catch(e) {
        console.error("Generate UW error:", e);
        return { success: false, error: e.message };
      }
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
  console.log("CREFlow v4.1 installed — demographics, traffic, LOI follow-ups, 10am daily push");
  setupAlarms();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  checkDailyPushOnStartup().catch(err => console.error("Startup push check failed:", err));
});