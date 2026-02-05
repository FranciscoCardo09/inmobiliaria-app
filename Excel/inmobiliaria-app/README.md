# Sistema de Gestion Inmobiliaria - Fase 1.5

Sistema web completo para gestión de propiedades inmobiliarias, inquilinos, pagos y deudas.

## Fase 1: Setup + Autenticación + Grupos
## Fase 1.5: Google OAuth (NUEVO)

### Features Implementadas

- [x] Registro de usuarios (email/password)
- [x] Login con JWT (access + refresh tokens)
- [x] **Google OAuth 2.0 Login** (NUEVO)
- [x] **Google OAuth 2.0 Register** (NUEVO)
- [x] Crear grupos/inmobiliarias
- [x] Invitar usuarios a grupos
- [x] Aceptar invitaciones
- [x] Roles: ADMIN, OPERATOR, VIEWER
- [x] Multi-tenancy (usuarios en múltiples grupos)
- [x] UI responsive con Tailwind + DaisyUI
- [x] Protected routes
- [x] **Avatar de Google en header** (NUEVO)

## Tech Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS + DaisyUI |
| State | Zustand + TanStack Query |
| Backend | Node.js + Express |
| ORM | Prisma |
| Database | PostgreSQL (Supabase) / SQLite (dev) |
| Auth | JWT + bcrypt + **Passport.js + Google OAuth** |

## Estructura del Proyecto

```
inmobiliaria-app/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.js
│   └── src/
│       ├── controllers/
│       │   ├── authController.js
│       │   └── groupsController.js
│       ├── routes/
│       ├── middleware/
│       ├── utils/
│       └── app.js
└── frontend/
    └── src/
        ├── components/
        ├── pages/
        ├── hooks/
        ├── stores/
        └── services/
```

## Instalación Local

### 1. Clonar y configurar

```bash
cd inmobiliaria-app

# Backend
cd backend
cp .env.example .env
# Editar .env con tu DATABASE_URL de Supabase
npm install
npm run db:generate
npm run db:push
npm run db:seed

# Frontend
cd ../frontend
cp .env.example .env.local
npm install
```

### 2. Ejecutar en desarrollo

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### 3. Acceder

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## Credenciales de Prueba

| Email | Password | Rol |
|-------|----------|-----|
| admin@hh.com | Password123 | ADMIN |
| paco@hh.com | Password123 | OPERATOR |
| pedro@hh.com | Password123 | VIEWER |

## API Endpoints

### Auth

```
POST /api/auth/register   # Registrar usuario
POST /api/auth/login      # Login
POST /api/auth/refresh    # Renovar token
GET  /api/auth/me         # Usuario actual
POST /api/auth/logout     # Cerrar sesión
```

### Groups

```
GET    /api/groups              # Listar mis grupos
POST   /api/groups              # Crear grupo
GET    /api/groups/:id          # Detalle grupo
PUT    /api/groups/:id          # Actualizar grupo
DELETE /api/groups/:id          # Eliminar grupo
```

### Members & Invites

```
GET    /api/groups/:id/members         # Listar miembros
PUT    /api/groups/:id/members/:uid    # Cambiar rol
DELETE /api/groups/:id/members/:uid    # Remover miembro
POST   /api/groups/:id/invite          # Invitar usuario
GET    /api/groups/:id/invites         # Listar invitaciones
POST   /api/invites/:token/accept      # Aceptar invitación
```

## Deploy

### Supabase (Database)

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Copiar connection string de Settings > Database
3. Agregar a `.env` como `DATABASE_URL`

### Render (Backend)

1. Crear Web Service en [render.com](https://render.com)
2. Conectar repositorio
3. Build command: `cd backend && npm install && npm run db:generate`
4. Start command: `cd backend && npm start`
5. Environment variables:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
   - `FRONTEND_URL`

### Vercel (Frontend)

1. Importar proyecto en [vercel.com](https://vercel.com)
2. Root directory: `frontend`
3. Environment variables:
   - `VITE_API_URL=https://tu-backend.onrender.com/api`

## Screenshots

### Login
![Login](docs/login.png)

### Dashboard
![Dashboard](docs/dashboard.png)

### Crear Grupo
![Crear Grupo](docs/create-group.png)

## Próximas Fases

- **Fase 2**: Propiedades + Categorías
- **Fase 3**: Inquilinos + Contratos
- **Fase 4**: Pagos + Conceptos
- **Fase 5**: Deudas + Cierre Mensual
- **Fase 6**: Reportes PDF + Excel
- **Fase 7**: Dashboard + UI Polish
- **Fase 8**: API Docs + Testing

## Licencia

MIT
