# CREFlow

A Chrome extension for commercial real estate professionals. Manages the full deal lifecycle — from sourcing on CoStar/Crexi through due diligence and asset management — with automatic sync to Google Workspace.

## What It Does

**Deal Pipeline (Acquisitions)**
Tracks deals across stages: Prospecting → Underwriting → LOI Submitted → LOI Accepted → Under PSA → Closed/Dead. Each deal stores financials (asking price, NOI, cap rate, SF), broker info, demographics, traffic counts, links, and a call log. Deals can be flagged as hot, filtered, and scored.

**One-Click Import from CoStar & Crexi**
Content scripts inject an "Import to CREFlow" button on property detail pages. Clicking it scrapes address, sale price, building size, demographics (population, AHI at 1/3/10 mi), and traffic (ADT) from CoStar, or address, price, SF, zoning, and documents from Crexi. Data is passed to the side panel for review before saving.

**Due Diligence Tracking**
Promotes acquisitions deals into a DD checklist (title, environmental, lease review, estoppels, etc.). Creates a Google Drive folder per deal, generates a Deal Data doc, and creates per-tenant subfolders by syncing from the underwriting spreadsheet's rent roll.

**Asset Management**
Tracks owned properties with tenant info, NOI, lease expiry, and task lists.

**Google Sheets Sync**
All data is stored in a single Google Sheets workbook (`CREFlow Data`) with three tabs: Acquisitions, DueDiligence, AssetManagement. Changes sync bidirectionally on demand.

**LOI Generation**
Generates a Letter of Intent Google Doc by copying a Drive template and replacing placeholders (offer date, address, purchase price, deposit).

**Underwriting Generation**
Copies a Google Sheets UW template into a new deal folder, pre-fills deal financials across multiple tabs (Analysis, Call to Broker, Rent Roll, Expenses), and adjusts row counts to match the number of tenants.

**Automated Calendar & Notifications**
- **8:00 AM** — Chrome notification with deal count, DD task count, and AM task count
- **10:00 AM** — Pushes three Google Calendar events: DD focus, acquisitions pipeline review, AM EOD tasks
- **Every 6 hours** — Stale deal check (notifies if any active deal has had no activity in 7+ days)
- **LOI follow-ups** — Scheduled reminders at 3 days and 7 days after LOI submission

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension config, permissions, OAuth2 scopes |
| `background.js` | Service worker — Google API calls, alarms, message handler |
| `sidepanel.html/js` | Main UI rendered in Chrome's side panel |
| `costar-scraper.js` | Content script injected on `product.costar.com` |
| `crexi-scraper.js` | Content script injected on `www.crexi.com/properties/*` |
| `styles.css` | Side panel styles |

## Setup

See `SETUP.md` for installation instructions and Google OAuth configuration.

## Permissions Used

- `sidePanel` — side panel UI
- `identity` — Google OAuth2 login
- `storage` — local state and spreadsheet ID
- `alarms` — scheduled daily pushes
- `notifications` — morning summary and stale deal alerts
- `activeTab` / `scripting` — content script injection
- Google APIs: Sheets, Calendar, Drive, Docs
