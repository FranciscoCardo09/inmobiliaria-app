# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack real estate management SaaS (inmobiliaria) for managing properties, tenants, contracts, rent payments, debts, and reports. Multi-tenant architecture where users belong to groups.

## Tech Stack

- **Backend**: Node.js + Express + Prisma ORM + PostgreSQL (SQLite in dev)
- **Frontend**: React 18 + Vite + Tailwind CSS + DaisyUI + Zustand + TanStack Query
- **Auth**: JWT + Google OAuth 2.0 (Passport.js)
- **Notifications**: Resend (email), Twilio (SMS/WhatsApp)
- **Documents**: PDFKit, ExcelJS, docx

## Development Commands

```bash
# Backend (port 3001)
cd inmobiliaria-app/backend
npm install
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema to DB
npm run db:seed        # Seed test data
npm run db:studio      # Prisma Studio GUI
npm run dev            # Start with nodemon

# Frontend (port 5173, proxies /api → :3001)
cd inmobiliaria-app/frontend
npm install
npm run dev
npm run build          # Production build to dist/
npm run lint           # ESLint (max-warnings=0)
```

No automated test suite is configured. Manual testing via `postman_collection.json`.

## Architecture

```
inmobiliaria-app/
├── backend/src/
│   ├── app.js              # Express entry point
│   ├── config/             # Env config + Passport OAuth
│   ├── controllers/        # Request handlers
│   ├── services/           # Business logic (debts, payments, notifications, reports)
│   ├── routes/             # API route definitions (aggregated in routes/index.js)
│   ├── middleware/         # Auth middleware, error handling
│   ├── validators/         # Zod schemas
│   └── utils/
├── backend/prisma/
│   ├── schema.prisma       # Database schema (~727 lines)
│   ├── migrations/
│   └── seed.js
└── frontend/src/
    ├── pages/              # Route-level components
    ├── components/         # Shared UI (layout/, forms/, ui/, notifications/)
    ├── hooks/              # Custom hooks (useAuth, useDebts, usePayments, etc.)
    ├── stores/             # Zustand stores (authStore, groupStore)
    ├── services/api.js     # Axios client with interceptors
    └── utils/
```

## Key Patterns

- **Multi-tenant**: All data endpoints scoped under `/api/groups/:gid/...`
- **Auth**: JWT Bearer tokens; refresh token rotation; roles: ADMIN, OPERATOR, VIEWER
- **Controller → Service → Prisma**: Controllers handle HTTP, services contain business logic
- **Frontend state**: Zustand for auth/group state (persisted to localStorage), TanStack Query for server data
- **Frontend routing**: Protected routes via auth check in App.jsx; Vite proxy in dev

## Database

Prisma with PostgreSQL (Supabase in prod, SQLite in dev). Key models: User, Group, Property, Owner, Tenant, Contract, Payment, PaymentTransaction, Debt, DebtPayment, MonthlyRecord, NotificationLog.

Punitory (late fee) rate is configurable per Group (default 0.6% daily).

## Deployment

- **DB**: Supabase PostgreSQL
- **Backend**: Render
- **Frontend**: Vercel (config in `vercel.json`)
- See `DEPLOY_INSTRUCTIONS.md` and `GOOGLE_OAUTH_SETUP.md` for details

## Language

The application UI and business domain are in Spanish. Code (variable names, comments) mixes Spanish and English.
