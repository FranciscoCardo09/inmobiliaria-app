# Rediseño de recuadros de deuda en "Liquidación General" + Ajuste de % Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el estilo visual de los recuadros de deuda del reporte PDF
"Liquidación General" (encabezado de mes afuera de la caja, caja solo con
conceptos+cierre) y extender el texto "Ajuste de X%" (ya funciona para el mes
actual) a los meses de Deudas Acumuladas y Deudas Pagadas.

**Architecture:** Cambios en 2 archivos backend. `reportDataService.js` gana
un helper puro `findAjusteForMonth` y dos plumbings de datos (Prisma `select`/
`include` + un campo nuevo) para que el % de ajuste llegue a las 3 rutas.
`pdfTemplates.js` parte `drawMonthBlock` en `drawMonthHeader` (afuera de la
caja) y `drawMonthBox` (adentro), y usa ese split para que "Deudas Acumuladas"
pase a ser una caja por mes (como ya es "Deudas Pagadas").

**Tech Stack:** Node.js, Prisma ORM (PostgreSQL), PDFKit, `node:test`.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-17-liquidacion-boxes-redesign-design.md`.
- No se cambian colores (conceptos en gris/negro, rojo para "Falta pagar", azul
  para "Saldo a favor" — sin cambios).
- Formato de texto de ajuste unificado en las 3 secciones: `"Ajuste de X%"`
  (con "de"), usando `adjustmentPercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })`.
- No se toca `generateLiquidacionPDF` (reporte de un solo contrato, usa tablas
  planas, no cajas) ni los colores/estructura de "LIQUIDACIÓN ACTUAL" (solo su
  texto de ajuste).
- Todo el trabajo es en `inmobiliaria-app/backend/src/services/` (rutas abajo
  son relativas a `inmobiliaria-app/backend/`).
- DB local de test disponible en dos sabores: `test/integration/run.sh` (Postgres
  descartable en :55433, para tests con Prisma real) y el Docker `inmob_local`
  en :55434 (copia de datos reales, para verificación manual final vía
  frontend). No confundir: los tests automatizados usan SIEMPRE el primero.

---

## File Structure

- `backend/src/services/reportDataService.js` — modificado: nuevo helper
  `findAjusteForMonth`, plumbing de `rentHistory`/`monthNumber` en 2 rutas,
  nuevos exports (`findAjusteForMonth`, `buildConceptosDeudaPagada`).
- `backend/src/services/pdfTemplates.js` — modificado: split de
  `drawMonthBlock`, reestructuración de los bloques "DEUDAS ACUMULADAS" y
  "DEUDAS PAGADAS" en `generateLiquidacionAllPDF`.
- `backend/test/reportDataAjuste.test.js` — nuevo: tests unitarios puros (sin DB)
  para `findAjusteForMonth` y `buildConceptosDeudaPagada`.
- `backend/test/integration/ajusteDeudaAcumulada.test.js` — nuevo: test de
  integración (DB descartable) para el plumbing de Deudas Acumuladas.

---

### Task 1: `findAjusteForMonth` helper + formato "Ajuste de X%" en mes actual

**Files:**
- Modify: `backend/src/services/reportDataService.js` (helper nuevo antes de
  `buildDeudasUnificadas` ~línea 60; `buildLiquidacionFromRecord` líneas
  466-469 y 491-494; `module.exports` al final del archivo)
- Test: `backend/test/reportDataAjuste.test.js` (nuevo)

**Interfaces:**
- Produces: `findAjusteForMonth(rentHistory, monthNumber) => { effectiveFromMonth: number, reason: string|null, adjustmentPercent: number|null } | undefined`,
  exportado desde `reportDataService.js`.

- [ ] **Step 1: Escribir el test (falla porque `findAjusteForMonth` todavía no existe)**

Crear `backend/test/reportDataAjuste.test.js`:

```js
/*
 * Tests puros (sin DB) para la detección de ajuste de alquiler compartida
 * entre las 3 secciones del reporte de Liquidación (mes actual, deudas
 * acumuladas, deudas pagadas).
 * Run: cd backend && node --test test/reportDataAjuste.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { findAjusteForMonth } = require('../src/services/reportDataService');

test('findAjusteForMonth: encuentra un ajuste real en el mes de contrato exacto', () => {
  const rentHistory = [
    { effectiveFromMonth: 1, reason: 'INICIAL', adjustmentPercent: null },
    { effectiveFromMonth: 5, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 12.5 },
  ];
  const found = findAjusteForMonth(rentHistory, 5);
  assert.ok(found, 'debe encontrar el ajuste del mes 5');
  assert.strictEqual(found.adjustmentPercent, 12.5);
});

test('findAjusteForMonth: ignora el ajuste INICIAL', () => {
  const rentHistory = [{ effectiveFromMonth: 1, reason: 'INICIAL', adjustmentPercent: 0 }];
  assert.strictEqual(findAjusteForMonth(rentHistory, 1), undefined);
});

test('findAjusteForMonth: sin match en ese mes devuelve undefined', () => {
  const rentHistory = [{ effectiveFromMonth: 5, reason: 'AJUSTE_MANUAL', adjustmentPercent: 8 }];
  assert.strictEqual(findAjusteForMonth(rentHistory, 3), undefined);
});

test('findAjusteForMonth: rentHistory vacío/null no rompe', () => {
  assert.strictEqual(findAjusteForMonth(null, 1), undefined);
  assert.strictEqual(findAjusteForMonth([], 1), undefined);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && node --test test/reportDataAjuste.test.js`
Expected: FAIL — `findAjusteForMonth` es `undefined` (no exportado todavía), los 4 tests tiran `TypeError`.

- [ ] **Step 3: Agregar el helper y usarlo en el mes actual**

En `backend/src/services/reportDataService.js`, agregar justo antes de
`const buildDeudasUnificadas = (deudasVivas, cobradoDetalle) => {` (línea 60):

```js
// Detecta si el contrato tuvo un ajuste de alquiler REAL (no el ajuste INICIAL)
// en un mes de contrato dado (`monthNumber`, no calendario) — usado para el
// sufijo "Ajuste de X%" en el label de Alquiler, compartido por las 3
// secciones del reporte de Liquidación (mes actual, deudas acumuladas, deudas
// pagadas).
const findAjusteForMonth = (rentHistory, monthNumber) =>
  (rentHistory || []).find(
    (h) => h.effectiveFromMonth === monthNumber && h.reason !== 'INICIAL' && h.adjustmentPercent != null
  );

```

Reemplazar (líneas 466-469):

```js
  // Detect if contract had a rent adjustment this month
  const ajusteEstesMes = (contract.rentHistory || []).find(
    h => h.effectiveFromMonth === monthlyRecord.monthNumber && h.reason !== 'INICIAL' && h.adjustmentPercent != null
  );
```

por:

```js
  // Detect if contract had a rent adjustment this month
  const ajusteEstesMes = findAjusteForMonth(contract.rentHistory, monthlyRecord.monthNumber);
```

Reemplazar (líneas 491-494):

```js
    if (!isMultaRescision && ajusteEstesMes) {
      const pctStr = ajusteEstesMes.adjustmentPercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      alquilerLabel += ` Ajuste ${pctStr}%`;
    }
```

por:

```js
    if (!isMultaRescision && ajusteEstesMes) {
      const pctStr = ajusteEstesMes.adjustmentPercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      alquilerLabel += ` Ajuste de ${pctStr}%`;
    }
```

Agregar `findAjusteForMonth,` a `module.exports` (al final del archivo, junto
al resto de los exports).

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && node --test test/reportDataAjuste.test.js`
Expected: PASS — 4 tests, 0 fallos.

- [ ] **Step 5: Commit**

```bash
cd /home/francisco/Excel
git add inmobiliaria-app/backend/src/services/reportDataService.js inmobiliaria-app/backend/test/reportDataAjuste.test.js
git commit -m "$(cat <<'EOF'
feat(reportes): helper findAjusteForMonth + "Ajuste de X%" en mes actual

Extrae la detección de ajuste de alquiler a un helper reutilizable
(compartido por las 3 secciones del reporte de Liquidación) y unifica
el formato de texto a "Ajuste de X%".
EOF
)"
```

---

### Task 2: Deudas Pagadas — plumbing de `rentHistory` en `buildConceptosDeudaPagada`

**Files:**
- Modify: `backend/src/services/reportDataService.js` (`buildConceptosDeudaPagada`
  líneas 177-225; `contract: { select: {...} }` dentro de
  `getLiquidacionesAllContracts` ~líneas 1046-1053; call site ~línea 1176-1177;
  `module.exports`)
- Test: `backend/test/reportDataAjuste.test.js` (extender)

**Interfaces:**
- Consumes: `findAjusteForMonth` (Task 1).
- Produces: `buildConceptosDeudaPagada(rec, det, rentHistory)` — nuevo 3er
  parámetro opcional, exportado desde `reportDataService.js`.

- [ ] **Step 1: Escribir el test (falla porque `buildConceptosDeudaPagada` no está exportada / no acepta el 3er parámetro)**

Agregar al final de `backend/test/reportDataAjuste.test.js`:

```js
const { buildConceptosDeudaPagada } = require('../src/services/reportDataService');

test('buildConceptosDeudaPagada: agrega "Ajuste de X%" al label de alquiler cuando hubo ajuste ese mes', () => {
  const rec = { periodMonth: 6, periodYear: 2026, monthNumber: 5, rentAmount: 100000, services: [], includeIva: false, ivaAmount: 0 };
  const det = { alquiler: 100000, servicios: 0, punitorios: 0 };
  const rentHistory = [{ effectiveFromMonth: 5, reason: 'AJUSTE_AUTOMATICO', adjustmentPercent: 10 }];
  const items = buildConceptosDeudaPagada(rec, det, rentHistory);
  const alquilerItem = items.find((i) => i.tipo === 'ALQUILER_DEUDA');
  assert.ok(alquilerItem, 'debe haber un item de alquiler');
  assert.ok(alquilerItem.label.includes('Ajuste de 10%'), `label fue: "${alquilerItem.label}"`);
});

test('buildConceptosDeudaPagada: sin ajuste ese mes no agrega sufijo', () => {
  const rec = { periodMonth: 6, periodYear: 2026, monthNumber: 5, rentAmount: 100000, services: [], includeIva: false, ivaAmount: 0 };
  const det = { alquiler: 100000, servicios: 0, punitorios: 0 };
  const items = buildConceptosDeudaPagada(rec, det, []);
  const alquilerItem = items.find((i) => i.tipo === 'ALQUILER_DEUDA');
  assert.ok(!alquilerItem.label.includes('Ajuste'), `label fue: "${alquilerItem.label}"`);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && node --test test/reportDataAjuste.test.js`
Expected: FAIL — `buildConceptosDeudaPagada` es `undefined` (no exportada
todavía).

- [ ] **Step 3: Implementar el plumbing**

En `backend/src/services/reportDataService.js`, reemplazar la firma y el
bloque de alquiler de `buildConceptosDeudaPagada` (líneas 177-193):

```js
const buildConceptosDeudaPagada = (rec, det) => {
  const items = [];
  if (!rec) {
    // Sin el record original (no debería pasar, pero por las dudas no perder el dato).
    if (det.alquiler > 0.009) items.push({ tipo: 'ALQUILER_DEUDA', label: 'Pago deuda alquiler', monto: det.alquiler });
    if (det.servicios > 0.009) items.push({ tipo: 'SERVICIOS_DEUDA', label: 'Pago deuda servicios', monto: det.servicios });
    if (det.punitorios > 0.009) items.push({ tipo: 'PUNITORIOS', label: 'Punitorios pagados', monto: det.punitorios });
    return items;
  }

  if (det.alquiler > 0.009) {
    items.push({
      tipo: 'ALQUILER_DEUDA',
      label: `Pago deuda Alquiler ${MONTH_NAMES[rec.periodMonth]} ${rec.periodYear} (Mes ${rec.monthNumber})`,
      monto: det.alquiler,
    });
  }
```

por:

```js
const buildConceptosDeudaPagada = (rec, det, rentHistory) => {
  const items = [];
  if (!rec) {
    // Sin el record original (no debería pasar, pero por las dudas no perder el dato).
    if (det.alquiler > 0.009) items.push({ tipo: 'ALQUILER_DEUDA', label: 'Pago deuda alquiler', monto: det.alquiler });
    if (det.servicios > 0.009) items.push({ tipo: 'SERVICIOS_DEUDA', label: 'Pago deuda servicios', monto: det.servicios });
    if (det.punitorios > 0.009) items.push({ tipo: 'PUNITORIOS', label: 'Punitorios pagados', monto: det.punitorios });
    return items;
  }

  if (det.alquiler > 0.009) {
    let alquilerLabel = `Pago deuda Alquiler ${MONTH_NAMES[rec.periodMonth]} ${rec.periodYear} (Mes ${rec.monthNumber})`;
    const ajuste = findAjusteForMonth(rentHistory, rec.monthNumber);
    if (ajuste) {
      const pctStr = ajuste.adjustmentPercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      alquilerLabel += ` Ajuste de ${pctStr}%`;
    }
    items.push({
      tipo: 'ALQUILER_DEUDA',
      label: alquilerLabel,
      monto: det.alquiler,
    });
  }
```

En el `select` del contrato dentro de `getLiquidacionesAllContracts`
(~líneas 1046-1053), reemplazar:

```js
            contract: {
              select: {
                contractType: true,
                tenant: { select: { name: true } },
                contractTenants: { select: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
                property: { select: { address: true, floor: true, apartment: true, owner: { select: { name: true } } } },
              },
            },
```

por:

```js
            contract: {
              select: {
                contractType: true,
                tenant: { select: { name: true } },
                contractTenants: { select: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
                property: { select: { address: true, floor: true, apartment: true, owner: { select: { name: true } } } },
                rentHistory: { select: { effectiveFromMonth: true, reason: true, adjustmentPercent: true } },
              },
            },
```

En el call site (~línea 1176-1177), reemplazar:

```js
        d.conceptos = buildConceptosDeudaPagada(d.rec, d)
          .sort((a, b) => (conceptOrder[a.tipo] ?? 1) - (conceptOrder[b.tipo] ?? 1));
```

por:

```js
        d.conceptos = buildConceptosDeudaPagada(d.rec, d, entry.contract?.rentHistory)
          .sort((a, b) => (conceptOrder[a.tipo] ?? 1) - (conceptOrder[b.tipo] ?? 1));
```

Agregar `buildConceptosDeudaPagada,` a `module.exports`.

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && node --test test/reportDataAjuste.test.js`
Expected: PASS — 6 tests, 0 fallos.

- [ ] **Step 5: Commit**

```bash
cd /home/francisco/Excel
git add inmobiliaria-app/backend/src/services/reportDataService.js inmobiliaria-app/backend/test/reportDataAjuste.test.js
git commit -m "$(cat <<'EOF'
feat(reportes): "Ajuste de X%" en el label de alquiler de Deudas Pagadas

buildConceptosDeudaPagada recibe rentHistory del contrato (ya se trae
para Liquidación Actual, faltaba en el select usado por Deudas Pagadas)
y agrega el mismo sufijo que ya existe para el mes actual.
EOF
)"
```

---

### Task 3: Deudas Acumuladas — plumbing de `monthNumber` + `ajustePercent`

**Files:**
- Modify: `backend/src/services/reportDataService.js` (3 bloques `debts: {...}`
  en `getLiquidacionData` ~líneas 356 y 384, y en `getLiquidacionesAllContracts`
  ~línea 907; `deudasVivas` ~líneas 696-716; `buildDeudasUnificadas`'s
  `pendientes` ~líneas 64-96)
- Test: `backend/test/integration/ajusteDeudaAcumulada.test.js` (nuevo, usa DB
  descartable vía `test/integration/run.sh`)

**Interfaces:**
- Consumes: `findAjusteForMonth` (Task 1).
- Produces: cada item de `deudasVivas` (y de `pendientesUni` tras
  `buildDeudasUnificadas`) gana un campo `ajustePercent: number|null`.

- [ ] **Step 1: Escribir el test de integración (falla porque `ajustePercent` no existe todavía)**

Crear `backend/test/integration/ajusteDeudaAcumulada.test.js`:

```js
/*
 * Deudas Acumuladas debe poder mostrar "Ajuste de X%" en el mes pendiente
 * cuando ese mes de contrato tuvo un ajuste real de alquiler — mismo dato
 * que ya usa Liquidación Actual, ahora también disponible acá.
 */
const test = require('node:test');
const assert = require('node:assert');
const prisma = require('./prismaClient');
const { seedScenario, createMonthlyRecord, cleanupGroup } = require('./fixtures');
const { getLiquidacionData } = require('../../src/services/reportDataService');

test('Deudas Acumuladas: ajustePercent viene seteado cuando el mes de la deuda tuvo ajuste', async (t) => {
  const { group, contract, monthlyRecord: oldRecord } = await seedScenario(prisma, {
    monthlyRecord: { monthNumber: 1, periodMonth: 1, periodYear: 2026, status: 'PARTIAL', amountPaid: 0 },
  });

  try {
    await prisma.rentHistory.create({
      data: {
        contractId: contract.id,
        effectiveFromMonth: 1,
        rentAmount: 100000,
        adjustmentPercent: 15,
        reason: 'AJUSTE_MANUAL',
      },
    });

    await prisma.debt.create({
      data: {
        groupId: group.id,
        contractId: contract.id,
        monthlyRecordId: oldRecord.id,
        periodLabel: 'Enero 2026',
        periodMonth: 1,
        periodYear: 2026,
        originalAmount: 100000,
        unpaidRentAmount: 100000,
        unpaidServicesAmount: 0,
        accumulatedPunitory: 0,
        currentTotal: 100000,
        amountPaid: 0,
        punitoryPercent: 0.006,
        punitoryStartDate: new Date(2026, 0, 10),
        status: 'OPEN',
      },
    });

    await createMonthlyRecord(prisma, { groupId: group.id, contractId: contract.id }, {
      monthNumber: 2, periodMonth: 2, periodYear: 2026, rentAmount: 100000, amountPaid: 100000, status: 'PAID',
    });

    const result = await getLiquidacionData(group.id, contract.id, 2, 2026, {});
    const pendiente = result.deudasUnificadas.find((d) => d.estado === 'PENDIENTE');

    assert.ok(pendiente, 'debe existir un mes PENDIENTE (la deuda de Enero)');
    assert.strictEqual(pendiente.ajustePercent, 15, `ajustePercent debía ser 15, fue ${pendiente.ajustePercent}`);
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});

test('Deudas Acumuladas: ajustePercent es null cuando no hubo ajuste ese mes', async (t) => {
  const { group, contract, monthlyRecord: oldRecord } = await seedScenario(prisma, {
    monthlyRecord: { monthNumber: 1, periodMonth: 1, periodYear: 2026, status: 'PARTIAL', amountPaid: 0 },
  });

  try {
    await prisma.debt.create({
      data: {
        groupId: group.id,
        contractId: contract.id,
        monthlyRecordId: oldRecord.id,
        periodLabel: 'Enero 2026',
        periodMonth: 1,
        periodYear: 2026,
        originalAmount: 100000,
        unpaidRentAmount: 100000,
        unpaidServicesAmount: 0,
        accumulatedPunitory: 0,
        currentTotal: 100000,
        amountPaid: 0,
        punitoryPercent: 0.006,
        punitoryStartDate: new Date(2026, 0, 10),
        status: 'OPEN',
      },
    });

    await createMonthlyRecord(prisma, { groupId: group.id, contractId: contract.id }, {
      monthNumber: 2, periodMonth: 2, periodYear: 2026, rentAmount: 100000, amountPaid: 100000, status: 'PAID',
    });

    const result = await getLiquidacionData(group.id, contract.id, 2, 2026, {});
    const pendiente = result.deudasUnificadas.find((d) => d.estado === 'PENDIENTE');

    assert.ok(pendiente, 'debe existir un mes PENDIENTE (la deuda de Enero)');
    assert.strictEqual(pendiente.ajustePercent, null);
  } finally {
    await cleanupGroup(prisma, group.id);
  }
});
```

Agregar `createMonthlyRecord` a los exports que ya importa este archivo (ya
está exportado por `fixtures.js`, solo hace falta importarlo acá).

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && ./test/integration/run.sh test/integration/ajusteDeudaAcumulada.test.js`
Expected: FAIL — el primer test tira `assert.strictEqual(pendiente.ajustePercent, 15, ...)` con `pendiente.ajustePercent === undefined`.

- [ ] **Step 3: Implementar el plumbing**

En `backend/src/services/reportDataService.js`, hay 3 bloques `debts: {...}`
idénticos, carácter por carácter (dos en `getLiquidacionData`, líneas ~356 y
~384; uno en `getLiquidacionesAllContracts`'s `includeClause`, línea ~907). Si
se usa la herramienta Edit, reemplazar con `replace_all: true` en una sola
pasada (el old_string y el new_string son iguales en los 3 casos); si se edita
a mano, aplicar el mismo cambio en los 3 lugares. Reemplazar cada ocurrencia
de:

```js
          debts: { where: { status: { not: 'PAID' } }, orderBy: { createdAt: 'asc' } },
```

por:

```js
          debts: {
            where: { status: { not: 'PAID' } },
            orderBy: { createdAt: 'asc' },
            // monthNumber (índice de mes de CONTRATO, no calendario) para poder
            // cruzar contra rentHistory.effectiveFromMonth y detectar ajustes.
            include: { monthlyRecord: { select: { monthNumber: true } } },
          },
```

En `deudasVivas` (líneas 696-716), reemplazar:

```js
  const deudasVivas = await Promise.all((contract.debts || []).map(async (d) => {
    const live = await liveDebtFigures(d);
    return {
      periodo: d.periodLabel,
      periodMonth: d.periodMonth,
      periodYear: d.periodYear,
      original: d.originalAmount,
      pagado: d.amountPaid,
      punitorios: live.punitorios,
      punitoriosPendientes: live.punitoriosPendientes,
      pendiente: live.pendiente,
      status: d.status,
      // Días TOTALES de mora (desde que empezó a correr el punitorio hasta HOY, fecha
      // de generación del reporte) — no el tramo desde el último pago parcial.
      dias: debtDelinquencyDays(d),
      // Desglose alquiler/servicios pendientes, para itemizar "Deudas Acumuladas"
      // con el mismo nivel de detalle que "Cobrado de deudas anteriores".
      alquilerPendiente: live.alquiler,
      serviciosPendientes: live.servicios,
    };
  }));
```

por:

```js
  const deudasVivas = await Promise.all((contract.debts || []).map(async (d) => {
    const live = await liveDebtFigures(d);
    return {
      periodo: d.periodLabel,
      periodMonth: d.periodMonth,
      periodYear: d.periodYear,
      original: d.originalAmount,
      pagado: d.amountPaid,
      punitorios: live.punitorios,
      punitoriosPendientes: live.punitoriosPendientes,
      pendiente: live.pendiente,
      status: d.status,
      // Días TOTALES de mora (desde que empezó a correr el punitorio hasta HOY, fecha
      // de generación del reporte) — no el tramo desde el último pago parcial.
      dias: debtDelinquencyDays(d),
      // Desglose alquiler/servicios pendientes, para itemizar "Deudas Acumuladas"
      // con el mismo nivel de detalle que "Cobrado de deudas anteriores".
      alquilerPendiente: live.alquiler,
      serviciosPendientes: live.servicios,
      // % de ajuste de alquiler vigente desde ese mes de contrato (si hubo) —
      // para que "Alquiler pendiente" muestre "Ajuste de X%", igual que
      // Liquidación Actual y Deudas Pagadas.
      ajustePercent: findAjusteForMonth(contract.rentHistory, d.monthlyRecord?.monthNumber)?.adjustmentPercent ?? null,
    };
  }));
```

En `buildDeudasUnificadas` (líneas 64-96), dentro del `.map` de `pendientes`,
agregar el campo pasándolo directamente. Reemplazar:

```js
      alquilerPendiente: d.alquilerPendiente,
      serviciosPendientes: d.serviciosPendientes,
```

por:

```js
      alquilerPendiente: d.alquilerPendiente,
      serviciosPendientes: d.serviciosPendientes,
      ajustePercent: d.ajustePercent ?? null,
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && ./test/integration/run.sh test/integration/ajusteDeudaAcumulada.test.js`
Expected: PASS — 2 tests, 0 fallos.

- [ ] **Step 5: Commit**

```bash
cd /home/francisco/Excel
git add inmobiliaria-app/backend/src/services/reportDataService.js inmobiliaria-app/backend/test/integration/ajusteDeudaAcumulada.test.js
git commit -m "$(cat <<'EOF'
feat(reportes): ajustePercent en Deudas Acumuladas

contract.debts no traía el monthNumber de su MonthlyRecord original,
así que no había forma de cruzarlo contra rentHistory.effectiveFromMonth.
Con el include nuevo, cada deuda pendiente sabe si su mes tuvo un
ajuste real de alquiler, listo para que el PDF muestre "Ajuste de X%".
EOF
)"
```

---

### Task 4: `pdfTemplates.js` — split de `drawMonthBlock` + una caja por mes en ambas secciones

**Files:**
- Modify: `backend/src/services/pdfTemplates.js` (bloque de constantes/alturas
  líneas 1359-1392; `drawMonthBlock` líneas 1444-1502; bloque "Deudas
  Acumuladas" líneas 1533-1547; bloque "Deudas Pagadas" líneas 1549-1565)

**Interfaces:**
- Consumes: `d.ajustePercent` (Task 3, en items de `pendientesUni`).
- Produces: `drawMonthHeader(d, startY) => number` (nueva Y), `drawMonthBox(d, startY) => number` (nueva Y) — ambas funciones internas de `generateLiquidacionAllPDF`, reemplazan a `drawMonthBlock`.

Este task no tiene una prueba automatizada de geometría (el repo no tiene
infraestructura de testing visual/PDF — los tests existentes cubren lógica de
negocio, no layout). La verificación es la Task 5 (script + render a PNG +
inspección visual), igual que se usó para confirmar el fix anterior de este
mismo reporte.

- [ ] **Step 1: Reemplazar el bloque de alturas**

En `backend/src/services/pdfTemplates.js`, reemplazar (líneas 1359-1392):

```js
      // Altura de un mes dentro de un recuadro: encabezado (13) + una línea por
      // concepto (14 c/u, desde `conceptos` si viene desglosado o desde los
      // campos discretos alquiler/servicios/punitorios) + eventual "Pagado" (14) +
      // cierre "Falta pagar"/"Saldo a favor" (15, condicional) + separación (8).
      const pendienteRowsOf = (d) => {
        const base = d.conceptos ? d.conceptos.length
          : (d.alquilerPendiente > 0 ? 1 : 0) + (d.serviciosPendientes > 0 ? 1 : 0)
            + (d.punitoriosPagados > 0 ? 1 : 0) + (d.punitoriosPendientes > 0 ? 1 : 0);
        return base + (!d.conceptos && d.pagadoEstePeriodo > 0 ? 1 : 0);
      };
      // Encabezado ahora son 2 líneas (período+estado, luego total) = 21pt; el
      // cierre "Falta pagar" (rojo) o "Saldo a favor" (azul) es condicional.
      const monthBlockH = (d) => 21 + pendienteRowsOf(d) * 11 + (d.pendiente > 0.009 || d.sobrepago > 0 ? 12 : 0) + 5;

      const HEADER_H = 26; // dirección/inquilino/estado/total + línea divisoria
      const BOX_TOP = 14;  // padding superior + título
      const BOX_BOTTOM = 6;
      const SECTION_LABEL_H = 12; // "DEUDAS PAGADAS" como texto simple, sin caja propia

      // El título de este recuadro ocupa 21pt reales (10 padding + 11 línea),
      // no el BOX_TOP genérico (14) — sin esto el monto de cierre se sale
      // del rectángulo (queda pegado o por fuera del borde inferior).
      const LIQ_TITLE_H = 21;
      const liqBoxH = conceptosFiltered.length > 0
        ? LIQ_TITLE_H + conceptosFiltered.length * 12 + 4 + 12 + BOX_BOTTOM
        : 0;
      const deudasBoxH = pendientesUni.length > 0
        ? BOX_TOP + pendientesUni.reduce((s, d) => s + monthBlockH(d), 0) + 12 + BOX_BOTTOM
        : 0;
      // Deudas Pagadas: UN rectángulo POR MES (no una caja compartida) — cada uno
      // con su propio estado (SALDADA) + total arriba a la derecha, mismo patrón
      // que Deudas Acumuladas. `-5` porque monthBlockH ya trae la separación final,
      // que acá la da boxGap entre recuadros.
      const pagadaBoxHeights = saldadasUni.map((d) => BOX_TOP + (monthBlockH(d) - 5) + BOX_BOTTOM);
```

por:

```js
      // Filas de concepto dentro de la CAJA de un mes (desde `conceptos` si viene
      // desglosado, o desde los campos discretos alquiler/servicios/punitorios).
      const pendienteRowsOf = (d) => {
        const base = d.conceptos ? d.conceptos.length
          : (d.alquilerPendiente > 0 ? 1 : 0) + (d.serviciosPendientes > 0 ? 1 : 0)
            + (d.punitoriosPagados > 0 ? 1 : 0) + (d.punitoriosPendientes > 0 ? 1 : 0);
        return base + (!d.conceptos && d.pagadoEstePeriodo > 0 ? 1 : 0);
      };

      const HEADER_H = 26; // dirección/inquilino/estado/total + línea divisoria
      const BOX_BOTTOM = 6;
      const SECTION_LABEL_H = 12; // "DEUDAS PAGADAS"/"DEUDAS ACUMULADAS" como texto simple, sin caja propia

      // Encabezado de mes (período+estado, luego total) — se dibuja AFUERA de la
      // caja, mismo patrón que ya usa el encabezado de propiedad.
      const MONTH_HEADER_H = 21;
      // Caja de un mes: padding superior sin título (10, el período/estado/total
      // ahora van afuera vía drawMonthHeader) + una línea por concepto + cierre
      // "Falta pagar"/"Saldo a favor" (12, condicional) + padding inferior.
      const monthBoxH = (d) => 10 + pendienteRowsOf(d) * 11 + (d.pendiente > 0.009 || d.sobrepago > 0 ? 12 : 0) + BOX_BOTTOM;

      // El título de este recuadro ocupa 21pt reales (10 padding + 11 línea),
      // no un BOX_TOP genérico — sin esto el monto de cierre se sale del
      // rectángulo (queda pegado o por fuera del borde inferior).
      const LIQ_TITLE_H = 21;
      const liqBoxH = conceptosFiltered.length > 0
        ? LIQ_TITLE_H + conceptosFiltered.length * 12 + 4 + 12 + BOX_BOTTOM
        : 0;
      // Deudas Acumuladas y Deudas Pagadas: UN rectángulo POR MES cada una (mismo
      // patrón en las dos), con el encabezado de mes afuera de la caja.
      const acumuladaBoxHeights = pendientesUni.map((d) => monthBoxH(d));
      const pagadaBoxHeights = saldadasUni.map((d) => monthBoxH(d));
```

- [ ] **Step 2: Reemplazar `drawMonthBlock` por `drawMonthHeader` + `drawMonthBox`**

Reemplazar (líneas 1439-1502):

```js
      // Dibuja el contenido de un mes dentro de un recuadro (sin recuadro propio,
      // es una sección más dentro del recuadro padre). Arriba a la derecha: estado
      // (SALDADA/SIN ABONAR) + total del período, mismo patrón que el encabezado de
      // propiedad. Abajo: "Falta pagar" solo si todavía debe algo — nunca azul, eso
      // queda reservado para saldo a favor a nivel propiedad.
      const drawMonthBlock = (d, startY) => {
        const debe = d.pendiente > 0.009;
        const estado = debe ? 'SIN ABONAR' : 'SALDADA';
        const estadoColor = debe ? '#CC0000' : C.black;
        let my = startY;
        doc.font(F.b).fontSize(7.5).fillColor(C.dark).text(d.periodLabel, PAGE.margin + 12, my, { width: W * 0.5 });
        doc.font(F.b).fontSize(7).fillColor(estadoColor).text(estado, PAGE.margin + 12, my, { width: W - 24, align: 'right' });
        my += 9;
        const totalDisplay = (d.pagadoTotal > 0 && debe)
          ? `${fmt(d.pagadoTotal, currency)} / ${fmt(d.totalAPagar, currency)}`
          : fmt(d.totalAPagar, currency);
        doc.font(F.b).fontSize(8).fillColor(estadoColor).text(totalDisplay, PAGE.margin + 12, my, { width: W - 24, align: 'right' });
        my += 12;
        if (d.conceptos) {
          for (const c of d.conceptos) {
            const label = c.tipo === 'PUNITORIOS' ? `Punitorios pagados${d.dias > 0 ? ` (${d.dias} días)` : ''}` : c.label;
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(label, PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(c.monto, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
        } else {
          if (d.alquilerPendiente > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Alquiler pendiente', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.alquilerPendiente, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.serviciosPendientes > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Servicios pendientes', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.serviciosPendientes, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.punitoriosPagados > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Punitorios pagados', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.punitoriosPagados, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.punitoriosPendientes > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Punitorios que faltan pagar', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.punitoriosPendientes, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.pagadoEstePeriodo > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Pagado', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.pagadoEstePeriodo, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
        }
        if (debe) {
          doc.font(F.b).fontSize(8).fillColor('#CC0000').text('Falta pagar', PAGE.margin + 20, my, { width: W * 0.55 });
          doc.font(F.b).fontSize(8).fillColor('#CC0000').text(fmt(d.pendiente, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
          my += 12;
        } else if (d.sobrepago > 0) {
          doc.font(F.b).fontSize(8).fillColor('#0066CC').text('Saldo a favor', PAGE.margin + 20, my, { width: W * 0.55 });
          doc.font(F.b).fontSize(8).fillColor('#0066CC').text(fmt(d.sobrepago, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
          my += 12;
        }
        my += 5;
        return my;
      };
```

por:

```js
      // Encabezado de un mes de deuda (período+estado, luego total) — se dibuja
      // AFUERA de la caja, mismo patrón que el encabezado de propiedad y que ya
      // usa la etiqueta de sección "DEUDAS PAGADAS"/"DEUDAS ACUMULADAS".
      const drawMonthHeader = (d, startY) => {
        const debe = d.pendiente > 0.009;
        const estado = debe ? 'SIN ABONAR' : 'SALDADA';
        const estadoColor = debe ? '#CC0000' : C.black;
        let my = startY;
        doc.font(F.b).fontSize(7.5).fillColor(C.dark).text(d.periodLabel, PAGE.margin, my, { width: W * 0.5 });
        doc.font(F.b).fontSize(7).fillColor(estadoColor).text(estado, PAGE.margin, my, { width: W, align: 'right' });
        my += 9;
        const totalDisplay = (d.pagadoTotal > 0 && debe)
          ? `${fmt(d.pagadoTotal, currency)} / ${fmt(d.totalAPagar, currency)}`
          : fmt(d.totalAPagar, currency);
        doc.font(F.b).fontSize(8).fillColor(estadoColor).text(totalDisplay, PAGE.margin, my, { width: W, align: 'right' });
        my += 12;
        return my;
      };

      // Contenido de un mes DENTRO de la caja: conceptos + cierre "Falta pagar"/
      // "Saldo a favor" (nunca azul a este nivel, "Saldo a favor" en azul queda
      // reservado para la propiedad). El "Ajuste de X%" de Deudas Pagadas ya viene
      // embebido en `c.label` (ver reportDataService.buildConceptosDeudaPagada);
      // el fallback "Alquiler pendiente" (Deudas Acumuladas sin desglose por
      // concepto) arma su propio sufijo acá con `d.ajustePercent`.
      const drawMonthBox = (d, startY) => {
        const debe = d.pendiente > 0.009;
        let my = startY;
        if (d.conceptos) {
          for (const c of d.conceptos) {
            const label = c.tipo === 'PUNITORIOS' ? `Punitorios pagados${d.dias > 0 ? ` (${d.dias} días)` : ''}` : c.label;
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(label, PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(c.monto, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
        } else {
          if (d.alquilerPendiente > 0) {
            let label = 'Alquiler pendiente';
            if (d.ajustePercent != null) {
              const pctStr = d.ajustePercent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
              label += ` Ajuste de ${pctStr}%`;
            }
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(label, PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.alquilerPendiente, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.serviciosPendientes > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Servicios pendientes', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.serviciosPendientes, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.punitoriosPagados > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Punitorios pagados', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.punitoriosPagados, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.punitoriosPendientes > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Punitorios que faltan pagar', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.punitoriosPendientes, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
          if (d.pagadoEstePeriodo > 0) {
            doc.font(F.r).fontSize(8).fillColor(C.dark).text('Pagado', PAGE.margin + 20, my, { width: W * 0.55 });
            doc.font(F.r).fontSize(8).fillColor(C.dark).text(fmt(d.pagadoEstePeriodo, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
            my += 11;
          }
        }
        if (debe) {
          doc.font(F.b).fontSize(8).fillColor('#CC0000').text('Falta pagar', PAGE.margin + 20, my, { width: W * 0.55 });
          doc.font(F.b).fontSize(8).fillColor('#CC0000').text(fmt(d.pendiente, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
          my += 12;
        } else if (d.sobrepago > 0) {
          doc.font(F.b).fontSize(8).fillColor('#0066CC').text('Saldo a favor', PAGE.margin + 20, my, { width: W * 0.55 });
          doc.font(F.b).fontSize(8).fillColor('#0066CC').text(fmt(d.sobrepago, currency), PAGE.margin + 20, my, { width: W - 40, align: 'right' });
          my += 12;
        }
        return my;
      };
```

- [ ] **Step 3: Reestructurar el bloque "Deudas Acumuladas"**

Reemplazar (líneas 1533-1547):

```js
      // ── Rectángulo: Deudas Acumuladas ──
      if (deudasBoxH > 0) {
        checkBox(deudasBoxH + boxGap);
        fillR(doc, PAGE.margin, iy, W, deudasBoxH, C.snow, 0);
        strokeR(doc, PAGE.margin, iy, W, deudasBoxH, C.line, 0.5, 0);
        let dy = iy + 10;
        doc.font(F.b).fontSize(8).fillColor(C.medium).text('DEUDAS ACUMULADAS', PAGE.margin + 12, dy);
        dy += 11;
        for (const d of pendientesUni) {
          dy = drawMonthBlock(d, dy);
        }
        doc.font(F.b).fontSize(8).fillColor(C.black).text('Total Deuda', PAGE.margin + 12, dy);
        doc.font(F.b).fontSize(8).fillColor(C.black).text(fmt(data.totalDeuda, currency), PAGE.margin + 12, dy, { width: W - 24, align: 'right' });
        iy += deudasBoxH + boxGap;
      }
```

por:

```js
      // ── Deudas Acumuladas: un rectángulo POR MES, con el encabezado (período/
      // estado/total) afuera de la caja — mismo patrón que Deudas Pagadas.
      // "Total Deuda" cierra la sección, también afuera de las cajas.
      if (pendientesUni.length > 0) {
        checkBox(SECTION_LABEL_H + MONTH_HEADER_H + acumuladaBoxHeights[0] + boxGap);
        doc.font(F.b).fontSize(8).fillColor(C.medium).text('DEUDAS ACUMULADAS', PAGE.margin, iy);
        iy += SECTION_LABEL_H;
        pendientesUni.forEach((d, i) => {
          const boxH = acumuladaBoxHeights[i];
          checkBox(MONTH_HEADER_H + boxH + boxGap);
          iy = drawMonthHeader(d, iy);
          fillR(doc, PAGE.margin, iy, W, boxH, C.snow, 0);
          strokeR(doc, PAGE.margin, iy, W, boxH, C.line, 0.5, 0);
          drawMonthBox(d, iy + 10);
          iy += boxH + boxGap;
        });
        doc.font(F.b).fontSize(8).fillColor(C.black).text('Total Deuda', PAGE.margin, iy, { width: W * 0.6 });
        doc.font(F.b).fontSize(8).fillColor(C.black).text(fmt(data.totalDeuda, currency), PAGE.margin, iy, { width: W, align: 'right' });
        iy += 14;
      }
```

- [ ] **Step 4: Reestructurar el bloque "Deudas Pagadas"**

Reemplazar (líneas 1549-1565):

```js
      // ── Deudas Pagadas: un rectángulo POR MES (separadas), mismo patrón que
      // Deudas Acumuladas — estado (SALDADA) + total arriba a la derecha,
      // "Saldo a favor" abajo si pagó de más. "DEUDAS PAGADAS" es solo un
      // rótulo de sección, no envuelve todo en una caja compartida.
      if (saldadasUni.length > 0) {
        checkBox(SECTION_LABEL_H + pagadaBoxHeights[0] + boxGap);
        doc.font(F.b).fontSize(8).fillColor(C.medium).text('DEUDAS PAGADAS', PAGE.margin, iy);
        iy += SECTION_LABEL_H;
        saldadasUni.forEach((d, i) => {
          const boxH = pagadaBoxHeights[i];
          checkBox(boxH + boxGap);
          fillR(doc, PAGE.margin, iy, W, boxH, C.snow, 0);
          strokeR(doc, PAGE.margin, iy, W, boxH, C.line, 0.5, 0);
          drawMonthBlock(d, iy + 10);
          iy += boxH + boxGap;
        });
      }
```

por:

```js
      // ── Deudas Pagadas: un rectángulo POR MES, con el encabezado (período/
      // estado/total) afuera de la caja. "DEUDAS PAGADAS" es solo un rótulo de
      // sección, no envuelve todo en una caja compartida.
      if (saldadasUni.length > 0) {
        checkBox(SECTION_LABEL_H + MONTH_HEADER_H + pagadaBoxHeights[0] + boxGap);
        doc.font(F.b).fontSize(8).fillColor(C.medium).text('DEUDAS PAGADAS', PAGE.margin, iy);
        iy += SECTION_LABEL_H;
        saldadasUni.forEach((d, i) => {
          const boxH = pagadaBoxHeights[i];
          checkBox(MONTH_HEADER_H + boxH + boxGap);
          iy = drawMonthHeader(d, iy);
          fillR(doc, PAGE.margin, iy, W, boxH, C.snow, 0);
          strokeR(doc, PAGE.margin, iy, W, boxH, C.line, 0.5, 0);
          drawMonthBox(d, iy + 10);
          iy += boxH + boxGap;
        });
      }
```

- [ ] **Step 5: Verificar que no queden referencias a los nombres viejos**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && grep -n "drawMonthBlock\|deudasBoxH\|BOX_TOP\b\|monthBlockH" src/services/pdfTemplates.js`
Expected: sin resultados (las 4 referencias viejas fueron reemplazadas por
`drawMonthHeader`/`drawMonthBox`/`monthBoxH`/`acumuladaBoxHeights`+`pagadaBoxHeights`).
Si aparece algo, revisar que no haya quedado un call site sin actualizar.

- [ ] **Step 6: Smoke test — el archivo carga sin errores de sintaxis**

Run: `cd /home/francisco/Excel/inmobiliaria-app/backend && node -e "require('./src/services/pdfTemplates.js'); console.log('OK')"`
Expected: `OK` (sin excepciones).

- [ ] **Step 7: Commit**

```bash
cd /home/francisco/Excel
git add inmobiliaria-app/backend/src/services/pdfTemplates.js
git commit -m "$(cat <<'EOF'
refactor(reportes): encabezado de mes afuera de la caja (Deudas Acum./Pagadas)

Parte drawMonthBlock en drawMonthHeader (período/estado/total, ahora
afuera de la caja) y drawMonthBox (conceptos + cierre, adentro),
mismo estilo que ya tenía Liquidación Actual. Deudas Acumuladas pasa
de una caja compartida a una caja por mes, igual que Deudas Pagadas.
"Alquiler pendiente" muestra "Ajuste de X%" cuando corresponde.
EOF
)"
```

---

### Task 5: Verificación final (script visual + entorno real)

**Files:**
- No modifica código de producción — solo scripts de verificación en el
  scratchpad de la sesión.

- [ ] **Step 1: Extender el script de prueba con casos de ajuste**

Editar `/tmp/claude-1000/-home-francisco-Excel/9fb190da-fdce-403b-8f99-a83b1c63e346/scratchpad/test_liq.js`
(ya existe de la verificación del fix anterior) para que:
- El concepto de `deudasUnificadas[0]` (PENDIENTE, "Junio 2026") tenga
  `alquilerPendiente: 44500` y `ajustePercent: 12.5` (para ver "Alquiler
  pendiente Ajuste de 12,5%" en Deudas Acumuladas).
- El concepto de `deudasUnificadas[1]` (SALDADA, "Abril 2026") tenga
  `conceptos: [{ tipo: 'ALQUILER_DEUDA', label: 'Pago deuda Alquiler Abril 2026 (Mes 4) Ajuste de 8%', monto: 281250 }, { tipo: 'PUNITORIOS', label: 'Punitorios pagados', monto: 165375 }]`
  (para ver el sufijo ya embebido en Deudas Pagadas — esto no requiere tocar
  `pdfTemplates.js`, es puramente el dato de entrada).

- [ ] **Step 2: Generar el PDF y convertir a PNG**

Run:
```bash
cd /home/francisco/Excel/inmobiliaria-app/backend && node /tmp/claude-1000/-home-francisco-Excel/9fb190da-fdce-403b-8f99-a83b1c63e346/scratchpad/test_liq.js
cd /tmp/claude-1000/-home-francisco-Excel/9fb190da-fdce-403b-8f99-a83b1c63e346/scratchpad && pdftoppm -png -r 200 -f 1 -l 1 test_liq.pdf test_liq_v2_page
```
Expected: `PDF written, size <N>` y un archivo `test_liq_v2_page-1.png` generado.

- [ ] **Step 3: Inspeccionar visualmente**

Leer `test_liq_v2_page-1.png` (herramienta `Read`) y confirmar:
- El encabezado de cada mes (período + estado + total) queda AFUERA de la caja
  gris, igual que el encabezado de propiedad.
- Los conceptos y el monto de cierre ("Falta pagar"/"Saldo a favor") quedan
  claramente ADENTRO de cada caja, con el mismo padding inferior que
  "Liquidación Actual" (sin tocar el borde).
- "DEUDAS ACUMULADAS" muestra "Alquiler pendiente Ajuste de 12,5%".
- "DEUDAS PAGADAS" (Abril 2026) muestra "Pago deuda Alquiler Abril 2026 (Mes 4)
  Ajuste de 8%".
- Un mes SIN ajuste (Mayo 2026, ya en los datos de prueba existentes) no
  muestra ningún sufijo de más.

- [ ] **Step 4: Correr toda la suite de tests unitarios + integración**

Run:
```bash
cd /home/francisco/Excel/inmobiliaria-app/backend
node --test test/reportDataAjuste.test.js
./test/integration/run.sh
```
Expected: ambos comandos terminan en 0 fallos.

- [ ] **Step 5: Verificar contra el entorno local real**

El backend local (nodemon, puerto 3001) ya corre contra la DB Docker
`inmob_local` (puerto 55434) y el frontend (puerto 5173) ya está levantado
desde la sesión anterior — nodemon recarga solo al guardar los cambios de
Tasks 1-4. Generar el reporte "Liquidación General" real desde el frontend
para un contrato con algún ajuste de alquiler en su historial (o, si no hay
ninguno a mano, para cualquier contrato con deuda acumulada/pagada) y
confirmar visualmente que el reporte no rompió con datos reales (paginación,
saltos de página, un mes sin ajuste no muestra texto de más).

- [ ] **Step 6: Commit final (si quedó algo suelto del script de scratchpad que se quiera versionar)**

No aplica — los scripts de verificación viven en el scratchpad de la sesión,
no en el repo. Si en el Step 1 se detectó algún ajuste necesario al código de
producción, volver a la Task correspondiente, corregir, y repetir Steps 2-3
antes de dar la Task 5 por cerrada.
