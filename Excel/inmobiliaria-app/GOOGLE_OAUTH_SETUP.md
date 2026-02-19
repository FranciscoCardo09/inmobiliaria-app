# Configuracion de Google OAuth 2.0

## Paso 1: Crear Proyecto en Google Cloud Console

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Crear un nuevo proyecto o seleccionar uno existente
3. Nombre sugerido: `inmobiliaria-app`

## Paso 2: Habilitar API

1. En el menu lateral: **APIs & Services** > **Library**
2. Buscar "Google+ API" y habilitarla (o "Google Identity")
3. Buscar "Google People API" y habilitarla

## Paso 3: Configurar OAuth Consent Screen

1. Ir a **APIs & Services** > **OAuth consent screen**
2. Seleccionar **External** (para usuarios fuera de tu organizacion)
3. Completar:
   - **App name**: `Gestion Alquileres`
   - **User support email**: tu email
   - **Developer contact**: tu email
4. En Scopes, agregar:
   - `./auth/userinfo.email`
   - `./auth/userinfo.profile`
5. En Test users, agregar tu email para pruebas

## Paso 4: Crear Credenciales OAuth 2.0

1. Ir a **APIs & Services** > **Credentials**
2. Click en **+ CREATE CREDENTIALS** > **OAuth client ID**
3. Seleccionar **Web application**
4. Configurar:
   - **Name**: `Inmobiliaria Web Client`
   - **Authorized JavaScript origins**:
     ```
     http://localhost:3001
     http://localhost:5173
     https://tu-backend.onrender.com (para produccion)
     ```
   - **Authorized redirect URIs**:
     ```
     http://localhost:3001/api/auth/google/callback
     https://tu-backend.onrender.com/api/auth/google/callback (para produccion)
     ```
5. Click en **CREATE**
6. Copiar **Client ID** y **Client Secret**

## Paso 5: Configurar Variables de Entorno

### Desarrollo Local

Editar `backend/.env`:

```env
GOOGLE_CLIENT_ID="123456789-abcdefg.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-abcdefghijklmnop"
GOOGLE_CALLBACK_URL="http://localhost:3001/api/auth/google/callback"
```

### Produccion (Render)

En Render Dashboard > Environment:

```
GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnop
GOOGLE_CALLBACK_URL=https://tu-backend.onrender.com/api/auth/google/callback
```

## Paso 6: Probar

1. Iniciar backend: `cd backend && npm run dev`
2. Iniciar frontend: `cd frontend && npm run dev`
3. Abrir http://localhost:5173/login
4. Click en "Continuar con Google"
5. Seleccionar cuenta de Google
6. Deberia redirigir al Dashboard

## Flujo de Autenticacion

```
Usuario                 Frontend                Backend                Google
  |                        |                       |                      |
  |-- Click Google ------->|                       |                      |
  |                        |-- Redirect ---------->|                      |
  |                        |                       |-- OAuth Request ---->|
  |                        |                       |                      |
  |<---------------------- Google Login Page -------------------------|  |
  |                        |                       |                      |
  |-- Select Account ----->|                       |<-- User Info --------|
  |                        |                       |                      |
  |                        |<-- Callback + JWT ----|                      |
  |                        |                       |                      |
  |<-- Dashboard ----------|                       |                      |
```

## Troubleshooting

### Error: "redirect_uri_mismatch"

- Verificar que la URI de callback en Google Console coincida EXACTAMENTE con `GOOGLE_CALLBACK_URL`
- Incluir el protocolo (http:// o https://)
- No incluir espacios extra

### Error: "Access blocked: app not verified"

- Normal en modo desarrollo
- Click en "Avanzado" > "Ir a inmobiliaria-app (no seguro)"
- Para produccion, verificar la app en Google Console

### Error: "invalid_client"

- Verificar que `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` sean correctos
- Regenerar credenciales si es necesario

## Seguridad

- **NUNCA** commitear credenciales de Google en el repositorio
- Usar variables de entorno
- En produccion, restringir los dominios autorizados
- Configurar CSP headers apropiados
