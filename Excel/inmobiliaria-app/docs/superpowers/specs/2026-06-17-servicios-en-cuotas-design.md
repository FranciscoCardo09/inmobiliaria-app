# Servicios en cuotas (numeración por contrato)

Fecha: 2026-06-17

## Problema

El número de cuota de un servicio (ej. "Cocina cuotas 3 de 3") hoy está escrito a mano
dentro del `ConceptType.label`, que es **compartido** entre contratos. Resultado: todos los
inquilinos y todos los meses muestran el mismo "3 de 3", sin importar en qué cuota está cada
uno. Caso real: Godoy (1ª cuota) aparece como "3 de 3"; el mismo concepto está aplicado a
9 meses en otro contrato (Cazaux).

## Requisito

- El número de cuota es **propio de cada contrato**, contado desde que se le carga ese
  servicio a ese inquilino. X arranca 1/N en su mes; Y arranca 1/N en el suyo, independientes.
- El **monto puede variar** por mes.
- **Opt-in**: solo algunos conceptos puntuales usan cuotas; el resto sigue igual.

## Diseño (Approach A: campos de cuota en el servicio del mes)

### 1. Modelo de datos
`MonthlyService` agrega dos campos opcionales:
- `cuotaNumber Int?` (`cuota_number`)
- `cuotaTotal  Int?` (`cuota_total`)

Nulos = servicio normal. Migración aditiva (ALTER TABLE ADD COLUMN, escrita a mano para no
correr `migrate dev` contra prod).

### 2. Carga "en cuotas"
- Nueva función de servicio `assignInstallmentService(groupId, contractId, conceptTypeId,
  totalCuotas, startMonth, startYear, montoTotal)`: crea N meses consecutivos para el contrato,
  numerados `cuotaNumber` 1..N y `cuotaTotal` N. Monto por defecto = `round2(montoTotal / N)`
  (último ajusta el redondeo). Reutiliza la creación de records de `bulkAssign`.
- Endpoint: `POST /api/groups/:gid/contracts/:cid/services/installment`.
- El monto de cada cuota queda editable por mes con el flujo de edición ya existente
  (`updateService`), que debe **preservar** `cuotaNumber`/`cuotaTotal`.

### 3. Visualización
- Helper único `formatServiceLabel(service)`:
  - back: `backend/src/utils/serviceLabel.js`
  - front: `frontend/src/utils/serviceLabel.js`
  - Si `cuotaNumber` y `cuotaTotal` están seteados → `"<base> (cuota k/N)"`, si no → base.
  - `<base>` = `conceptType.label || description || name || 'Servicio'`.
- Aplicar en: `reportDataService.js` (liquidación ~277, pago efectivo ~1040), desglose de
  transacción en `paymentTransactionService.js` (~141), `MonthlyRecordRow.jsx`,
  `MonthlyControlPage.jsx`, `PaymentRegistrationModal.jsx`, `PaymentForm.jsx`.
- Asegurar que todas las queries de `MonthlyService` seleccionen `cuotaNumber`/`cuotaTotal`.

### 4. Edición / borrado
- Editar monto por mes: ya existe; preservar campos de cuota.
- Borrar un mes: borra solo esa cuota.
- Cambiar N de un plan ya cargado: fuera de alcance (edición manual).

### 5. Arreglo de datos actuales (script revisable, con before/after antes de ejecutar)
- Concepto "Cocina cuotas 3 de 3" → renombrar `label` a "Cocina".
- Godoy (contrato 5025cf6b, junio 2026): marcar junio como `1/3`; crear jul y ago 2026 como
  `2/3` y `3/3` (monto 123333 c/u) para completar el plan.
- Cazaux (contrato fb0ecb60, 9 meses abr→dic): **a confirmar al ejecutar** — opción A: dejar
  abr/may/jun como 1/3,2/3,3/3 y borrar jul→dic; opción B: si los 9 meses eran intencionales
  (no es un plan de 3 cuotas), no asignar cuota y dejarlos como bonificación recurrente.

## Fuera de alcance
- UI para editar la longitud del plan (N) después de creado.
- Planes con montos distintos cargados de una en el alta (se edita por mes).

## Testing
- Local contra Docker `sim_pg` (Postgres 17): push del schema + escenario mínimo (2 contratos,
  asignar plan de 3 cuotas a cada uno en meses distintos, verificar numeración independiente).
- Verificar que servicios normales (sin cuota) siguen mostrándose igual (sin regresión).
