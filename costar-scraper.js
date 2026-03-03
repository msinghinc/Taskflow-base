// ============================================================
// TaskFlow CoStar Scraper v4.1
// Added: Demographics + Traffic extraction
// ============================================================

// ---- HELPERS ----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function text(el) { return el ? (el.textContent || "").trim() : ""; }
function isStreetAddress(s) { return /^\d+\s+\S+/.test(s) && !s.includes(","); }
function isCityStateZip(s) { return /^[A-Za-z .']+,\s*[A-Z]{2}\s*\d{5}(-\d{4})?$/.test(s); }
function getText(selector, root = document) { const el = root.querySelector(selector); return el ? text(el) : ""; }

function getKpi(baseId) {
  const line1 = getText(`[automation-id="${baseId}_line1"]`);
  const line2 = getText(`[automation-id="${baseId}_line2"]`);
  if (line1 && line2) return `${line1} ${line2}`;
  return line1 || "";
}

function parseMoney(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseNumber(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseRentPsf(str) { return parseNumber(str); }

function getCostarPropertyIdFromUrl(urlStr) {
  const url = String(urlStr || window.location.href);
  const m1 = url.match(/\/detail\/all-properties\/(\d+)\//);
  if (m1 && m1[1]) return m1[1];
  const m2 = url.match(/all-properties\/(\d+)/);
  if (m2 && m2[1]) return m2[1];
  return "";
}

// ---- HEADER EXTRACTION ----
function extractHeaderInfo() {
  const header = document.querySelector('[automation-id="property-detail-header"]');
  if (!header) return { propertyName: "", street: "", cityStateZip: "", fullAddress: "" };

  const lines = Array.from(header.querySelectorAll("div, span, a, p"))
    .map(n => text(n))
    .filter(Boolean);

  const street = lines.find(isStreetAddress) || "";
  const cityStateZip = lines.find(isCityStateZip) || "";

  const propertyName = lines.find(s => {
    if (!s) return false;
    if (s === street || s === cityStateZip) return false;
    if (isStreetAddress(s) || isCityStateZip(s)) return false;
    if (s.includes("(") && s.includes(")")) return false;
    return s.length >= 2 && s.length <= 60;
  }) || "";

  const fullAddress = [street, cityStateZip].filter(Boolean).join(", ");
  return { propertyName, street, cityStateZip, fullAddress };
}

// ---- MARKET CONDITIONS RENT ----
function findSubjectPropertyRentFromMarketConditions() {
  const divs = Array.from(document.querySelectorAll("div"));
  const labelEl = divs.find(el => text(el) === "Subject Property");
  if (!labelEl) return "";
  const row = labelEl.closest('[class*="grid__row"]') || labelEl.parentElement;
  if (!row) return "";
  const candidates = Array.from(row.querySelectorAll("div"))
    .map(el => text(el))
    .filter(Boolean);
  const rent = candidates.find(t => /^\$\s*\d+(\.\d+)?\s*\/\s*SF$/i.test(t));
  return rent || "";
}

// ---- DEMOGRAPHICS EXTRACTION ----
function extractDemographics() {
  const result = { population1mi: "", population3mi: "", population10mi: "",
    households3mi: "", medianAge3mi: "", medianHHIncome1mi: "", medianHHIncome3mi: "",
    medianHHIncome10mi: "", daytimeEmployees3mi: "" };

  const demoContainer = document.querySelector('[automation-id="demographics-ic"]');
  if (!demoContainer) return result;

  const rows = demoContainer.querySelectorAll('[class*="demographics_row"]');

  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('[class*="demographics_col-value"] span, [class*="demographics_col-value"] div'));
    const cellTexts = cells.map(c => text(c)).filter(Boolean);
    const allTexts = Array.from(row.querySelectorAll("div, span")).map(el => text(el)).filter(Boolean);
    const labelLower = allTexts[0] ? allTexts[0].toLowerCase() : "";
    const numericValues = cellTexts.filter(t => /[\d,$]/.test(t) && t.length > 0);

    if (labelLower.includes("population") && !labelLower.includes("growth")) {
      if (numericValues.length >= 3) {
        result.population1mi = numericValues[0];
        result.population3mi = numericValues[1];
        result.population10mi = numericValues[2];
      } else if (numericValues.length >= 1) {
        result.population3mi = numericValues[Math.min(1, numericValues.length - 1)];
      }
    }
    if (labelLower.includes("median h") && labelLower.includes("income")) {
      if (numericValues.length >= 3) {
        result.medianHHIncome1mi = numericValues[0];
        result.medianHHIncome3mi = numericValues[1];
        result.medianHHIncome10mi = numericValues[2];
      } else if (numericValues.length >= 1) {
        result.medianHHIncome3mi = numericValues[Math.min(1, numericValues.length - 1)];
      }
    }
    if (labelLower.includes("household") && !labelLower.includes("growth") && !labelLower.includes("income")) {
      if (numericValues.length >= 2) result.households3mi = numericValues[1];
    }
    if (labelLower.includes("median age")) {
      if (numericValues.length >= 2) result.medianAge3mi = numericValues[1];
    }
    if (labelLower.includes("daytime") && labelLower.includes("employee")) {
      if (numericValues.length >= 2) result.daytimeEmployees3mi = numericValues[1];
    }
  });

  return result;
}

// ---- TRAFFIC EXTRACTION ----
function extractTraffic() {
  const result = { highestADT: 0, highestRoad: "", trafficEntries: [] };

  const trafficContainer = document.querySelector('[automation-id="traffic-ic"]');
  if (!trafficContainer) return result;

  const rows = trafficContainer.querySelectorAll('[class*="grid_row"]');

  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('[class*="grid_clip"]'));
    const cellTexts = cells.map(c => text(c));

    if (cellTexts.length >= 3) {
      const road = cellTexts[0] || "";
      for (let i = 1; i < cellTexts.length; i++) {
        const cleaned = cellTexts[i].replace(/,/g, "");
        const num = parseInt(cleaned);
        if (num > 100 && num < 1000000) {
          result.trafficEntries.push({ road, adt: num });
          if (num > result.highestADT) {
            result.highestADT = num;
            result.highestRoad = road;
          }
          break;
        }
      }
    }
  });

  return result;
}

// ---- MAIN EXTRACTION ----
function extractCostarData() {
  const header = extractHeaderInfo();

  const buildingSize = getKpi("buildingSize");
  const landSize = getKpi("landSize");
  const yearBuilt = getKpi("yearBuilt");
  const availableArea = getKpi("availableArea");
  const primaryRent = getKpi("primaryRent");
  const salePrice = getKpi("salePrice");
  const pricePerArea = getKpi("pricePerArea");
  const subjectRentMarket = findSubjectPropertyRentFromMarketConditions();
  const propertyId = getCostarPropertyIdFromUrl(window.location.href);

  const demographics = extractDemographics();
  const traffic = extractTraffic();

  return {
    source: "costar",
    costarPropertyId: propertyId,
    costarUrl: window.location.href,
    propertyName: header.propertyName,
    street: header.street,
    cityStateZip: header.cityStateZip,
    fullAddress: header.fullAddress,
    kpis: {
      buildingSize, landSize, yearBuilt, availableArea,
      primaryRent, salePrice, pricePerArea, subjectRentMarket
    },
    demographics,
    traffic,
    normalized: {
      salePrice: parseMoney(salePrice),
      buildingSf: parseNumber(buildingSize),
      availableSf: parseNumber(availableArea),
      primaryRentPsf: parseRentPsf(primaryRent) || parseRentPsf(subjectRentMarket),
      pricePerSf: parseRentPsf(pricePerArea),
      population3mi: parseNumber(demographics.population3mi),
      medianHHIncome3mi: parseMoney(demographics.medianHHIncome3mi),
      vehiclesPerDay: traffic.highestADT
    }
  };
}

// ---- LIGHTWEIGHT UW CALCULATOR ----
function calcUnderwriting(extracted, inputs) {
  const price = extracted.normalized.salePrice || 0;
  const sf = extracted.normalized.buildingSf || 0;
  const rentPsf = parseNumber(inputs.marketRentPsf) || extracted.normalized.primaryRentPsf || 0;
  const vacancyPct = Number(inputs.vacancyPct) || 8;
  const expenseRatioPct = Number(inputs.expenseRatioPct) || 35;
  const targetCapPct = Number(inputs.targetCapPct) || 7.5;
  const otherIncomeAnnual = Number(inputs.otherIncomeAnnual) || 0;

  const gpr = sf > 0 ? rentPsf * sf : 0;
  const egi = gpr * (1 - vacancyPct / 100) + otherIncomeAnnual;
  const opex = egi * (expenseRatioPct / 100);
  const noi = egi - opex;
  const impliedCap = price > 0 ? (noi / price) * 100 : 0;

  return {
    inputs: { rentPsf, vacancyPct, expenseRatioPct, targetCapPct, otherIncomeAnnual },
    outputs: { price, sf, gpr, egi, opex, noi, impliedCap }
  };
}

// ---- WAIT FOR DATA ----
async function waitForAnyData(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = extractCostarData();
    if (d.fullAddress || d.kpis.salePrice || d.kpis.buildingSize) return d;
    await sleep(250);
  }
  return extractCostarData();
}

// ---- IMPORT BUTTON ----
function injectImportButton() {
  if (document.getElementById("taskflow-import-btn")) return;

  const btn = document.createElement("div");
  btn.id = "taskflow-import-btn";
  btn.innerHTML = `
    <div style="position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div id="taskflow-toast" style="display:none;background:#10B981;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:taskflow-fade 0.3s ease"></div>
      <button id="taskflow-import-trigger" style="background:#1E293B;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:all 0.2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>
        Import to TaskFlow
      </button>
    </div>
    <style>
      @keyframes taskflow-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      #taskflow-import-trigger:hover { background:#0F172A;transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,0.25) }
    </style>
  `;
  document.documentElement.appendChild(btn);

  document.getElementById("taskflow-import-trigger").addEventListener("click", async () => {
    const trigger = document.getElementById("taskflow-import-trigger");
    trigger.textContent = "Extracting...";
    trigger.style.pointerEvents = "none";
    trigger.style.opacity = "0.7";

    try {
      const extracted = await waitForAnyData(9000);
      const uw = calcUnderwriting(extracted, { vacancyPct:8, expenseRatioPct:35, targetCapPct:7.5, marketRentPsf:"", otherIncomeAnnual:0 });

      const response = await chrome.runtime.sendMessage({ type:"COSTAR_IMPORT", extracted, uw });

      const toast = document.getElementById("taskflow-toast");
      if (response && response.success) {
        toast.textContent = "✓ Sent to TaskFlow — open side panel to review";
        toast.style.background = "#10B981";
      } else {
        toast.textContent = "✗ Failed — is TaskFlow side panel open?";
        toast.style.background = "#EF4444";
      }
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 3500);
    } catch (err) {
      console.error("TaskFlow import error:", err);
      const toast = document.getElementById("taskflow-toast");
      toast.textContent = "✗ Error extracting data";
      toast.style.background = "#EF4444";
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 3500);
    }

    trigger.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg> Import to TaskFlow`;
    trigger.style.pointerEvents = "auto";
    trigger.style.opacity = "1";
  });
}

function isPropertyDetailPage() { return /\/detail\/all-properties\/\d+/.test(window.location.href); }

function checkAndInject() {
  if (isPropertyDetailPage()) injectImportButton();
  else { const ex = document.getElementById("taskflow-import-btn"); if (ex) ex.remove(); }
}

checkAndInject();

let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) { lastUrl = window.location.href; setTimeout(checkAndInject, 500); }
});
urlObserver.observe(document.body, { childList: true, subtree: true });
window.addEventListener("popstate", () => setTimeout(checkAndInject, 500));

console.log("[TaskFlow] CoStar scraper v4.1 loaded — demographics + traffic enabled");