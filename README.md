# Abhinav — Field Sales Tracking & CRM Sync Platform

A full-stack field force management system for sales teams — geo-fenced attendance, live location tracking, shop/visit management, and two-way sync with Zoho CRM. Built with Node.js/Express on the backend and Flutter (Android, iOS, and Web) on the frontend.

## What it does

Sales representatives use the mobile app to check in/out at their assigned locations, log shop visits with photos and call logs, and work offline when there's no signal. Admins use the same system to assign shops to salesmen, review and approve newly added shops, monitor live location in real time, and pull attendance/visit reports — with shop and customer data kept in sync with Zoho CRM automatically.

## Key Features

**Attendance & Location**
- Geo-fenced check-in / check-out — location is matched against configured company locations before attendance is accepted
- Live location tracking via an Android/iOS foreground background service (keeps reporting location even when the app is backgrounded)
- Location history and route playback on a map

**Shop & Visit Management**
- Add, edit, and soft-delete shops, with GST lookup and shop image upload
- Call log tracking per shop (by phone number or manual entry)
- Shop visit logging with photos (EXIF metadata captured) and notes
- Bulk shop import from Excel/CSV

**Approval Workflow**
- New shops added in the field go into a **pending** queue
- Admins approve or reject pending shops before they become active

**Offline-First**
- Shop and visit data is cached locally with Hive when the device is offline
- Automatically syncs to the backend once connectivity is restored

**Zoho CRM Integration**
- OAuth2 token management with automatic refresh and caching
- Scheduled cron jobs keep shop/customer records in sync between the app's database and Zoho CRM

**Admin Tools**
- Assign shops to specific salesmen
- User management (add/edit sales staff)
- Attendance, visit, and sales-order reports
- Dashboard with team activity overview

**Cross-Platform**
- Single Flutter codebase targets Android, iOS, and Web — with platform-specific implementations (and web-safe stubs) for camera and location access

## Tech Stack

**Backend**
- Node.js, Express
- Microsoft SQL Server (`mssql`) — primary relational data
- AWS DynamoDB — supplementary data store
- Zoho CRM API (OAuth2)
- `node-cron` scheduled jobs for CRM sync
- Multer-based image upload handling

**Frontend**
- Flutter (Android, iOS, Web)
- Firebase (Crashlytics for crash reporting)
- Hive — local offline storage
- `flutter_background_service` + `geolocator` — background location tracking
- `permission_handler`, `exif`, `shared_preferences`

## Project Structure

```
backend/
├── src/
│   ├── controllers/     # attendance, shops, visits, live location, CSV, pending approvals
│   ├── routes/           # one route file per feature
│   ├── middleware/       # auth, image upload
│   ├── services/         # Zoho CRM integration
│   ├── models/            # attendance, location
│   ├── config/             # SQL Server + DynamoDB connections
│   └── server.js
├── zohoCacheJob.js         # background token/cache job
└── syncShopDetailsFromZoho.js  # scheduled Zoho ↔ DB sync

app/
├── lib/
│   ├── screens/           # ~25 screens — dashboard, shop CRUD, attendance, reports, admin
│   ├── services/           # API, auth, offline sync, background location, call logs
│   ├── models/              # shop, user, attendance, offline queue
│   └── helpers/              # location, camera, EXIF (with web-safe stubs)
```

## Setup

### Backend
```bash
cd backend
npm install
```
Create a `.env` file with your SQL Server, DynamoDB, and Zoho CRM credentials, then:
```bash
npm start
```

### Flutter App
```bash
cd app
flutter pub get
flutter run
```
Location and phone permissions are requested on first launch (Android/iOS) to enable attendance and call-log features.
