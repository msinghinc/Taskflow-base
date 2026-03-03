# TaskFlow Chrome Extension — Setup Guide

## Step 1: Enable Google APIs

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Make sure your **TaskFlow** project is selected in the top dropdown
3. Go to **APIs & Services → Library** (left sidebar)
4. Search for and enable these two APIs:
   - **Google Sheets API** — click it, then click "Enable"
   - **Google Calendar API** — click it, then click "Enable"

## Step 2: Create OAuth Credentials

1. Go to **APIs & Services → Credentials** (left sidebar)
2. Click **+ CREATE CREDENTIALS → OAuth client ID**
3. If it asks you to configure a consent screen first:
   - Choose **Internal** (this means only you can use it)
   - App name: `TaskFlow`
   - User support email: your work email
   - Developer contact: your work email
   - Click Save and Continue through the remaining steps (no need to add scopes manually)
   - Go back to Credentials
4. Click **+ CREATE CREDENTIALS → OAuth client ID** again
5. Application type: **Chrome Extension**
6. Name: `TaskFlow`
7. **Item ID**: You'll get this after loading the extension (Step 4). For now, leave this page open.

## Step 3: Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `taskflow-extension` folder
5. You'll see TaskFlow appear with an **ID** like `abcdefghijklmnop...`
6. **Copy this ID**

## Step 4: Finish OAuth Setup

1. Go back to the Google Cloud Console credentials page
2. Paste the extension ID into the **Item ID** field
3. Click **Create**
4. You'll get a **Client ID** (looks like `123456789-abcdef.apps.googleusercontent.com`)
5. Copy this Client ID

## Step 5: Add Your Client ID to the Extension

1. Open the `taskflow-extension` folder on your computer
2. Open `manifest.json` in any text editor
3. Find the line that says:
   ```
   "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com"
   ```
4. Replace `YOUR_CLIENT_ID_HERE.apps.googleusercontent.com` with your actual Client ID
5. Save the file

## Step 6: Reload and Connect

1. Go back to `chrome://extensions`
2. Click the **refresh icon** on the TaskFlow extension card
3. Click the TaskFlow icon in your toolbar (or pin it first)
4. The side panel should open with a "Connect Google Account" button
5. Click it and authorize with your Google account
6. Done! TaskFlow will automatically:
   - Create a Google Sheet called "TaskFlow Data" in your Drive
   - Set up calendar reminders at 11 AM, 4 PM, and 7 PM EST
   - Send morning desktop notifications

## How It Works

### Data Storage
All your data lives in a Google Sheet called "TaskFlow Data" with three tabs:
- **Acquisitions** — your deal pipeline
- **DueDiligence** — DD checklists and progress
- **AssetManagement** — owned properties and tasks

You can open this sheet on your phone anytime to see your data.

### Calendar Schedule
TaskFlow pushes to your Google Calendar daily:
- **11:00 AM EST** — Due Diligence checklist for the day
- **4:00 PM EST** — Acquisitions pipeline and stale deal alerts
- **7:00 PM EST** — Asset Management tasks (catch brokers/PM before EOD)

### Notifications
- **8:00 AM EST** — Morning desktop summary of all sections
- **Stale deal alerts** — When a deal has no activity for 7+ days

### Syncing
Changes auto-sync to Google Sheets within 1 second of any edit.

## Troubleshooting

**"Login failed" error:**
- Make sure you enabled both Google Sheets API and Google Calendar API
- Check that your OAuth consent screen is set to "Internal"
- Verify the Client ID in manifest.json matches what's in Google Cloud

**Extension doesn't appear in toolbar:**
- Right-click the puzzle piece icon in Chrome → Pin TaskFlow

**Calendar events not showing:**
- Click the calendar icon button in any section to manually push
- Check that Google Calendar API is enabled in your Cloud project

**Data not syncing:**
- Look for the green "Synced" indicator in the panel header
- If it says "Disconnected," try closing and reopening the panel
