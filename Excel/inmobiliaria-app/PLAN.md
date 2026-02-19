# FASE 5: Deudas + Punitorios + Bloqueo

## Resumen
Agregar sistema de deudas que se generan al cerrar un mes con pagos pendientes, con cálculo de punitorios acumulados, imputación de pagos (servicios primero), y bloqueo de pagos del mes actual si hay deudas abiertas.

---

## 5.1 Schema: Debt + DebtPayment

**Archivo:** `backend/prisma/schema.prisma`

```prisma
model Debt {
  id                  String   @id @default(uuid())
  groupId             String   @map("group_id")
  contractId          String   @map("contract_id")
  monthlyRecordId     String   @map("monthly_record_id")

  periodLabel         String   @map("period_label")    // "Noviembre 2025"
  periodMonth         Int      @map("period_month")
  periodYear          Int      @map("period_year")

  originalAmount      Float    @map("original_amount")      // Total que debía ese mes
  unpaidRentAmount    Float    @map("unpaid_rent_amount")    // Deuda post imputación servicios
  accumulatedPunitory Float    @default(0) @map("accumulated_punitory")

  currentTotal        Float    @map("current_total")         // unpaidRentAmount + punitorios
  amountPaid          Float    @default(0) @map("amount_paid")

  punitoryStartDate   DateTime @map("punitory_start_date")   // Desde cuándo cuentan punitorios
  lastPaymentDate     DateTime? @map("last_payment_date")

  status              String   @default("OPEN")              // OPEN, PARTIAL, PAID
  closedAt            DateTime? @map("closed_at")

  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  group               Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  contract            Contract  @relation(fields: [contractId], references: [id], onDelete: Cascade)
  monthlyRecord       MonthlyRecord @relation(fields: [monthlyRecordId], references: [id])
  payments            DebtPayment[]

  @@unique([monthlyRecordId])
  @@map("debts")
}

model DebtPayment {
  id              String   @id @default(uuid())
  debtId          String   @map("debt_id")
  paymentDate     DateTime @map("payment_date")
  amount          Float
  punitoryAtPayment Float  @map("punitory_at_payment")  // Punitorios al momento de pagar
  paymentMethod   String   @default("EFECTIVO") @map("payment_method")
  observations    String?
  createdAt       DateTime @default(now()) @map("created_at")

  debt            Debt     @relation(fields: [debtId], references: [id], onDelete: Cascade)

  @@map("debt_payments")
}
```

**Relaciones a agregar en modelos existentes:**
- `Group`: agregar `debts Debt[]`
- `Contract`: agregar `debts Debt[]`
- `MonthlyRecord`: agregar `debt Debt?`

---

## 5.2 DebtService

**Archivo nuevo:** `backend/src/services/debtService.js`

**Funciones:**

1. `createDebtFromMonthlyRecord(monthlyRecord, contract)` — Crea Debt cuando se cierra un mes impago
   - Calcula imputación: servicios primero, luego alquiler
   - Si pagó parcial: unpaidRentAmount = lo que queda después de servicios
   - punitoryStartDate = último día del mes del período (o lastPaymentDate si parcial)

2. `calculateDebtPunitory(debt, paymentDate)` — Calcula punitorios de una deuda
   - Caso 1 (deuda total): días desde día 1 del período
   - Caso 2 (parcial): días desde lastPaymentDate
   - Fórmula: `unpaidRentAmount × punitoryPercent × días`

3. `payDebt(debtId, amount, paymentDate, paymentMethod)` — Pagar deuda
   - Recalcula punitorios al momento del pago
   - currentTotal = unpaidRentAmount + punitorios - amountPaid anterior
   - Si pago >= currentTotal → PAID, closedAt = now
   - Sino → PARTIAL, actualiza lastPaymentDate y amountPaid

4. `getOpenDebts(groupId, contractId?)` — Listar deudas abiertas
5. `getDebtsSummary(groupId)` — Resumen para dashboard
6. `getOpenDebtsByTenant(groupId, contractId)` — Para validación de bloqueo

---

## 5.3 Regla de Bloqueo

**Backend — Nuevo endpoint:** `GET /api/groups/:gid/contracts/:cid/can-pay-current-month`

**Lógica:** Verificar si hay deudas OPEN o PARTIAL para el contrato. Si hay → bloquear.

**Modificar:** `paymentTransactionService.js` → `registerPayment()`:
- Antes de registrar pago, verificar que no hay deudas abiertas para ese contrato
- Si hay → rechazar con mensaje descriptivo

**Frontend — PaymentRegistrationModal.jsx:**
- Al abrir, consultar `/can-pay-current-month`
- Si bloqueado: mostrar alerta con lista de deudas pendientes
- Deshabilitar formulario de pago
- Link a "Pagar deudas primero"

---

## 5.4 MonthlyCloseService

**Archivo nuevo:** `backend/src/services/monthlyCloseService.js`

**Funciones:**

1. `previewCloseMonth(groupId, month, year)` — Preview antes de cerrar
   - Lista todos los MonthlyRecords PENDING y PARTIAL del período
   - Calcula deudas que se generarían (con imputación)
   - Retorna: { recordsToClose, debtsToGenerate, summary }

2. `closeMonth(groupId, month, year)` — Ejecutar cierre
   - Para cada MonthlyRecord no COMPLETE del período:
     - Crear Debt con imputación servicios → alquiler
     - Marcar MonthlyRecord como isCancelled = true
   - Retorna: { debtsCreated, summary }

**Endpoint nuevo:**
- `POST /api/groups/:gid/close-month` → body: { month, year }
- `POST /api/groups/:gid/close-month/preview` → body: { month, year }

---

## 5.5 Frontend: DebtList Page

**Archivo nuevo:** `frontend/src/pages/debts/DebtList.jsx`

**Contenido:**
- Tabla de deudas abiertas con columnas: Período, Inquilino, Propiedad, Base, Punitorios acumulados, Total actual, Estado, Acciones
- Botón "Pagar" que abre modal de pago de deuda
- Filtros: estado (OPEN/PARTIAL/PAID), búsqueda
- Resumen superior con totales
- Alerta de inquilinos bloqueados

**Hook nuevo:** `frontend/src/hooks/useDebts.js`
- Queries: deudas abiertas, resumen, can-pay-current-month
- Mutations: pagar deuda

**Modal nuevo:** `frontend/src/components/DebtPaymentModal.jsx`
- Muestra deuda con punitorios recalculados a hoy
- Campo de monto y método de pago
- Preview de punitorios en tiempo real

---

## 5.6 Frontend: CloseMonth Wizard

**Archivo nuevo:** `frontend/src/pages/monthly-control/CloseMonthWizard.jsx`

**Paso 1 — Preview:**
- Seleccionar mes/año a cerrar
- Mostrar tabla de registros que se cerrarían
- Mostrar deudas que se generarían
- Resumen de montos

**Paso 2 — Confirmación:**
- Confirmar cierre
- Ejecutar POST /close-month
- Mostrar resultado

**Integración:**
- Botón "Cerrar Mes" en MonthlyControlPage (header)
- Solo visible si hay registros pendientes/parciales

---

## 5.7 Actualizaciones Dashboard

**Modificar:** `dashboardController.js` → `getSummary()`
- Agregar: totalDebt (suma currentTotal de deudas abiertas)
- Agregar: blockedTenants (contratos con deudas abiertas)

**Modificar:** `Dashboard.jsx`
- Nueva stat card: "Deudas Totales" con monto y color error
- Nueva stat card: "Inquilinos Bloqueados" con count
- Click navega a /debts

---

## 5.8 Sidebar + Rutas

**Modificar:** `Sidebar.jsx` — Agregar link "Deudas" con icono
**Modificar:** `App.jsx` — Agregar rutas /debts y /close-month
**Modificar:** `routes/index.js` — Agregar rutas de deudas y cierre

---

## Orden de implementación:

1. Schema Prisma + migración (5.1)
2. DebtService backend (5.2)
3. MonthlyCloseService backend (5.4)
4. Regla de bloqueo backend (5.3)
5. Rutas y controladores backend (5.2-5.4)
6. Hook useDebts frontend (5.5)
7. DebtList + DebtPaymentModal frontend (5.5)
8. CloseMonthWizard frontend (5.6)
9. Bloqueo en PaymentRegistrationModal (5.3)
10. Dashboard updates (5.7)
11. Sidebar + Rutas (5.8)
