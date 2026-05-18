# Finance POS System

A straightforward POS and finance tracking system for:
- income and expense transactions
- spares and service sales
- business expense recording
- admin-only user creation
- category-based reporting
- receipt printing support

## Features

- Secure login with `admin` and `staff` roles
- Admin can create new users
- Admin can reset staff password and get a new temporary password (for forgot-password support)
- Admin can edit transactions
- Admin can edit or remove staff accounts
- Staff can enter transactions
- Income and expense categories
- Staff view is simplified for easier daily use
- Currency displayed in Tanzanian Shillings (TZS)
- Default view shows today's transactions for both admin and staff
- Admin-only archive mode can view older transactions
- Dashboard totals:
  - total income
  - total expense
  - balance
- Filters by date, type, and search text
- Description input remembers previously used transaction names for faster entry
- Basic printable receipt per transaction
- SQLite database for persistent local data

## Tech Stack

- Node.js + Express
- SQLite (`better-sqlite3`)
- Vanilla HTML/CSS/JavaScript frontend

## Installation

1. Open terminal in project folder.
2. Install dependencies:

```bash
npm install
```

3. Create environment file:

```bash
cp .env.example .env
```

4. Start server:

```bash
npm start
```

5. Open browser:

- `http://localhost:4000`

## Docker Installation

Run with Docker (recommended for consistent setup across devices):

```bash
docker compose up --build
```

Then open:
- `http://localhost:5050`

If you want another host port, set it in `.env`:

```bash
HOST_PORT=5050
```

## Default Login

- Username: `admin`
- Password: `admin123`

<span style="color:red"><strong>Important:</strong> Change these credentials immediately after first login because they are default credentials.</span>

## API Overview

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users` (admin only)
- `POST /api/users` (admin only)
- `PUT /api/users/:id` (admin only, staff only)
- `DELETE /api/users/:id` (admin only, staff only)
- `POST /api/users/:id/reset-password` (admin only, staff only)
- `GET /api/categories`
- `POST /api/categories` (admin only)
- `GET /api/transactions`
- `POST /api/transactions`
- `PUT /api/transactions/:id` (admin only)
- `GET /api/reports/summary`

## Vercel Deploy (Free Tier)

1. Install Vercel CLI and login.
2. Deploy:

```bash
vercel
```

3. Production deploy:

```bash
vercel --prod
```

Important: SQLite on Vercel uses temporary filesystem (`/tmp`), so data can reset. For stable production data, use a managed database (for example Neon, Supabase, or Vercel Postgres).

## Notes for Deploying on Any Device

Because this is a web app, it can run on any device that can access the server in a browser.

- Local install: run Node.js on laptop/desktop and open browser on same network.
- Server install: deploy to a small VPS/LAN server and let multiple devices connect by IP/domain.

## Future Upgrades

- Edit/delete transactions with audit trail
- PDF receipts
- Stock/inventory management for spares
- User activation/deactivation UI
- Automated backups
