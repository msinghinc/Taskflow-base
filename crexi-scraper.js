// ============================================================
// TaskFlow Crexi Scraper (merged from Crexi Capture)
// Runs on www.crexi.com/properties/* pages
// Extracts property data and sends to TaskFlow side panel
// ============================================================

// ---- HELPERS ----
function textOrEmpty(el) {
  return el ? (el.textContent || "").trim() : "";
}

function findDetailValueByLabel(labelText) {
  const labelLower = labelText.toLowerCase();
  const candidates = Array.from(document.querySelectorAll("div, span, dt, th, strong, p"));
  const labelEl = candidates.find(el => textOrEmpty(el).toLowerCase() === labelLower);
  if (!labelEl) return "";

  const container = labelEl.closest("tr, dl, section, div") || labelEl.parentElement;
  if (!container) return "";

  const texts = Array.from(container.querySelectorAll("div, span, dd, td, p"))
    .map(textOrEmpty)
    .filter(Boolean);

  const filtered = texts.filter(t => t.toLowerCase() !== labelLower);
  return filtered[0] || "";
}

function findAskingPriceByDataCy() {
  const el = document.querySelector('[data-cy="auctionDetailsValue"]');
  return textOrEmpty(el);
}

function findAskingPriceByTooltipScan() {
  const els = Array.from(document.querySelectorAll("div.cui-tooltip-target"));
  for (const el of els) {
    const t = textOrEmpty(el);
    if (!t) continue;
    if (t.includes("$") && /[0-9]/.test(t)) return t;
  }
  return "";
}

function findAboutDescription() {
  const headers = Array.from(document.querySelectorAll("h1, h2, h3, h4"));
  const aboutHeader = headers.find(h => textOrEmpty(h).toLowerCase().includes("about"));
  if (!aboutHeader) return "";
  const section = aboutHeader.closest("section") || aboutHeader.parentElement;
  if (!section) return "";
  return textOrEmpty(section);
}

function collectDocuments() {
  const docs = [];
  const links = Array.from(document.querySelectorAll("a[href]"));

  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href) continue;

    const absUrl = new URL(href, location.href).toString();
    const label = textOrEmpty(a) || "Document";
    const lowUrl = absUrl.toLowerCase();
    const lowLabel = label.toLowerCase();

    const looksLikeDoc =
      lowUrl.endsWith(".pdf") ||
      lowUrl.includes("offering") ||
      lowUrl.includes("flyer") ||
      lowUrl.includes("brochure") ||
      lowUrl.includes("rent") ||
      lowUrl.includes("download");

    const labelLooksLikeDoc =
      lowLabel.includes("om") ||
      lowLabel.includes("offering") ||
      lowLabel.includes("flyer") ||
      lowLabel.includes("brochure") ||
      lowLabel.includes("rent roll") ||
      lowLabel.includes("financial");

    if (looksLikeDoc || labelLooksLikeDoc) {
      docs.push({ label, url: absUrl });
    }
  }

  const seen = new Set();
  return docs.filter(d => {
    if (seen.has(d.url)) return false;
    seen.add(d.url);
    return true;
  });
}

function parseMoney(str) {
  if (!str) return 0;
  const s = String(str).replace(/[, ]/g, "");
  const m = s.match(/\$?(-?\d+(\.\d+)?)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function parseNumber(str) {
  if (!str) return 0;
  const s = String(str).replace(/,/g, "");
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

// ---- MAIN EXTRACTION ----
function extractCrexiData() {
  const address = textOrEmpty(document.querySelector("h1"));

  const askingPriceRaw =
    findAskingPriceByDataCy() ||
    findAskingPriceByTooltipScan() ||
    findDetailValueByLabel("Asking Price") ||
    findDetailValueByLabel("Price") ||
    "";

  const propertyType = findDetailValueByLabel("Property Type") || "";
  const subType = findDetailValueByLabel("Sub Type") || "";

  const buildingSfRaw =
    findDetailValueByLabel("Square Footage") ||
    findDetailValueByLabel("Net Rentable Area") ||
    findDetailValueByLabel("Net Rentable") ||
    "";

  const landSizeRaw =
    findDetailValueByLabel("Lot Size") ||
    findDetailValueByLabel("Lot Size (acres)") ||
    findDetailValueByLabel("Lot Size (sq ft)") ||
    "";

  const yearBuilt = findDetailValueByLabel("Year Built") || "";
  const zoning = findDetailValueByLabel("Zoning") || "";
  const apn = findDetailValueByLabel("APN") || "";

  const description = findAboutDescription();
  const documents = collectDocuments();

  return {
    source: "crexi",
    listingUrl: location.href,
    address,
    askingPriceRaw,
    propertyType,
    subType,
    buildingSfRaw,
    landSizeRaw,
    yearBuilt,
    zoning,
    apn,
    description,
    documents,
    normalized: {
      askingPrice: parseMoney(askingPriceRaw),
      buildingSf: parseNumber(buildingSfRaw),
      landSize: landSizeRaw
    }
  };
}

// ---- WAIT FOR DATA ----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForAnyData(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = extractCrexiData();
    if (d.address || d.askingPriceRaw || d.buildingSfRaw) return d;
    await sleep(250);
  }
  return extractCrexiData();
}

// ---- IMPORT BUTTON ----
function injectImportButton() {
  if (document.getElementById("taskflow-crexi-btn")) return;

  const btn = document.createElement("div");
  btn.id = "taskflow-crexi-btn";
  btn.innerHTML = `
    <div style="
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div id="taskflow-crexi-toast" style="
        display: none;
        background: #10B981;
        color: #fff;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: taskflow-crexi-fade 0.3s ease;
      "></div>
      <button id="taskflow-crexi-trigger" style="
        background: #1E293B;
        color: #fff;
        border: none;
        border-radius: 12px;
        padding: 12px 20px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        transition: all 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M8 2v8M5 7l3 3 3-3"/>
          <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/>
        </svg>
        Import to TaskFlow
      </button>
    </div>
    <style>
      @keyframes taskflow-crexi-fade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      #taskflow-crexi-trigger:hover { background: #0F172A; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.25); }
    </style>
  `;
  document.documentElement.appendChild(btn);

  document.getElementById("taskflow-crexi-trigger").addEventListener("click", async () => {
    const trigger = document.getElementById("taskflow-crexi-trigger");
    trigger.textContent = "Extracting...";
    trigger.style.pointerEvents = "none";
    trigger.style.opacity = "0.7";

    try {
      const extracted = await waitForAnyData(9000);

      const response = await chrome.runtime.sendMessage({
        type: "CREXI_IMPORT",
        extracted
      });

      const toast = document.getElementById("taskflow-crexi-toast");
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
      console.error("TaskFlow Crexi import error:", err);
      const toast = document.getElementById("taskflow-crexi-toast");
      toast.textContent = "✗ Error extracting data";
      toast.style.background = "#EF4444";
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 3500);
    }

    trigger.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M8 2v8M5 7l3 3 3-3"/>
        <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/>
      </svg>
      Import to TaskFlow
    `;
    trigger.style.pointerEvents = "auto";
    trigger.style.opacity = "1";
  });
}

// ---- DETECT PROPERTY PAGES & INJECT ----
function isPropertyPage() {
  return /\/properties\//.test(window.location.href);
}

function checkAndInject() {
  if (isPropertyPage()) {
    injectImportButton();
  } else {
    const existing = document.getElementById("taskflow-crexi-btn");
    if (existing) existing.remove();
  }
}

checkAndInject();

// Crexi is a SPA — watch for URL changes
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(checkAndInject, 500);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });
window.addEventListener("popstate", () => setTimeout(checkAndInject, 500));

console.log("[TaskFlow] Crexi scraper loaded");
