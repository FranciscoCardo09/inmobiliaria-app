# Instrucciones de Deploy - Fase 1

## Deploy Local (YA FUNCIONANDO)

El proyecto ya está configurado y probado localmente con SQLite.

### Iniciar en desarrollo:

```bash
# Terminal 1 - Backend
cd /home/francisco/Excel/inmobiliaria-app/backend
npm run dev

# Terminal 2 - Frontend
cd /home/francisco/Excel/inmobiliaria-app/frontend
npm run dev
```

Abrir: http://localhost:5173

---

## Deploy a Producción

### 1. Supabase (Base de Datos PostgreSQL)

1. Ir a https://supabase.com y crear cuenta
2. Crear nuevo proyecto
3. En Settings > Database, copiar el **Connection string (URI)**
4. Guardar para el siguiente paso

### 2. Render (Backend)

1. Ir a https://render.com
2. New > Web Service
3. Conectar con GitHub (necesitas subir el repo primero)
4. Configurar:
   - **Name**: `inmobiliaria-api`
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npx prisma generate && npx prisma db push`
   - **Start Command**: `npm start`
   - **Environment Variables**:
     ```
     DATABASE_URL=postgresql://... (de Supabase)
     JWT_SECRET=genera-un-secret-largo-aleatorio
     JWT_REFRESH_SECRET=genera-otro-secret-largo-aleatorio
     FRONTEND_URL=https://tu-app.vercel.app
     NODE_ENV=production
     ```
5. Deploy

### 3. Vercel (Frontend)

1. Ir a https://vercel.com
2. Import Project > desde GitHub
3. Configurar:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite
   - **Environment Variables**:
     ```
     VITE_API_URL=https://tu-backend.onrender.com/api
     ```
4. Deploy

### 4. Ejecutar Seed en Producción

Después del deploy, ejecutar el seed para crear usuarios de prueba:

```bash
# En Render, usar la Shell o conectar con la DB directamente
npx prisma db seed
```

---

## Cambiar de SQLite a PostgreSQL

Para producción, actualizar `backend/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"  // Cambiar de "sqlite" a "postgresql"
  url      = env("DATABASE_URL")
}
```

Y agregar los enums:

```prisma
enum GlobalRole {
  SUPERADMIN
  USER
}

enum GroupRole {
  ADMIN
  OPERATOR
  VIEWER
}

enum InviteStatus {
  PENDING
  ACCEPTED
  REJECTED
  EXPIRED
}
```

---

## URLs de Deploy (Ejemplo)

Una vez desplegado:

- Frontend: `https://gestionalquileres.vercel.app`
- Backend: `https://inmobiliaria-api.onrender.com`
- API Health: `https://inmobiliaria-api.onrender.com/api/health`

## Credenciales de Prueba

| Email | Password | Rol |
|-------|----------|-----|
| admin@hh.com | Password123 | ADMIN |
| paco@hh.com | Password123 | OPERATOR |
| pedro@hh.com | Password123 | VIEWER |
