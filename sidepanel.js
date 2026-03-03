// ============================================================
// TaskFlow Side Panel v3.0
// Added: Crexi integration, 3 link fields, broker phone/email
// ============================================================

const DEAL_STAGES = [
  { id: "prospecting", label: "Prospecting", color: "#6366F1" },
  { id: "underwriting", label: "Underwriting", color: "#E8A838" },
  { id: "loi", label: "LOI Submitted", color: "#3B82F6" },
  { id: "loi_accepted", label: "LOI Accepted", color: "#0EA5E9" },
  { id: "psa", label: "Under PSA", color: "#8B5CF6" },
  { id: "closed", label: "Closed", color: "#10B981" },
  { id: "dead", label: "Dead", color: "#94A3B8" },
];

const PROPERTY_TYPES = [
  { id: "stnnn", label: "Single Tenant NNN" },
  { id: "multi", label: "Multi-Tenant Retail" },
  { id: "industrial", label: "Industrial" },
  { id: "outparcel", label: "Outparcel" },
  { id: "other", label: "Other" },
];

const PRIORITIES = [
  { id: "high", label: "High", color: "#EF4444", bg: "#FEF2F2" },
  { id: "medium", label: "Med", color: "#E8A838", bg: "#FFFBEB" },
  { id: "low", label: "Low", color: "#6B7280", bg: "#F9FAFB" },
];

const DD_TEMPLATES = [
  "Title & Survey Review", "Environmental (Phase I/II)", "Property Condition Report",
  "Lease Review & Abstraction", "Tenant Estoppels", "Financial Audit (Rent Roll, T12, AR/AP)",
  "Zoning & Entitlements", "Insurance Review", "Tax Assessment Review",
  "SNDA / Subordination Agreements", "Lender Requirements", "Entity Formation / Legal Docs",
];

const DAILY_GOAL = 5;

let state = {
  authenticated: false, syncing: false, lastSync: null,
  activeSection: "acquisitions", dealFilter: "all",
  expandedDeal: null, expandedDD: null, expandedProperty: null,
  showOverlay: null, deals: [], ddDeals: [], properties: [],
  newDeal: emptyDeal(),
  costarImport: null,
  crexiImport: null,
  costarNoiChoice: "calculated",
  // LOI state
  loiDealId: null,
  loiOfferDate: new Date().toISOString().split("T")[0],
  loiPrice: "",
  loiPriceText: "",
  loiGenerating: false,
};

function emptyDeal() {
  return { name:"", address:"", propertyType:"stnnn", stage:"prospecting", priority:"medium",
    askingPrice:"", noi:"", capRate:"", sqft:"", acreage:"", numTenants:"", walt:"",
    broker:"", brokerContact:"", brokerPhone:"", brokerEmail:"",
    notes:"", listingLink:"", uwLink:"", costarLink:"", loiLink:"", omLink:"",
    vehiclesPerDay:"", pop3mi:"", ahi3mi:"", score:"",
    uwRentPsf:"", uwVacancy:"8", uwExpenseRatio:"35", uwTargetCap:"7.5" };
}

// LOI-eligible stages (underwriting and after, excluding dead)
const LOI_STAGES = ["underwriting","loi","loi_accepted","psa","closed"];

// Number to words converter for LOI price text
function numberToWords(n) {
  n = Math.round(parseFloat(n));
  if (!n || n <= 0) return "";
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  function chunk(num) {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num/10)] + (num%10 ? " " + ones[num%10] : "");
    return ones[Math.floor(num/100)] + " Hundred" + (num%100 ? " " + chunk(num%100) : "");
  }

  if (n >= 1e9) {
    const b = Math.floor(n/1e9);
    const rem = n % 1e9;
    return chunk(b) + " Billion" + (rem ? " " + numberToWords(rem) : "");
  }
  if (n >= 1e6) {
    const m = Math.floor(n/1e6);
    const rem = n % 1e6;
    return chunk(m) + " Million" + (rem ? " " + numberToWords(rem) : "");
  }
  if (n >= 1e3) {
    const k = Math.floor(n/1e3);
    const rem = n % 1e3;
    return chunk(k) + " Thousand" + (rem ? " " + numberToWords(rem) : "");
  }
  return chunk(n);
}

function priceToWords(n) {
  n = parseFloat(n);
  if (!n || n <= 0) return "";
  return numberToWords(n) + " and 00/100 Dollars";
}

// Quick UW calculation
function calcQuickUW(deal) {
  const sf = parseFloat(deal.sqft) || 0;
  const rent = parseFloat(deal.uwRentPsf) || 0;
  const vac = parseFloat(deal.uwVacancy) || 0;
  const exp = parseFloat(deal.uwExpenseRatio) || 0;
  const cap = parseFloat(deal.uwTargetCap) || 0;
  const asking = parseFloat(deal.askingPrice) || 0;

  if (!sf || !rent || !cap) return null;

  const gpr = sf * rent;
  const egi = gpr * (1 - vac / 100);
  const noi = egi * (1 - exp / 100);
  const impliedValue = cap > 0 ? noi / (cap / 100) : 0;
  const valuePsf = sf > 0 ? impliedValue / sf : 0;
  const spread = asking > 0 ? impliedValue - asking : 0;
  const spreadPct = asking > 0 ? ((impliedValue / asking) - 1) * 100 : 0;
  const impliedCap = asking > 0 ? (noi / asking) * 100 : 0;

  return { gpr, egi, noi, impliedValue, valuePsf, spread, spreadPct, impliedCap };
}

function genId() { return Math.random().toString(36).slice(2,10); }
function fmt$(n) { n=parseFloat(n); if(!n&&n!==0)return"—"; if(n>=1e6)return"$"+(n/1e6).toFixed(2)+"M"; if(n>=1e3)return"$"+(n/1e3).toFixed(0)+"K"; return"$"+n.toLocaleString(); }
function fmtNum(n) { n=parseFloat(n); if(!n&&n!==0)return"—"; return n.toLocaleString(); }
function fmtDate(d) { if(!d)return""; const dt=new Date(d+"T00:00:00"),t=new Date(),tm=new Date(t); tm.setDate(tm.getDate()+1); if(dt.toDateString()===t.toDateString())return"Today"; if(dt.toDateString()===tm.toDateString())return"Tomorrow"; return dt.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
function overdue(d) { if(!d)return false; const t=new Date(); t.setHours(0,0,0,0); return new Date(d+"T00:00:00")<t; }
function calcCap(p,n) { p=parseFloat(p); n=parseFloat(n); return(p>0&&n>0)?((n/p)*100).toFixed(2):""; }
function stg(id) { return DEAL_STAGES.find(s=>s.id===id)||DEAL_STAGES[0]; }
function pri(id) { return PRIORITIES.find(p=>p.id===id)||PRIORITIES[1]; }
function esc(s) { if(!s)return""; const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }

function scoreColor(s) {
  s=parseFloat(s); if(!s)return"#94A3B8";
  if(s<=3) return`rgb(${239},${68+(s-1)*30},${68})`;
  if(s<=6) return`rgb(${239-(s-4)*30},${168+(s-4)*20},${68})`;
  return`rgb(${16+(10-s)*20},${185-(10-s)*10},${129})`;
}
function scoreBg(s) {
  s=parseFloat(s); if(!s)return"#F9FAFB";
  if(s<=3) return"#FEF2F2";
  if(s<=6) return"#FFFBEB";
  return"#F0FDF4";
}

function dealsAddedToday() {
  const today = new Date().toDateString();
  return state.deals.filter(d => {
    const created = parseInt(d.createdAt);
    return created && new Date(created).toDateString() === today;
  }).length;
}

// Map Crexi property type strings to TaskFlow IDs
function mapCrexiPropertyType(crexiType, crexiSubType) {
  const t = (crexiType || "").toLowerCase();
  const s = (crexiSubType || "").toLowerCase();
  if (t.includes("industrial") || s.includes("industrial") || s.includes("warehouse")) return "industrial";
  if (s.includes("single") || s.includes("nnn") || s.includes("net lease")) return "stnnn";
  if (s.includes("outparcel") || s.includes("pad")) return "outparcel";
  if (t.includes("retail") || s.includes("retail") || s.includes("strip") || s.includes("shopping")) return "multi";
  if (t.includes("net") || t.includes("single")) return "stnnn";
  return "other";
}

function sendMsg(msg) { return new Promise(r=>chrome.runtime.sendMessage(msg,resp=>r(resp||{success:false}))); }

let syncTimer=null;
function dSync(section) { if(syncTimer)clearTimeout(syncTimer); syncTimer=setTimeout(()=>doSync(section),1000); }
async function doSync(section) {
  state.syncing=true; updSync();
  try { const data=section==="acquisitions"?state.deals:section==="dd"?state.ddDeals:state.properties; await sendMsg({type:"SYNC_TO_SHEETS",section,data}); state.lastSync=new Date(); } catch(e){ console.error(e); }
  state.syncing=false; updSync();
}
function updSync() { const el=document.getElementById("sync-status"); if(el) el.innerHTML=`<span class="sync-dot ${state.syncing?'syncing':''}"></span><span>${state.syncing?'Syncing...':(state.lastSync?'Synced':'Connected')}</span>`; }
async function loadAll() { const r=await sendMsg({type:"LOAD_ALL"}); if(r.success){ if(r.acquisitions?.length)state.deals=r.acquisitions; if(r.dd?.length)state.ddDeals=r.dd; if(r.am?.length)state.properties=r.am; } }

// ---- IMPORT POLLING (CoStar + Crexi) ----
let importPollTimer = null;
function startImportPolling() {
  if (importPollTimer) return;
  importPollTimer = setInterval(checkImports, 2000);
}

async function checkImports() {
  // Check CoStar
  const cs = await sendMsg({ type: "CHECK_COSTAR_IMPORT" });
  if (cs.success && cs.data && cs.data.extracted) {
    state.costarImport = cs.data;
    state.costarNoiChoice = "calculated";
    prefillDealFromCostar(cs.data);
    state.showOverlay = "costarReview";
    state.activeSection = "acquisitions";
    render();
    await sendMsg({ type: "CLEAR_COSTAR_IMPORT" });
    return;
  }
  // Check Crexi
  const cx = await sendMsg({ type: "CHECK_CREXI_IMPORT" });
  if (cx.success && cx.data && cx.data.extracted) {
    state.crexiImport = cx.data;
    prefillDealFromCrexi(cx.data);
    state.showOverlay = "crexiReview";
    state.activeSection = "acquisitions";
    render();
    await sendMsg({ type: "CLEAR_CREXI_IMPORT" });
    return;
  }
}

// ---- CoStar Prefill ----
function prefillDealFromCostar(importData) {
  const ext = importData.extracted;
  const uw = importData.uw;

  state.newDeal = emptyDeal();
  state.newDeal.name = ext.propertyName || "";
  state.newDeal.address = ext.fullAddress || "";
  state.newDeal.listingLink = ext.costarUrl || "";
  state.newDeal.askingPrice = ext.normalized.salePrice || "";
  state.newDeal.sqft = ext.normalized.buildingSf || "";

  // Build permanent CoStar property link
  if (ext.costarPropertyId) {
    state.newDeal.costarLink = "https://product.costar.com/detail/all-properties/" + ext.costarPropertyId + "/summary";
  }

  if (ext.kpis.landSize) {
    const acMatch = ext.kpis.landSize.match(/([\d,.]+)/);
    if (acMatch) state.newDeal.acreage = acMatch[1].replace(/,/g, "");
  }

  if (uw && uw.outputs && uw.outputs.noi > 0) {
    state.newDeal.noi = Math.round(uw.outputs.noi);
  }
  state.newDeal.capRate = calcCap(state.newDeal.askingPrice, state.newDeal.noi);

  const noteParts = [];
  if (ext.kpis.yearBuilt) noteParts.push("Year Built: " + ext.kpis.yearBuilt);
  if (ext.kpis.primaryRent) noteParts.push("Asking Rent: " + ext.kpis.primaryRent);
  if (ext.kpis.availableArea) noteParts.push("Available: " + ext.kpis.availableArea);
  if (ext.costarPropertyId) noteParts.push("CoStar ID: " + ext.costarPropertyId);
  if (ext.traffic && ext.traffic.highestRoad) noteParts.push("Traffic: " + ext.traffic.highestADT.toLocaleString() + " ADT on " + ext.traffic.highestRoad);
  if (noteParts.length) state.newDeal.notes = noteParts.join(" | ");

  // Demographics + traffic
  if (ext.normalized) {
    if (ext.normalized.population3mi) state.newDeal.pop3mi = String(ext.normalized.population3mi);
    if (ext.normalized.medianHHIncome3mi) state.newDeal.ahi3mi = String(ext.normalized.medianHHIncome3mi);
    if (ext.normalized.vehiclesPerDay) state.newDeal.vehiclesPerDay = String(ext.normalized.vehiclesPerDay);
  }
}

// ---- Crexi Prefill ----
function prefillDealFromCrexi(importData) {
  const ext = importData.extracted;

  state.newDeal = emptyDeal();
  state.newDeal.name = ext.address || "";
  state.newDeal.address = ext.address || "";
  state.newDeal.listingLink = ext.listingUrl || "";
  state.newDeal.askingPrice = ext.normalized.askingPrice || "";
  state.newDeal.sqft = ext.normalized.buildingSf || "";
  state.newDeal.acreage = ext.normalized.landSize || "";
  state.newDeal.propertyType = mapCrexiPropertyType(ext.propertyType, ext.subType);

  // No NOI from Crexi — leave blank for manual entry
  state.newDeal.noi = "";
  state.newDeal.capRate = "";

  const noteParts = [];
  if (ext.propertyType) noteParts.push("Type: " + ext.propertyType);
  if (ext.subType) noteParts.push("Sub: " + ext.subType);
  if (ext.yearBuilt) noteParts.push("Year Built: " + ext.yearBuilt);
  if (ext.zoning) noteParts.push("Zoning: " + ext.zoning);
  if (ext.apn) noteParts.push("APN: " + ext.apn);
  if (ext.documents && ext.documents.length) {
    noteParts.push("Docs: " + ext.documents.map(d => d.label).join(", "));
  }
  if (noteParts.length) state.newDeal.notes = noteParts.join(" | ");

  // Description goes into notes if short enough, otherwise append
  if (ext.description && ext.description.length > 0 && ext.description.length < 500) {
    state.newDeal.notes += (state.newDeal.notes ? "\n\n" : "") + ext.description;
  }
}

function applyNoiChoice() {
  if (!state.costarImport) return;
  const uw = state.costarImport.uw;
  if (state.costarNoiChoice === "calculated" && uw && uw.outputs) {
    state.newDeal.noi = Math.round(uw.outputs.noi) || "";
  } else {
    state.newDeal.noi = "";
  }
  state.newDeal.capRate = calcCap(state.newDeal.askingPrice, state.newDeal.noi);
}

// ---- ICONS ----
const IC={
  plus:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`,
  chev:`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 5.5L7 9L10.5 5.5"/></svg>`,
  trash:`<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M4.5 6.5v4M7 6.5v4M9.5 6.5v4M3.5 4l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8"/></svg>`,
  bldg:`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="10" height="11" rx="1"/><line x1="5" y1="5" x2="5" y2="5.01" stroke-width="2"/><line x1="7" y1="5" x2="7" y2="5.01" stroke-width="2"/><line x1="9" y1="5" x2="9" y2="5.01" stroke-width="2"/><line x1="5" y1="8" x2="5" y2="8.01" stroke-width="2"/><line x1="7" y1="8" x2="7" y2="8.01" stroke-width="2"/><line x1="9" y1="8" x2="9" y2="8.01" stroke-width="2"/><rect x="5.5" y="10.5" width="3" height="2.5"/></svg>`,
  cal:`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><rect x="1" y="2.5" width="12" height="10" rx="2"/><line x1="1" y1="6" x2="13" y2="6"/><line x1="4.5" y1="1" x2="4.5" y2="4"/><line x1="9.5" y1="1" x2="9.5" y2="4"/></svg>`,
  link:`<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 8l2-2M5 9.5a2.5 2.5 0 01 0-3.5l1-1a2.5 2.5 0 013.5 3.5l-.5.5M9 4.5a2.5 2.5 0 010 3.5l-1 1a2.5 2.5 0 01-3.5-3.5l.5-.5"/></svg>`,
  star:`<svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1l1.8 3.6L13 5.3l-3 2.9.7 4.1L7 10.4 3.3 12.3l.7-4.1-3-2.9 4.2-.7z"/></svg>`,
  imp:`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>`,
  doc:`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M8 1H3.5A1.5 1.5 0 002 2.5v9A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V5L8 1z"/><path d="M8 1v4h4"/><line x1="5" y1="7.5" x2="9" y2="7.5"/><line x1="5" y1="9.5" x2="8" y2="9.5"/></svg>`,
};
function chk(c){return c?`<svg width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="4" stroke="#10B981" stroke-width="1.5" fill="#10B981"/><path d="M5 9L7.5 11.5L13 6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`:`<svg width="18" height="18" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="4" stroke="#CBD5E1" stroke-width="1.5" fill="#fff"/></svg>`;}

const app=document.getElementById("app");

// ==================== DELEGATED EVENT LISTENERS ====================
app.addEventListener("click",e=>{
  const link=e.target.closest("[data-link]");
  if(link){ e.preventDefault(); e.stopPropagation(); window.open(link.dataset.link,"_blank"); return; }

  const btn=e.target.closest("[data-action]");
  if(!btn)return;
  const a=btn.dataset.action, id=btn.dataset.id||"", id2=btn.dataset.id2||"", val=btn.dataset.value||"";
  switch(a){
    case"login":doLogin();break;
    case"section":state.activeSection=val;state.expandedDeal=state.expandedDD=state.expandedProperty=null;render();break;
    case"filter":state.dealFilter=val;render();break;
    case"tog-deal":state.expandedDeal=state.expandedDeal===id?null:id;render();break;
    case"tog-dd":state.expandedDD=state.expandedDD===id?null:id;render();break;
    case"tog-prop":state.expandedProperty=state.expandedProperty===id?null:id;render();break;
    case"stage":{const d=state.deals.find(x=>x.id===id);if(d){const oldStage=d.stage;d.stage=val;d.lastActivity=Date.now();render();dSync("acquisitions");
      // Schedule LOI follow-ups when moving to LOI Submitted
      if(val==="loi"&&oldStage!=="loi"){sendMsg({type:"SCHEDULE_LOI_FOLLOWUP",dealId:d.id,dealName:d.name});}
    }break;}
    case"del-deal":if(confirm("Remove this deal?")){state.deals=state.deals.filter(x=>x.id!==id);state.expandedDeal=null;render();dSync("acquisitions");}break;
    case"add-deal-form":state.showOverlay="addDeal";state.newDeal=emptyDeal();render();break;
    case"close-overlay":state.showOverlay=null;state.costarImport=null;state.crexiImport=null;render();break;
    case"prop-type":state.newDeal.propertyType=val;render();break;
    case"set-pri":state.newDeal.priority=val;render();break;
    case"save-deal":saveDeal();break;
    case"tog-ddt":{const dd=state.ddDeals.find(x=>x.id===id);if(dd){const t=(dd.tasks||[]).find(x=>x.id===id2);if(t)t.completed=!t.completed;render();dSync("dd");}break;}
    case"del-ddt":{const dd=state.ddDeals.find(x=>x.id===id);if(dd){dd.tasks=(dd.tasks||[]).filter(x=>x.id!==id2);render();dSync("dd");}break;}
    case"add-ddt":{const txt=prompt("New DD task:");if(txt?.trim()){const dd=state.ddDeals.find(x=>x.id===id);if(dd){if(!dd.tasks)dd.tasks=[];dd.tasks.push({id:genId(),text:txt.trim(),completed:false,dueDate:"",notes:""});render();dSync("dd");}}break;}
    case"del-dd":if(confirm("Remove this checklist?")){state.ddDeals=state.ddDeals.filter(x=>x.id!==id);state.expandedDD=null;render();dSync("dd");}break;
    case"add-dd":{const nm=prompt("Deal name for DD checklist:");if(!nm?.trim())break;const cl=prompt("Target closing date (YYYY-MM-DD):");state.ddDeals.push({id:genId(),dealName:nm.trim(),closingDate:cl||"",tasks:DD_TEMPLATES.map(t=>({id:genId(),text:t,completed:false,dueDate:"",notes:""}))});render();dSync("dd");break;}
    case"tog-amt":{const p=state.properties.find(x=>x.id===id);if(p){const t=(p.tasks||[]).find(x=>x.id===id2);if(t)t.completed=!t.completed;render();dSync("am");}break;}
    case"del-amt":{const p=state.properties.find(x=>x.id===id);if(p){p.tasks=(p.tasks||[]).filter(x=>x.id!==id2);render();dSync("am");}break;}
    case"add-amt":{const txt=prompt("New task for this property:");if(txt?.trim()){const p=state.properties.find(x=>x.id===id);if(p){if(!p.tasks)p.tasks=[];p.tasks.push({id:genId(),text:txt.trim(),completed:false,dueDate:new Date().toISOString().split("T")[0],priority:"medium"});render();dSync("am");}}break;}
    case"del-prop":if(confirm("Remove this property?")){state.properties=state.properties.filter(x=>x.id!==id);state.expandedProperty=null;render();dSync("am");}break;
    case"add-prop":{const nm=prompt("Property name:");if(!nm?.trim())break;const addr=prompt("Address:");const ten=prompt("Tenant(s):");const noi=prompt("NOI:");state.properties.push({id:genId(),name:nm.trim(),address:addr||"",propertyType:"stnnn",tenant:ten||"",noi:parseFloat(noi)||0,leaseExpiry:"",tasks:[]});render();dSync("am");break;}
    case"push-cal":pushCal(val);break;
    // CoStar import
    case"costar-noi-choice": state.costarNoiChoice=val; applyNoiChoice(); render(); break;
    case"costar-accept": state.showOverlay="addDeal"; state.costarImport=null; render(); break;
    case"costar-save": saveDeal(); break;
    // Crexi import
    case"crexi-accept": state.showOverlay="addDeal"; state.crexiImport=null; render(); break;
    case"crexi-save": saveDeal(); break;
    // LOI
    case"open-loi":{
      const deal = state.deals.find(x=>x.id===id);
      if(deal){
        state.loiDealId = id;
        state.loiOfferDate = new Date().toISOString().split("T")[0];
        state.loiPrice = "";
        state.loiPriceText = "";
        state.loiGenerating = false;
        state.showOverlay = "loi";
        render();
      }
      break;
    }
    case"generate-loi": generateLOI(); break;
    case"view-loi":{
      const deal2 = state.deals.find(x=>x.id===id);
      if(deal2 && deal2.loiLink) window.open(deal2.loiLink, "_blank");
      break;
    }
    // Quick UW
    case"apply-uw":{
      const deal3 = state.deals.find(x=>x.id===id);
      if(deal3){
        const uw = calcQuickUW(deal3);
        if(uw){
          deal3.noi = Math.round(uw.noi);
          deal3.capRate = uw.impliedCap.toFixed(2);
          deal3.lastActivity = Date.now();
          render();
          dSync("acquisitions");
        } else { alert("Enter Rent/SF, Building SF, and Target Cap to calculate."); }
      }
      break;
    }
  }
});

app.addEventListener("input",e=>{
  const f=e.target.dataset.field;
  if(!f)return;
  if(f==="nd-price"||f==="nd-noi"){
    state.newDeal[f==="nd-price"?"askingPrice":"noi"]=e.target.value;
    const cr=calcCap(state.newDeal.askingPrice,state.newDeal.noi);
    state.newDeal.capRate=cr;
    const ce=document.querySelector('[data-field="nd-cap"]');
    if(ce){ce.value=cr;ce.style.background=cr?"#F0FDF4":"#F8FAFC";}
  }
  // LOI price auto-generates text
  if(f==="loi-price"){
    state.loiPrice = e.target.value;
    const auto = priceToWords(e.target.value);
    state.loiPriceText = auto;
    const textEl = document.querySelector('[data-field="loi-price-text"]');
    if(textEl) textEl.value = auto;
    // Auto-calc deposit display
    const depEl = document.getElementById("loi-deposit-display");
    if(depEl){
      const dep = parseFloat(e.target.value) * 0.015;
      depEl.textContent = dep > 0 ? fmt$(dep) : "—";
    }
  }
  if(f==="loi-price-text"){
    state.loiPriceText = e.target.value;
  }
  if(f==="loi-date"){
    state.loiOfferDate = e.target.value;
  }
  // Quick UW inputs — save to deal and re-render calc
  if(f && f.startsWith("uw-")){
    const dealId = e.target.dataset.dealId;
    const deal = state.deals.find(d => d.id === dealId);
    if(deal){
      const fieldMap = {"uw-rent":"uwRentPsf","uw-vac":"uwVacancy","uw-exp":"uwExpenseRatio","uw-cap":"uwTargetCap"};
      if(fieldMap[f]){ deal[fieldMap[f]] = e.target.value; }
      // Update the output display without full re-render
      const uw = calcQuickUW(deal);
      const container = e.target.closest(".quick-uw");
      if(container && uw){
        const els = container.querySelectorAll("[data-uw-out]");
        els.forEach(el => {
          const k = el.dataset.uwOut;
          if(k==="gpr") el.textContent = fmt$(Math.round(uw.gpr));
          if(k==="egi") el.textContent = fmt$(Math.round(uw.egi));
          if(k==="noi") el.textContent = fmt$(Math.round(uw.noi));
          if(k==="value") el.textContent = fmt$(Math.round(uw.impliedValue));
          if(k==="vpsf") el.textContent = "$"+Math.round(uw.valuePsf);
          if(k==="icap") el.textContent = uw.impliedCap.toFixed(2)+"%";
          if(k==="spread"){
            const sign = uw.spread >= 0 ? "+" : "";
            el.textContent = sign+fmt$(Math.round(uw.spread))+" ("+sign+uw.spreadPct.toFixed(1)+"%)";
            el.style.color = uw.spread >= 0 ? "#10B981" : "#EF4444";
          }
        });
      }
      dSync("acquisitions");
    }
  }
});

app.addEventListener("change",e=>{
  const f=e.target.dataset.field; if(!f)return;
  const map={"nd-name":"name","nd-address":"address","nd-tenants":"numTenants","nd-walt":"walt",
    "nd-sqft":"sqft","nd-acreage":"acreage","nd-broker":"broker","nd-contact":"brokerContact",
    "nd-phone":"brokerPhone","nd-email":"brokerEmail",
    "nd-notes":"notes","nd-cap":"capRate",
    "nd-listing":"listingLink","nd-uw":"uwLink","nd-costar":"costarLink","nd-om":"omLink",
    "nd-vpd":"vehiclesPerDay",
    "nd-pop":"pop3mi","nd-ahi":"ahi3mi","nd-score":"score"};
  if(map[f])state.newDeal[map[f]]=e.target.value;
});

// ==================== ACTIONS ====================
async function doLogin(){
  const r=await sendMsg({type:"AUTH_LOGIN"});
  if(r.success){state.authenticated=true;await sendMsg({type:"INIT_SPREADSHEET"});await sendMsg({type:"SETUP_ALARMS"});await loadAll();render();startImportPolling();}
  else alert("Login failed. Check your Google Cloud setup and try again.");
}

function saveDeal(){
  const map={"nd-name":"name","nd-address":"address","nd-tenants":"numTenants","nd-walt":"walt",
    "nd-sqft":"sqft","nd-acreage":"acreage","nd-broker":"broker","nd-contact":"brokerContact",
    "nd-phone":"brokerPhone","nd-email":"brokerEmail",
    "nd-notes":"notes","nd-price":"askingPrice","nd-noi":"noi","nd-cap":"capRate",
    "nd-listing":"listingLink","nd-uw":"uwLink","nd-costar":"costarLink","nd-om":"omLink",
    "nd-vpd":"vehiclesPerDay",
    "nd-pop":"pop3mi","nd-ahi":"ahi3mi","nd-score":"score"};
  document.querySelectorAll("[data-field]").forEach(el=>{
    if(map[el.dataset.field])state.newDeal[map[el.dataset.field]]=el.value;
  });
  const nd=state.newDeal;
  if(!nd.name.trim()){alert("Deal name is required");return;}
  state.deals.unshift({
    id:genId(), name:nd.name.trim(), address:nd.address, propertyType:nd.propertyType,
    stage:"prospecting", priority:nd.priority,
    askingPrice:parseFloat(nd.askingPrice)||0, noi:parseFloat(nd.noi)||0,
    capRate:parseFloat(nd.capRate)||0, sqft:parseFloat(nd.sqft)||0,
    acreage:nd.acreage, numTenants:nd.numTenants, walt:nd.walt,
    broker:nd.broker, brokerContact:nd.brokerContact,
    brokerPhone:nd.brokerPhone, brokerEmail:nd.brokerEmail,
    notes:nd.notes,
    listingLink:nd.listingLink, uwLink:nd.uwLink, costarLink:nd.costarLink, loiLink:"", omLink:nd.omLink,
    vehiclesPerDay:nd.vehiclesPerDay, pop3mi:nd.pop3mi, ahi3mi:nd.ahi3mi, score:nd.score,
    uwRentPsf:nd.uwRentPsf, uwVacancy:nd.uwVacancy, uwExpenseRatio:nd.uwExpenseRatio, uwTargetCap:nd.uwTargetCap,
    createdAt:Date.now(), lastActivity:Date.now(),
  });
  state.showOverlay=null; state.newDeal=emptyDeal(); state.costarImport=null; state.crexiImport=null; render(); dSync("acquisitions");
}

async function generateLOI(){
  const deal = state.deals.find(d => d.id === state.loiDealId);
  if(!deal){ alert("Deal not found"); return; }

  const price = parseFloat(state.loiPrice);
  if(!price || price <= 0){ alert("Enter a valid LOI price"); return; }
  if(!state.loiOfferDate){ alert("Select an offer date"); return; }

  // Format the offer date for display
  const dateParts = state.loiOfferDate.split("-");
  const offerDateFormatted = dateParts[1] + "/" + dateParts[2] + "/" + dateParts[0].slice(2);

  const deposit = price * 0.015;
  const priceText = state.loiPriceText || priceToWords(price);

  state.loiGenerating = true;
  render();

  try {
    const r = await sendMsg({
      type: "GENERATE_LOI",
      payload: {
        dealName: deal.name,
        address: deal.address,
        offerDate: offerDateFormatted,
        loiPrice: price,
        loiPriceText: priceText,
        deposit: deposit
      }
    });

    if(r.success && r.docUrl){
      // Store LOI link on the deal
      deal.loiLink = r.docUrl;
      deal.lastActivity = Date.now();
      state.showOverlay = null;
      state.loiGenerating = false;
      render();
      dSync("acquisitions");
      // Open the new doc
      window.open(r.docUrl, "_blank");
    } else {
      state.loiGenerating = false;
      render();
      alert("LOI generation failed: " + (r.error || "Unknown error"));
    }
  } catch(err) {
    state.loiGenerating = false;
    render();
    alert("LOI generation error: " + err.message);
  }
}

async function pushCal(section){
  const r=await sendMsg({type:"PUSH_CALENDAR_NOW",section});
  alert(r.success?"Pushed to Google Calendar!":"Calendar push failed. Check connection.");
}

// ==================== RENDER ====================
function render(){
  if(!state.authenticated){app.innerHTML=`<div class="login-screen"><h1>TaskFlow</h1><p>Your real estate deal pipeline,<br>DD tracker, and asset manager.</p><button class="btn-google" data-action="login">Connect Google Account</button><p class="login-note">Connects to Google Sheets for storage<br>and Google Calendar for task reminders.</p></div>`;return;}
  const today=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  let h=`<div class="header"><div class="header-top"><h1>TaskFlow</h1><span class="header-date">${today}</span></div><div class="sync-status" id="sync-status"><span class="sync-dot ${state.syncing?'syncing':''}"></span><span>${state.syncing?'Syncing...':(state.lastSync?'Synced':'Connected')}</span></div><div class="section-tabs">`;
  [["acquisitions","Acquisitions"],["dd","Due Diligence"],["am","Asset Mgmt"]].forEach(([id,lb])=>{
    h+=`<button class="section-tab ${state.activeSection===id?'active':''}" data-action="section" data-value="${id}">${lb}</button>`;
  });
  h+=`</div></div>`;
  if(state.activeSection==="acquisitions")h+=rAcq();
  else if(state.activeSection==="dd")h+=rDD();
  else h+=rAM();
  if(state.showOverlay==="addDeal")h+=rAddDeal();
  if(state.showOverlay==="costarReview")h+=rCostarReview();
  if(state.showOverlay==="crexiReview")h+=rCrexiReview();
  if(state.showOverlay==="loi")h+=rLOI();
  app.innerHTML=h;
}

function renderDailyGoal(){
  const added=dealsAddedToday();
  const pct=Math.min(100,Math.round((added/DAILY_GOAL)*100));
  const full=added>=DAILY_GOAL;
  const dots=[];
  for(let i=0;i<DAILY_GOAL;i++){
    dots.push(`<div style="width:${100/DAILY_GOAL}%;height:100%;border-radius:3px;background:${i<added?(full?'#10B981':'#3B82F6'):'#E2E8F0'};transition:background 0.3s"></div>`);
  }
  return `<div style="padding:8px 18px 4px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:10px;font-weight:600;color:${full?'#10B981':'#64748B'}">Daily Goal: ${added}/${DAILY_GOAL} properties</span><span style="font-size:10px;color:${full?'#10B981':'#94A3B8'}">${full?'Goal hit!':pct+'%'}</span></div><div style="display:flex;gap:3px;height:6px">${dots.join("")}</div></div>`;
}

// ---- Helper: render 3 links in expanded card ----
function renderLinks(d) {
  const links = [];
  if (d.listingLink) {
    const src = d.listingLink.includes("crexi.com") ? "Crexi" : d.listingLink.includes("costar.com") ? "CoStar" : "Listing";
    links.push({ label: src + " Listing", url: d.listingLink, color: "#3B82F6", bg: "#EFF6FF", border: "#BFDBFE" });
  }
  if (d.uwLink) links.push({ label: "Underwriting", url: d.uwLink, color: "#8B5CF6", bg: "#F5F3FF", border: "#DDD6FE" });
  if (d.costarLink) links.push({ label: "CoStar Property", url: d.costarLink, color: "#0EA5E9", bg: "#F0F9FF", border: "#BAE6FD" });
  if (d.loiLink) links.push({ label: "View LOI", url: d.loiLink, color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" });
  if (d.omLink) links.push({ label: "Offering Memo", url: d.omLink, color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" });
  if (!links.length) return "";
  let h = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">`;
  links.forEach(l => {
    h += `<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;font-size:10px;font-weight:600;color:${l.color};background:${l.bg};border:1px solid ${l.border};border-radius:6px;cursor:pointer;font-family:'DM Sans',sans-serif" data-link="${esc(l.url)}">${IC.link} ${l.label}</span>`;
  });
  h += `</div>`;
  return h;
}

// ---- Helper: render broker info in expanded card ----
function renderBroker(d) {
  if (!d.broker && !d.brokerContact && !d.brokerPhone && !d.brokerEmail) return "";
  let val = "";
  if (d.broker) val += esc(d.broker);
  if (d.brokerContact) val += (val ? " — " : "") + esc(d.brokerContact);
  if (d.brokerPhone) val += `<br><span style="font-size:11px;color:#64748B">📞 ${esc(d.brokerPhone)}</span>`;
  if (d.brokerEmail) val += `<br><span style="font-size:11px;color:#64748B">✉ ${esc(d.brokerEmail)}</span>`;
  // 1-click email button
  if (d.brokerEmail) {
    val += `<br><a href="mailto:${esc(d.brokerEmail)}?subject=${encodeURIComponent("RE: " + (d.address || d.name))}" style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:4px 10px;font-size:10px;font-weight:600;color:#3B82F6;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:5px;text-decoration:none;font-family:'DM Sans',sans-serif;cursor:pointer">✉ Email Broker</a>`;
  }
  return `<div class="info-box"><div class="info-label">Broker</div><div class="info-value">${val}</div></div>`;
}

// ---- Helper: render Quick UW section in expanded card ----
function renderQuickUW(d) {
  const uw = calcQuickUW(d);
  const hasCalc = uw !== null;

  let h = `<div class="quick-uw" style="margin:10px 0;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">`;

  // Header
  h += `<div style="background:#F8FAFC;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #E2E8F0">
    <span style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px">Quick Underwriting</span>
    <span style="font-size:9px;color:#94A3B8">Back-of-napkin math</span>
  </div>`;

  // Inputs
  h += `<div style="padding:10px 12px">`;
  h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">`;
  h += `<div><div style="font-size:9px;color:#94A3B8;margin-bottom:3px;font-weight:600">RENT / SF / YR</div>
    <input type="number" data-field="uw-rent" data-deal-id="${d.id}" value="${d.uwRentPsf||""}" placeholder="24.00" style="width:100%;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none"></div>`;
  h += `<div><div style="font-size:9px;color:#94A3B8;margin-bottom:3px;font-weight:600">VACANCY %</div>
    <input type="number" data-field="uw-vac" data-deal-id="${d.id}" value="${d.uwVacancy||""}" placeholder="8" style="width:100%;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none"></div>`;
  h += `<div><div style="font-size:9px;color:#94A3B8;margin-bottom:3px;font-weight:600">EXPENSE RATIO %</div>
    <input type="number" data-field="uw-exp" data-deal-id="${d.id}" value="${d.uwExpenseRatio||""}" placeholder="35" style="width:100%;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none"></div>`;
  h += `<div><div style="font-size:9px;color:#94A3B8;margin-bottom:3px;font-weight:600">TARGET CAP %</div>
    <input type="number" data-field="uw-cap" data-deal-id="${d.id}" value="${d.uwTargetCap||""}" placeholder="7.5" style="width:100%;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none"></div>`;
  h += `</div>`;

  // Outputs
  if (hasCalc) {
    const spread = uw.spread;
    const spreadSign = spread >= 0 ? "+" : "";
    const spreadColor = spread >= 0 ? "#10B981" : "#EF4444";

    h += `<div style="margin-top:10px;background:#F8FAFC;border-radius:8px;padding:8px 10px">`;
    h += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">`;

    [["GPR","gpr",fmt$(Math.round(uw.gpr))],
     ["EGI","egi",fmt$(Math.round(uw.egi))],
     ["NOI","noi",fmt$(Math.round(uw.noi))],
     ["Implied Value","value",fmt$(Math.round(uw.impliedValue))],
     ["Value/SF","vpsf","$"+Math.round(uw.valuePsf)],
     ["Implied Cap","icap",uw.impliedCap.toFixed(2)+"%"]
    ].forEach(([label, key, val]) => {
      h += `<div style="text-align:center"><div style="font-size:8px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.3px;font-weight:600">${label}</div>
        <div style="font-size:12px;font-weight:700;color:#1E293B;margin-top:2px" data-uw-out="${key}">${val}</div></div>`;
    });
    h += `</div>`;

    // Spread vs asking — full width
    h += `<div style="margin-top:8px;text-align:center;padding-top:8px;border-top:1px solid #E2E8F0">
      <div style="font-size:8px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.3px;font-weight:600">Spread vs Asking</div>
      <div style="font-size:13px;font-weight:800;margin-top:2px;color:${spreadColor}" data-uw-out="spread">${spreadSign}${fmt$(Math.round(spread))} (${spreadSign}${uw.spreadPct.toFixed(1)}%)</div>
    </div>`;

    h += `</div>`;

    // Apply button
    h += `<button style="margin-top:8px;width:100%;padding:7px;background:#1E293B;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;transition:background 0.15s" 
      onmouseover="this.style.background='#0F172A'" onmouseout="this.style.background='#1E293B'"
      data-action="apply-uw" data-id="${d.id}">Apply NOI & Cap to Deal</button>`;
  } else {
    h += `<div style="margin-top:8px;text-align:center;color:#CBD5E1;font-size:11px;padding:8px 0">Enter Rent/SF and Building SF to calculate</div>`;
  }

  h += `</div></div>`;
  return h;
}

// ---- ACQUISITIONS ----
function rAcq(){
  const af=state.dealFilter;
  const list=af==="all"?state.deals.filter(d=>d.stage!=="dead"&&d.stage!=="closed"):state.deals.filter(d=>d.stage===af);
  let h=renderDailyGoal();
  h+=`<div class="filter-bar"><button class="filter-btn ${af==='all'?'active':''}" data-action="filter" data-value="all">Active</button>`;
  DEAL_STAGES.filter(s=>s.id!=="dead").forEach(s=>{
    h+=`<button class="filter-btn ${af===s.id?'stage-active':''}" style="${af===s.id?`background:${s.color}15;color:${s.color};border-color:${s.color}40;font-weight:700`:''}" data-action="filter" data-value="${s.id}">${s.label}</button>`;
  });
  h+=`</div><div class="content">`;
  if(!list.length)h+=`<div class="empty-state"><h3>No deals in this stage</h3><p>Add a new deal to get started</p></div>`;
  list.forEach(d=>{
    const s=stg(d.stage),p=pri(d.priority),ex=state.expandedDeal===d.id;
    const sc=parseFloat(d.score);
    // Card header with link icons
    const hasAnyLink = d.listingLink || d.uwLink || d.costarLink;
    h+=`<div class="card" style="border-left:3px solid ${s.color}"><div class="card-header" data-action="tog-deal" data-id="${d.id}"><div class="card-body"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="card-title">${esc(d.name)}</div>`;
    if(sc){h+=`<span style="font-size:11px;font-weight:800;color:${scoreColor(sc)};background:${scoreBg(sc)};padding:2px 7px;border-radius:5px;flex-shrink:0">${sc}/10</span>`;}
    h+=`</div><div class="card-subtitle">${esc(d.address)}</div><div class="card-tags"><span class="tag" style="background:${s.color}12;color:${s.color}">${s.label}</span><span class="tag" style="background:${p.bg};color:${p.color}">${p.label}</span><span class="tag-price">${fmt$(d.askingPrice)}</span><span class="tag-cap">${d.capRate}% cap</span>`;
    if(hasAnyLink){h+=`<span style="color:#3B82F6;display:flex;align-items:center;gap:2px;font-size:9px">${IC.link}</span>`;}
    h+=`</div></div><span class="chevron ${ex?'open':''}">${IC.chev}</span></div>`;

    if(ex){
      const priceSf=d.sqft>0?"$"+Math.round(d.askingPrice/d.sqft):"—";
      h+=`<div class="card-expanded"><div class="metrics-grid">`;
      [
        ["NOI",fmt$(d.noi)], ["Cap Rate",d.capRate+"%"], ["Sq Ft",d.sqft?fmtNum(d.sqft):"—"],
        ["Acreage",d.acreage||"—"], ["# Tenants",d.numTenants||"—"], ["WALT",d.walt||"—"],
        ["Price/SF",priceSf], ["3mi Pop",d.pop3mi?fmtNum(d.pop3mi):"—"], ["3mi AHI",d.ahi3mi?fmt$(d.ahi3mi):"—"],
        ["Vehicles/Day",d.vehiclesPerDay?fmtNum(d.vehiclesPerDay):"—"],
      ].forEach(([l,v])=>{
        h+=`<div class="metric-box"><div class="metric-label">${l}</div><div class="metric-value">${v}</div></div>`;
      });
      h+=`</div>`;

      if(sc){
        h+=`<div style="margin:4px 0 10px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Deal Score</span><span style="font-size:14px;font-weight:800;color:${scoreColor(sc)}">${sc}/10</span></div><div style="height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden"><div style="height:100%;width:${sc*10}%;background:${scoreColor(sc)};border-radius:4px;transition:width 0.3s"></div></div></div>`;
      }

      h += renderBroker(d);
      h += renderLinks(d);
      h += renderQuickUW(d);
      if(d.notes)h+=`<div class="info-box"><div class="info-label">Notes</div><div class="info-value">${esc(d.notes)}</div></div>`;
      h+=`<div class="stage-selector"><div class="info-label" style="margin-bottom:6px">Move Stage</div><div class="stage-buttons">`;
      DEAL_STAGES.forEach(s=>{h+=`<button class="stage-btn ${d.stage===s.id?'active':''}" style="${d.stage===s.id?`background:${s.color}20;color:${s.color};border-color:${s.color}40`:''}" data-action="stage" data-id="${d.id}" data-value="${s.id}">${s.label}</button>`;});
      h+=`</div></div><div class="card-actions">`;
      // LOI button — show for underwriting+ stages
      if(LOI_STAGES.includes(d.stage)){
        if(d.loiLink){
          h+=`<button style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;color:#3B82F6;padding:5px 10px;cursor:pointer;font-size:10px;font-family:'DM Sans',sans-serif;display:flex;align-items:center;gap:4px" data-action="view-loi" data-id="${d.id}">${IC.doc} View LOI</button>`;
        } else {
          h+=`<button style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;color:#16A34A;padding:5px 10px;cursor:pointer;font-size:10px;font-family:'DM Sans',sans-serif;display:flex;align-items:center;gap:4px" data-action="open-loi" data-id="${d.id}">${IC.doc} Generate LOI</button>`;
        }
      }
      h+=`<button class="btn-delete" data-action="del-deal" data-id="${d.id}">${IC.trash} Remove</button></div></div>`;
    }
    h+=`</div>`;
  });
  h+=`</div><div class="bottom-bar"><button class="btn-primary" data-action="add-deal-form">${IC.plus} New Deal</button><button class="btn-secondary" data-action="push-cal" data-value="acquisitions">${IC.cal}</button></div>`;
  return h;
}

// ---- DUE DILIGENCE ----
function rDD(){
  let h=`<div class="content">`;
  if(!state.ddDeals.length)h+=`<div class="empty-state"><h3>No active DD checklists</h3><p>Add one to start tracking</p></div>`;
  state.ddDeals.forEach(dd=>{
    const ex=state.expandedDD===dd.id,done=(dd.tasks||[]).filter(t=>t.completed).length,tot=(dd.tasks||[]).length,pct=tot?Math.round(done/tot*100):0;
    const dtc=dd.closingDate?Math.ceil((new Date(dd.closingDate+"T00:00:00")-new Date())/864e5):null;
    h+=`<div class="card"><div class="card-header" data-action="tog-dd" data-id="${dd.id}"><div class="card-body"><div class="card-title">${esc(dd.dealName)}</div><div class="progress-container" style="margin:6px 0 4px"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${pct===100?'#10B981':'#3B82F6'}"></div></div><span class="progress-text" style="color:${pct===100?'#10B981':'#3B82F6'}">${pct}%</span></div><div style="display:flex;gap:12px"><span style="font-size:10px;color:#94A3B8">${done}/${tot} complete</span>`;
    if(dtc!==null)h+=`<span style="font-size:10px;color:${dtc<14?'#EF4444':'#94A3B8'};font-weight:${dtc<14?'600':'400'}">${dtc>0?dtc+' days to close':'Past closing date'}</span>`;
    h+=`</div></div><span class="chevron ${ex?'open':''}">${IC.chev}</span></div>`;
    if(ex){
      h+=`<div class="card-expanded">`;
      (dd.tasks||[]).forEach(t=>{
        const od=overdue(t.dueDate)&&!t.completed;
        h+=`<div class="task-item"><div class="checkbox" data-action="tog-ddt" data-id="${dd.id}" data-id2="${t.id}">${chk(t.completed)}</div><div style="flex:1"><div class="task-text ${t.completed?'completed':''}">${esc(t.text)}</div>${t.dueDate?`<div class="task-meta"><span class="${od?'overdue':''}">Due ${fmtDate(t.dueDate)}</span></div>`:''}</div><button style="background:none;border:none;color:#CBD5E1;cursor:pointer;padding:2px" data-action="del-ddt" data-id="${dd.id}" data-id2="${t.id}">${IC.trash}</button></div>`;
      });
      h+=`<button class="add-task-btn" data-action="add-ddt" data-id="${dd.id}">${IC.plus} Add Task</button><div class="card-actions" style="margin-top:8px"><button class="btn-delete" data-action="del-dd" data-id="${dd.id}">${IC.trash} Remove Checklist</button></div></div>`;
    }
    h+=`</div>`;
  });
  h+=`</div><div class="bottom-bar"><button class="btn-primary" data-action="add-dd">${IC.plus} New DD Checklist</button><button class="btn-secondary" data-action="push-cal" data-value="dd">${IC.cal}</button></div>`;
  return h;
}

// ---- ASSET MANAGEMENT ----
function rAM(){
  let h=`<div class="content">`;
  if(!state.properties.length)h+=`<div class="empty-state"><h3>No properties yet</h3><p>Add a property to start tracking</p></div>`;
  state.properties.forEach(p=>{
    const ex=state.expandedProperty===p.id,at=(p.tasks||[]).filter(t=>!t.completed),odt=at.filter(t=>overdue(t.dueDate));
    h+=`<div class="card"><div class="card-header" data-action="tog-prop" data-id="${p.id}"><div class="card-body"><div class="property-icon">${IC.bldg}<span class="card-title" style="margin:0">${esc(p.name)}</span></div><div class="card-subtitle" style="padding-left:20px">${esc(p.address)}</div><div class="property-stats"><span>NOI: ${fmt$(p.noi)}</span><span>Tenant: ${esc(p.tenant)}</span></div><div class="task-badges">${at.length?`<span class="badge badge-blue">${at.length} task${at.length>1?'s':''}</span>`:''}${odt.length?`<span class="badge badge-red">${odt.length} overdue</span>`:''}</div></div><span class="chevron ${ex?'open':''}">${IC.chev}</span></div>`;
    if(ex){
      h+=`<div class="card-expanded">`;
      (p.tasks||[]).forEach(t=>{
        const pr=pri(t.priority),od=overdue(t.dueDate)&&!t.completed;
        h+=`<div class="task-item"><div class="checkbox" data-action="tog-amt" data-id="${p.id}" data-id2="${t.id}">${chk(t.completed)}</div><div style="flex:1"><div class="task-text ${t.completed?'completed':''}">${esc(t.text)}</div><div class="task-meta"><span class="priority-${t.priority}">${pr.label}</span>${t.dueDate?`<span class="${od?'overdue':''}">Due ${fmtDate(t.dueDate)}</span>`:''}</div></div><button style="background:none;border:none;color:#CBD5E1;cursor:pointer;padding:2px" data-action="del-amt" data-id="${p.id}" data-id2="${t.id}">${IC.trash}</button></div>`;
      });
      h+=`<button class="add-task-btn" data-action="add-amt" data-id="${p.id}">${IC.plus} Add Task</button><div class="card-actions" style="margin-top:8px"><button class="btn-delete" data-action="del-prop" data-id="${p.id}">${IC.trash} Remove Property</button></div></div>`;
    }
    h+=`</div>`;
  });
  h+=`</div><div class="bottom-bar"><button class="btn-primary" data-action="add-prop">${IC.plus} Add Property</button><button class="btn-secondary" data-action="push-cal" data-value="am">${IC.cal}</button></div>`;
  return h;
}

// ---- ADD DEAL FORM (with 3 links + broker phone/email) ----
function rAddDeal(){
  const nd=state.newDeal;
  let h=`<div class="overlay"><div class="overlay-header"><h2>New Deal</h2><button class="overlay-close" data-action="close-overlay">✕</button></div><div class="overlay-body">`;
  h+=`<div class="field"><label>Deal Name *</label><input data-field="nd-name" value="${esc(nd.name)}" placeholder="Dollar General NNN - Austin, TX"></div>`;
  h+=`<div class="field"><label>Address</label><input data-field="nd-address" value="${esc(nd.address)}" placeholder="4521 W Parker Rd, Plano, TX"></div>`;

  // 3 Link fields
  h+=`<div style="margin:12px 0 6px;font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px">Links</div>`;
  h+=`<div class="field"><label>Listing Link (Crexi / CoStar)</label><input data-field="nd-listing" value="${esc(nd.listingLink)}" placeholder="https://www.crexi.com/properties/..."></div>`;
  h+=`<div class="field"><label>Underwriting Link</label><input data-field="nd-uw" value="${esc(nd.uwLink)}" placeholder="https://docs.google.com/spreadsheets/..."></div>`;
  h+=`<div class="field"><label>CoStar Property Page</label><input data-field="nd-costar" value="${esc(nd.costarLink)}" placeholder="https://product.costar.com/detail/all-properties/..."></div>`;
  h+=`<div class="field"><label>Offering Memorandum</label><input data-field="nd-om" value="${esc(nd.omLink)}" placeholder="Link to OM PDF or document"></div>`;

  h+=`<div class="field"><label>Property Type</label><div class="toggle-group">`;
  PROPERTY_TYPES.forEach(pt=>{h+=`<button class="toggle-btn ${nd.propertyType===pt.id?'active':''}" data-action="prop-type" data-value="${pt.id}">${pt.label}</button>`;});
  h+=`</div></div>`;
  h+=`<div class="field-row field-row-2"><div class="field"><label># of Tenants</label><input data-field="nd-tenants" value="${esc(nd.numTenants)}" placeholder="1"></div><div class="field"><label>WALT (yrs)</label><input data-field="nd-walt" value="${esc(nd.walt)}" placeholder="8.5"></div></div>`;
  h+=`<div class="field-row field-row-3"><div class="field"><label>Asking Price</label><input type="number" data-field="nd-price" value="${nd.askingPrice}" placeholder="4850000"></div><div class="field"><label>NOI</label><input type="number" data-field="nd-noi" value="${nd.noi}" placeholder="267750"></div><div class="field"><label>Cap Rate</label><input data-field="nd-cap" value="${nd.capRate}" placeholder="Auto" style="background:${nd.capRate?'#F0FDF4':'#F8FAFC'}"></div></div>`;
  h+=`<div class="field-row field-row-2"><div class="field"><label>Building Sq Ft</label><input type="number" data-field="nd-sqft" value="${nd.sqft}" placeholder="14820"></div><div class="field"><label>Acreage</label><input data-field="nd-acreage" value="${esc(nd.acreage)}" placeholder="1.25"></div></div>`;

  h+=`<div style="margin:12px 0 6px;font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px">Demographics & Scoring</div>`;
  h+=`<div class="field-row field-row-3"><div class="field"><label>3mi Population</label><input data-field="nd-pop" value="${esc(nd.pop3mi)}" placeholder="85000"></div><div class="field"><label>3mi Avg HH Income</label><input data-field="nd-ahi" value="${esc(nd.ahi3mi)}" placeholder="72000"></div><div class="field"><label>Vehicles/Day</label><input data-field="nd-vpd" value="${esc(nd.vehiclesPerDay)}" placeholder="22000"></div></div>`;
  h+=`<div class="field-row field-row-2"><div class="field"><label>Score (1-10)</label><input type="number" min="1" max="10" step="0.5" data-field="nd-score" value="${nd.score}" placeholder="7.5"></div><div class="field"></div></div>`;

  h+=`<div class="field-row field-row-2"><div class="field"><label>Priority</label><div style="display:flex;gap:4px">`;
  PRIORITIES.forEach(p=>{h+=`<button class="priority-btn" style="${nd.priority===p.id?`background:${p.bg};color:${p.color};border-color:${p.color}40;font-weight:700`:''}" data-action="set-pri" data-value="${p.id}">${p.label}</button>`;});
  h+=`</div></div><div class="field"><label>Broker / Source</label><input data-field="nd-broker" value="${esc(nd.broker)}" placeholder="Marcus & Millichap"></div></div>`;
  h+=`<div class="field"><label>Broker Contact</label><input data-field="nd-contact" value="${esc(nd.brokerContact)}" placeholder="Jake Simmons"></div>`;
  h+=`<div class="field-row field-row-2"><div class="field"><label>Broker Phone</label><input data-field="nd-phone" value="${esc(nd.brokerPhone)}" placeholder="(512) 555-0199"></div><div class="field"><label>Broker Email</label><input data-field="nd-email" value="${esc(nd.brokerEmail)}" placeholder="jake@broker.com"></div></div>`;
  h+=`<div class="field"><label>Notes</label><textarea data-field="nd-notes" placeholder="Deal context, traffic counts, rent bumps...">${esc(nd.notes)}</textarea></div>`;
  h+=`</div><div class="overlay-footer"><button class="btn-primary" style="width:100%" data-action="save-deal">Add Deal</button></div></div>`;
  return h;
}

// ---- COSTAR REVIEW OVERLAY ----
function rCostarReview(){
  const imp = state.costarImport;
  if (!imp) return "";
  const ext = imp.extracted;
  const uw = imp.uw;
  const nd = state.newDeal;
  const choice = state.costarNoiChoice;
  const uwInputs = uw && uw.inputs ? uw.inputs : {};
  const uwOutputs = uw && uw.outputs ? uw.outputs : {};

  let h = `<div class="overlay"><div class="overlay-header"><h2 style="display:flex;align-items:center;gap:8px">${IC.imp} CoStar Import</h2><button class="overlay-close" data-action="close-overlay">✕</button></div><div class="overlay-body">`;

  h += `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 12px;margin-bottom:14px">
    <div style="font-size:10px;font-weight:700;color:#3B82F6;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px">Imported from CoStar</div>
    <div style="font-size:12px;color:#1E293B;font-weight:600">${esc(ext.propertyName || ext.fullAddress)}</div>
    <div style="font-size:11px;color:#64748B;margin-top:2px">${esc(ext.fullAddress)}</div>
    ${ext.costarPropertyId ? `<div style="font-size:10px;color:#94A3B8;margin-top:4px">CoStar ID: ${esc(ext.costarPropertyId)}</div>` : ""}
  </div>`;

  h += `<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">CoStar Raw Data</div><div class="metrics-grid">`;
  [["Sale Price", ext.kpis.salePrice||"—"],["Building SF", ext.kpis.buildingSize||"—"],["Land Size", ext.kpis.landSize||"—"],["Year Built", ext.kpis.yearBuilt||"—"],["Asking Rent", ext.kpis.primaryRent||"—"],["Price/SF", ext.kpis.pricePerArea||"—"]].forEach(([l,v]) => {
    h += `<div class="metric-box"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:11px">${esc(v)}</div></div>`;
  });
  h += `</div></div>`;

  // Price/SF verification
  const calcPsf = ext.normalized.buildingSf > 0 ? ext.normalized.salePrice / ext.normalized.buildingSf : 0;
  const shownPsf = ext.normalized.pricePerSf || 0;
  if (calcPsf > 0 && shownPsf > 0 && Math.abs(calcPsf - shownPsf) > 1) {
    h += `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#DC2626">
      <strong>⚠ Price/SF Mismatch:</strong> Listed $${Math.round(shownPsf)}/SF but calculated $${Math.round(calcPsf)}/SF (Price ÷ SF). Verify the numbers.
    </div>`;
  }

  // Demographics + Traffic (if available)
  if (ext.demographics || ext.traffic) {
    const demo = ext.demographics || {};
    const traf = ext.traffic || {};
    const demoItems = [];
    if (demo.population3mi) demoItems.push(["3mi Pop", demo.population3mi]);
    if (demo.medianHHIncome3mi) demoItems.push(["3mi AHI", demo.medianHHIncome3mi]);
    if (traf.highestADT) demoItems.push(["Traffic ADT", traf.highestADT.toLocaleString() + (traf.highestRoad ? " (" + traf.highestRoad + ")" : "")]);
    if (demo.households3mi) demoItems.push(["Households", demo.households3mi]);
    if (demo.daytimeEmployees3mi) demoItems.push(["Daytime Emp", demo.daytimeEmployees3mi]);
    if (demoItems.length) {
      h += `<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Demographics & Traffic</div><div class="metrics-grid">`;
      demoItems.forEach(([l,v]) => { h += `<div class="metric-box"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:11px">${esc(String(v))}</div></div>`; });
      h += `</div></div>`;
    }
  }

  // NOI Choice
  h += `<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">NOI Selection</div>`;
  const calcNoi = uwOutputs.noi || 0;
  const calcActive = choice === "calculated";
  h += `<div style="border:2px solid ${calcActive?'#3B82F6':'#E2E8F0'};border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;background:${calcActive?'#EFF6FF':'#fff'}" data-action="costar-noi-choice" data-value="calculated">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:${calcActive?'#3B82F6':'#64748B'}">Calculated NOI</span><span style="font-size:14px;font-weight:800;color:${calcActive?'#1E293B':'#94A3B8'}">${fmt$(Math.round(calcNoi))}</span></div>
    <div style="font-size:10px;color:#94A3B8;line-height:1.5">Rent: $${(uwInputs.rentPsf||0).toFixed(2)}/SF · Vacancy: ${uwInputs.vacancyPct||0}% · Expenses: ${uwInputs.expenseRatioPct||0}%</div>
    ${calcActive ? `<div style="margin-top:6px;font-size:10px;color:#64748B">GPR: ${fmt$(Math.round(uwOutputs.gpr||0))} → EGI: ${fmt$(Math.round(uwOutputs.egi||0))} → NOI: ${fmt$(Math.round(calcNoi))}</div>` : ""}
  </div>`;
  const rawActive = choice === "raw";
  h += `<div style="border:2px solid ${rawActive?'#E8A838':'#E2E8F0'};border-radius:8px;padding:10px 12px;cursor:pointer;background:${rawActive?'#FFFBEB':'#fff'}" data-action="costar-noi-choice" data-value="raw">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:11px;font-weight:700;color:${rawActive?'#E8A838':'#64748B'}">Enter Manually</span><span style="font-size:10px;color:#94A3B8">I have actual NOI</span></div>
    <div style="font-size:10px;color:#94A3B8">Use your own NOI from rent roll, T12, or broker OM</div>
  </div></div>`;

  // Preview
  h += `<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Deal Preview</div><div class="metrics-grid">`;
  [["Name", nd.name||"—"],["Price", fmt$(nd.askingPrice)],["NOI", nd.noi?fmt$(nd.noi):"Manual"],["Cap Rate", nd.capRate?nd.capRate+"%":"—"],["Sq Ft", nd.sqft?fmtNum(nd.sqft):"—"],["Acreage", nd.acreage||"—"]].forEach(([l,v]) => {
    h += `<div class="metric-box"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:11px">${esc(String(v))}</div></div>`;
  });
  h += `</div></div></div>`;

  h += `<div class="overlay-footer" style="display:flex;gap:8px"><button class="btn-secondary" style="flex:1" data-action="costar-accept">Edit First</button><button class="btn-primary" style="flex:1" data-action="costar-save">${IC.plus} Add Deal Now</button></div></div>`;
  return h;
}

// ---- CREXI REVIEW OVERLAY ----
function rCrexiReview(){
  const imp = state.crexiImport;
  if (!imp) return "";
  const ext = imp.extracted;
  const nd = state.newDeal;

  let h = `<div class="overlay"><div class="overlay-header"><h2 style="display:flex;align-items:center;gap:8px">${IC.imp} Crexi Import</h2><button class="overlay-close" data-action="close-overlay">✕</button></div><div class="overlay-body">`;

  // Source badge
  h += `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px 12px;margin-bottom:14px">
    <div style="font-size:10px;font-weight:700;color:#EA580C;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px">Imported from Crexi</div>
    <div style="font-size:12px;color:#1E293B;font-weight:600">${esc(ext.address)}</div>
    <div style="font-size:10px;color:#94A3B8;margin-top:4px;word-break:break-all">${esc(ext.listingUrl)}</div>
  </div>`;

  // Raw data
  h += `<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Crexi Raw Data</div><div class="metrics-grid">`;
  [
    ["Asking Price", ext.askingPriceRaw || "—"],
    ["Building SF", ext.buildingSfRaw || "—"],
    ["Land Size", ext.landSizeRaw || "—"],
    ["Property Type", ext.propertyType || "—"],
    ["Sub Type", ext.subType || "—"],
    ["Year Built", ext.yearBuilt || "—"],
  ].forEach(([l,v]) => {
    h += `<div class="metric-box"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:11px">${esc(v)}</div></div>`;
  });
  h += `</div>`;

  // Extra info
  if (ext.zoning || ext.apn) {
    h += `<div class="metrics-grid" style="margin-top:8px">`;
    if (ext.zoning) h += `<div class="metric-box"><div class="metric-label">Zoning</div><div class="metric-value" style="font-size:11px">${esc(ext.zoning)}</div></div>`;
    if (ext.apn) h += `<div class="metric-box"><div class="metric-label">APN</div><div class="metric-value" style="font-size:11px">${esc(ext.apn)}</div></div>`;
    h += `</div>`;
  }

  // Documents found
  if (ext.documents && ext.documents.length) {
    h += `<div style="margin-top:10px;background:#F8FAFC;border-radius:6px;padding:8px 10px"><div style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600">Documents Found (${ext.documents.length})</div>`;
    ext.documents.slice(0, 5).forEach(doc => {
      h += `<div style="font-size:11px;color:#475569;padding:2px 0">📄 ${esc(doc.label)}</div>`;
    });
    if (ext.documents.length > 5) h += `<div style="font-size:10px;color:#94A3B8;margin-top:2px">+${ext.documents.length - 5} more</div>`;
    h += `</div>`;
  }
  h += `</div>`; // close raw data section

  // Price/SF verification for Crexi
  const crexiPrice = ext.normalized ? ext.normalized.askingPrice : 0;
  const crexiSf = ext.normalized ? ext.normalized.buildingSf : 0;
  if (crexiPrice > 0 && crexiSf > 0) {
    const crexiCalcPsf = crexiPrice / crexiSf;
    h += `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:6px 10px;margin-top:8px;margin-bottom:10px;font-size:10px;color:#16A34A;font-weight:600">
      Calculated Price/SF: $${Math.round(crexiCalcPsf)}/SF
    </div>`;
  }

  // NOI note
  h += `<div style="margin-bottom:14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px">
    <div style="font-size:11px;color:#92400E;font-weight:600">NOI not available from Crexi</div>
    <div style="font-size:10px;color:#A16207;margin-top:3px">You'll need to enter NOI manually from the OM, rent roll, or broker package.</div>
  </div>`;

  // Preview
  h += `<div style="margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Deal Preview</div><div class="metrics-grid">`;
  const ptLabel = PROPERTY_TYPES.find(p => p.id === nd.propertyType)?.label || nd.propertyType;
  [["Name", nd.name||"—"],["Price", fmt$(nd.askingPrice)],["Sq Ft", nd.sqft?fmtNum(nd.sqft):"—"],["Acreage", nd.acreage||"—"],["Type", ptLabel],["NOI", "Manual entry"]].forEach(([l,v]) => {
    h += `<div class="metric-box"><div class="metric-label">${l}</div><div class="metric-value" style="font-size:11px">${esc(String(v))}</div></div>`;
  });
  h += `</div></div></div>`;

  h += `<div class="overlay-footer" style="display:flex;gap:8px"><button class="btn-secondary" style="flex:1" data-action="crexi-accept">Edit First</button><button class="btn-primary" style="flex:1" data-action="crexi-save">${IC.plus} Add Deal Now</button></div></div>`;
  return h;
}

// ---- LOI GENERATION OVERLAY ----
function rLOI(){
  const deal = state.deals.find(d => d.id === state.loiDealId);
  if (!deal) return "";

  const price = parseFloat(state.loiPrice) || 0;
  const deposit = price * 0.015;
  const autoText = state.loiPriceText || "";

  let h = `<div class="overlay"><div class="overlay-header"><h2 style="display:flex;align-items:center;gap:8px">${IC.doc} Generate LOI</h2><button class="overlay-close" data-action="close-overlay">✕</button></div><div class="overlay-body">`;

  // Deal info banner
  h += `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:10px 12px;margin-bottom:14px">
    <div style="font-size:10px;font-weight:700;color:#16A34A;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px">Letter of Intent</div>
    <div style="font-size:12px;color:#1E293B;font-weight:600">${esc(deal.name)}</div>
    <div style="font-size:11px;color:#64748B;margin-top:2px">${esc(deal.address)}</div>
    <div style="font-size:10px;color:#94A3B8;margin-top:4px">Asking: ${fmt$(deal.askingPrice)} · ${deal.capRate}% cap</div>
  </div>`;

  // Property address (read-only)
  h += `<div class="field"><label>Property Address</label><input value="${esc(deal.address)}" disabled style="background:#F1F5F9;color:#64748B"></div>`;

  // Offer date
  h += `<div class="field"><label>Offer Date *</label><input type="date" data-field="loi-date" value="${state.loiOfferDate}"></div>`;

  // LOI Price
  h += `<div class="field"><label>LOI Price (Offer Amount) *</label><input type="number" data-field="loi-price" value="${state.loiPrice}" placeholder="Enter your offer price"></div>`;

  // Price in words (auto-generated, editable)
  h += `<div class="field"><label>Purchase Price Text</label><input data-field="loi-price-text" value="${esc(autoText)}" placeholder="Auto-generated from price above" style="font-size:11px"></div>`;

  // Deposit display
  h += `<div class="field-row field-row-2">
    <div class="field"><label>Deposit (1.5%)</label><div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:700;color:#1E293B" id="loi-deposit-display">${deposit > 0 ? fmt$(deposit) : "—"}</div></div>
    <div class="field"><label>Template</label><div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:9px 12px;font-size:11px;color:#64748B">LOI Template v1</div></div>
  </div>`;

  // Preview summary
  if (price > 0) {
    h += `<div style="margin:14px 0;background:#F8FAFC;border-radius:8px;padding:10px 12px">
      <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">LOI Preview</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div><span style="font-size:9px;color:#94A3B8;text-transform:uppercase">Offer Price</span><div style="font-size:13px;font-weight:700">${fmt$(price)}</div></div>
        <div><span style="font-size:9px;color:#94A3B8;text-transform:uppercase">Deposit</span><div style="font-size:13px;font-weight:700">${fmt$(deposit)}</div></div>
        <div><span style="font-size:9px;color:#94A3B8;text-transform:uppercase">vs Asking</span><div style="font-size:13px;font-weight:700;color:${price < deal.askingPrice ? '#EF4444' : '#10B981'}">${deal.askingPrice > 0 ? ((price/deal.askingPrice - 1) * 100).toFixed(1) + "%" : "—"}</div></div>
        <div><span style="font-size:9px;color:#94A3B8;text-transform:uppercase">Date</span><div style="font-size:13px;font-weight:700">${state.loiOfferDate || "—"}</div></div>
      </div>
    </div>`;
  }

  h += `</div>`; // end overlay-body

  // Footer
  if (state.loiGenerating) {
    h += `<div class="overlay-footer"><button class="btn-primary" style="width:100%;opacity:0.7;pointer-events:none">Generating LOI...</button></div>`;
  } else {
    h += `<div class="overlay-footer"><button class="btn-primary" style="width:100%;background:#16A34A" data-action="generate-loi">${IC.doc} Create LOI Document</button></div>`;
  }

  h += `</div>`;
  return h;
}

// ==================== INIT ====================
async function init(){
  const r=await sendMsg({type:"AUTH_CHECK"});
  if(r.success){
    state.authenticated=true;
    await loadAll();
    startImportPolling();
  }
  render();
}
init();