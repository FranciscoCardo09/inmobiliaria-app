# Cobertura de tests: punitorios + descuentos (caso Godoy) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated regression test file (`backend/tests/punitoryBaseDescuento.test.js`) that locks in the fix for the Godoy bug (a real discount/bonificación that fully covers the net total was still generating phantom late-fee interest), across every layer the bug touched: the pure `computePunitoryBase` function, `computeLiveRecordPunitory`, the full `monthlyRecordService` recalculation cascade (including a 20-partial-payment convergence scenario), and the two `debtService.js` call sites that had the identical clamp.

**Architecture:** One new node:test file, following the codebase's existing pattern exactly: `proxyquire` to inject a shared in-memory fake Prisma client (`tests/helpers/fakePrisma.js`) into the real service modules, so every test exercises the REAL business logic with zero real database access. No existing files are modified; no shared test infrastructure changes.

**Tech Stack:** node:test, node:assert/strict, proxyquire (already a devDependency).

## Global Constraints

- New file only: `backend/tests/punitoryBaseDescuento.test.js`. Do not modify any of the ~40 existing test files or `tests/helpers/fakePrisma.js`.
- All tests are unit tests: no real Postgres, no Docker, no network. Use `makeFakePrisma()` from `tests/helpers/fakePrisma.js` exclusively.
- Use `node:assert/strict` with `.equal()` (aliased to `strictEqual`) and `.ok()`, matching the convention in `tests/saldoAFavorReconciliation.test.js` and `tests/punitoryBase.test.js`.
- Any test whose correctness depends on "how many days have passed since a date" must use a period fixed safely in the past (`periodMonth: 3, periodYear: 2020`) so the test never becomes flaky or date-dependent when run in the future — this is exact convention verified during planning, not a suggestion to vary.
- Run tests with `cd inmobiliaria-app/backend && npm run test:unit` (not bare `npm test`, which also picks up `test/integration/docker-test-db.js` as a false-failing test outside Docker).
- The fix already exists and is committed (`0ebc81b`, `src/utils/punitory.js` + `src/services/paymentTransactionService.js` + `src/services/debtService.js`). Every test in this plan is expected to PASS immediately, since it's a regression test for an already-fixed bug — there is no "make the failing test pass" implementation step in this plan. The final task instead proves each section would have FAILED before the fix, by temporarily reverting it.

---

### Task 1: File header + Section A (`computePunitoryBase` pure matrix)

**Files:**
- Create: `backend/tests/punitoryBaseDescuento.test.js`

**Interfaces:**
- Consumes: `computePunitoryBase` from `../src/utils/punitory` (real, unmocked — pure function, no DB).
- Produces: nothing consumed by later tasks except the growing file itself (later tasks append to this file).

- [ ] **Step 1: Write the file with its header and Section A**

```js
'use strict';

/**
 * Cobertura de tests: punitorios + descuentos/bonificaciones (caso Godoy)
 *
 * Bug real (2026-07-23, Godoy Fernando Alberto, Los Pinos 4031 Torre 2 1B,
 * julio 2026): computePunitoryBase (src/utils/punitory.js) y sus 5
 * call-sites pre-recortaban servicesTotal con Math.max(servicesTotal, 0)
 * antes de comparar lo pagado contra el total adeudado. Un mes con un
 * descuento/bonificación real (servicesTotal negativo, ej. "Cocina cuota 2
 * de 3": -$123.333) que cubría parte del alquiler nunca podía saldarse del
 * todo: el pago del total NETO exacto seguía comparándose contra el
 * alquiler BRUTO sin descuento, dejando un saldo fantasma que devengaba
 * mora en vivo contra la fecha de HOY (crecía cada día que el pago tardara
 * en registrarse). Fix (commit 0ebc81b): si lo pagado ya cubre el total
 * NETO, la base de punitorio es 0.
 *
 * Ver spec: docs/superpowers/specs/2026-07-23-punitory-discount-tests-design.md
 *
 * Run: cd inmobiliaria-app/backend && npm run test:unit
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

const { computePunitoryBase, computeLiveRecordPunitory } = realPunitory;

// ─── A. computePunitoryBase — matriz de casos puros ────────────────────────

describe('A. computePunitoryBase — descuento/bonificación que deja el neto pagado', () => {
  test('A1: descuento parcial + pago exacto del neto → base = 0 (regresión directa, caso Godoy)', () => {
    // rentAmount=100000, descuento=-30000 → neto=70000; paga exactamente 70000.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 70000 });
    assert.equal(base, 0);
  });

  test('A2: descuento parcial + pago parcial (menor al neto) → base = alquiler bruto − pagado (la tasa NO usa el descuento)', () => {
    // neto=70000 pero solo pagó 50000 (sigue debiendo). Base = rentAmount(100000, servicesTotal clampeado a 0) − 50000 = 50000.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 50000 });
    assert.equal(base, 50000);
  });

  test('A3: descuento parcial + sobrepago → base = 0', () => {
    // neto=70000, pagó 80000 (de más).
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 80000 });
    assert.equal(base, 0);
  });

  test('A4: descuento que EXCEDE el alquiler bruto + nada pagado → base = solo alquiler (no negativa, no cero)', () => {
    // servicesTotal=-150000 (bonificación mayor al alquiler) → neto negativo, pero sin ningún pago
    // real la regla "sin pago, base = solo alquiler" no cambia.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -150000, ivaAmount: 0, amountPaid: 0 });
    assert.equal(base, 100000);
  });

  test('A5 (control, sin descuento): servicios positivos + pago exacto del neto → base = 0', () => {
    // Confirma que el camino SIN descuento (ya cubierto por tests/punitory.test.js) sigue igual.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: 30000, ivaAmount: 0, amountPaid: 130000 });
    assert.equal(base, 0);
  });

  test('A6: con IVA + descuento parcial + pago exacto del neto (alquiler+servicios+IVA) → base = 0', () => {
    // neto = 100000 - 30000 + 21000 = 91000.
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 21000, amountPaid: 91000 });
    assert.equal(base, 0);
  });

  test('A7: pago exacto MENOS un margen → base > 0 (la tolerancia de redondeo no debe tapar un pendiente real)', () => {
    // neto=70000, pagó 69999 (1 peso de menos, bien afuera de la tolerancia de $0,01).
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 69999 });
    assert.ok(base > 0, `esperaba base > 0 (todavía pendiente $1), dio ${base}`);
    assert.equal(base, 30001); // 100000 (clampeado) - 69999
  });

  test('A8: pago exacto MÁS un centavo → base = 0 (la tolerancia de $0,01 sí cubre diferencias de redondeo)', () => {
    const base = computePunitoryBase({ rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, amountPaid: 70000.01 });
    assert.equal(base, 0);
  });
});
```

- [ ] **Step 2: Run it to verify Section A passes**

Run: `cd inmobiliaria-app/backend && node --test tests/punitoryBaseDescuento.test.js`
Expected: `# tests 8`, `# pass 8`, `# fail 0`.

- [ ] **Step 3: Commit**

```bash
cd inmobiliaria-app/backend
git add tests/punitoryBaseDescuento.test.js
git commit -m "test(punitorios): matriz de computePunitoryBase con descuentos (Sección A)"
```

---

### Task 2: Section B (`computeLiveRecordPunitory`)

**Files:**
- Modify: `backend/tests/punitoryBaseDescuento.test.js` (append after Section A's `describe` block)

**Interfaces:**
- Consumes: `computeLiveRecordPunitory` (already destructured in Task 1's requires).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Append Section B**

Add this new `describe` block at the end of the file (after Section A's closing `});`):

```js

// ─── B. computeLiveRecordPunitory — mismo caso a través de la función de más
// alto nivel (usa la fecha real de "hoy" como calculationDate por defecto) ──

describe('B. computeLiveRecordPunitory — no hay mora fantasma aunque pasen muchos días', () => {
  const CONTRACT = { punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  // Período fijo y seguro en el pasado (nunca queda "en el futuro" sin importar
  // cuándo corra este test): 2020, muy anterior a la fecha real del sistema.
  const PERIOD_MONTH = 3;
  const PERIOD_YEAR = 2020;

  test('B1: descuento parcial + pago exacto del neto → amount = 0 sin importar los días transcurridos', () => {
    const record = {
      rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, includeIva: false,
      amountPaid: 70000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, isPostExpiry: false,
      transactions: [{
        paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0),
        punitoryForgiven: false, concepts: [{ type: 'ALQUILER', amount: 70000 }],
      }],
    };
    const result = computeLiveRecordPunitory(record, CONTRACT, [], { isFullyPaid: false });
    assert.equal(result.amount, 0);
    assert.equal(result.days, 0);
  });

  test('B2 (control, sin descuento): servicios positivos + pago exacto del neto → amount = 0', () => {
    const record = {
      rentAmount: 100000, servicesTotal: 30000, ivaAmount: 0, includeIva: false,
      amountPaid: 130000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, isPostExpiry: false,
      transactions: [{
        paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0),
        punitoryForgiven: false, concepts: [{ type: 'ALQUILER', amount: 130000 }],
      }],
    };
    const result = computeLiveRecordPunitory(record, CONTRACT, [], { isFullyPaid: false });
    assert.equal(result.amount, 0);
  });

  test('B3: descuento parcial + pago GENUINAMENTE parcial → amount > 0 (la regla de tasa bruta sigue vigente)', () => {
    const record = {
      rentAmount: 100000, servicesTotal: -30000, ivaAmount: 0, includeIva: false,
      amountPaid: 50000, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, isPostExpiry: false,
      transactions: [{
        paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0),
        punitoryForgiven: false, concepts: [{ type: 'ALQUILER', amount: 50000 }],
      }],
    };
    const result = computeLiveRecordPunitory(record, CONTRACT, [], { isFullyPaid: false });
    assert.ok(result.amount > 0, `esperaba mora > 0 (pago genuinamente parcial), dio ${result.amount}`);
  });
});
```

- [ ] **Step 2: Run it to verify Sections A+B pass**

Run: `cd inmobiliaria-app/backend && node --test tests/punitoryBaseDescuento.test.js`
Expected: `# tests 11`, `# pass 11`, `# fail 0`.

- [ ] **Step 3: Commit**

```bash
cd inmobiliaria-app/backend
git add tests/punitoryBaseDescuento.test.js
git commit -m "test(punitorios): computeLiveRecordPunitory con descuentos (Sección B)"
```

---

### Task 3: Section C (convergencia real vía `monthlyRecordService.recalculateMultipleRecords`)

**Files:**
- Modify: `backend/tests/punitoryBaseDescuento.test.js` (append)

**Interfaces:**
- Consumes: `makeFakePrisma` (Task 1's require), `proxyquire`, `realPunitory` (Task 1's requires).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Append Section C**

Add this new `describe` block at the end of the file:

```js

// ─── C. Flujo completo: monthlyRecordService.recalculateMultipleRecords REAL,
// contra un MonthlyRecord con las transacciones ya embebidas (mismo patrón que
// el resto de la suite: fakePrisma no resuelve relaciones `include`, así que
// se arma el estado final -o el estado de un punto intermedio- directamente,
// en vez de encadenar llamadas reales a registerPayment). ─────────────────

describe('C. Convergencia real (monthlyRecordService.recalculateMultipleRecords)', () => {
  function makeMonthlyRecordService(prisma) {
    return proxyquire('../src/services/monthlyRecordService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
      './debtService': { calculateDebtPunitory: async () => ({}) },
      './adjustmentService': { calculateNextAdjustmentMonth: async () => null },
    });
  }

  // Caso real Godoy, a escala real: alquiler $680.000, descuento "Cocina cuota
  // 2 de 3" -$123.333, dos impuestos ($8.740 + $28.760) → servicesTotal neto
  // = -85.833; total neto adeudado = 594.167.
  const RENT = 680000;
  const SERVICES = [
    { amount: 123333, conceptType: { category: 'DESCUENTO' } },
    { amount: 8740, conceptType: { category: 'IMPUESTO' } },
    { amount: 28760, conceptType: { category: 'IMPUESTO' } },
  ];
  const NET_TOTAL = 594167; // 680000 - 123333 + 8740 + 28760
  const CONTRACT = { punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const PERIOD_MONTH = 3;
  const PERIOD_YEAR = 2020; // bien en el pasado: siempre "vencido", sin importar cuándo corra el test

  function makeTx(amount, day) {
    const date = new Date(PERIOD_YEAR, PERIOD_MONTH - 1, day, 12, 0, 0);
    return {
      amount, paymentDate: date, createdAt: date,
      punitoryForgiven: false, punitoryAmount: 0,
      concepts: [{ type: 'ALQUILER', amount }],
    };
  }

  async function makeRecord(prisma, id, transactions, overrides = {}) {
    await prisma.monthlyRecord.create({
      data: {
        id, groupId: 'g1', contractId: 'c1',
        monthNumber: 2, periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR,
        status: 'PENDING', isPaid: false, isCancelled: false,
        rentAmount: RENT, servicesTotal: 0, // se recalcula desde services[] igual
        includeIva: false, ivaAmount: 0,
        previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
        balanceForgiven: 0, amountPaid: 0, totalDue: 0, balance: 0,
        fullPaymentDate: null, needsRecalculation: false,
        services: SERVICES,
        transactions,
        contract: CONTRACT,
        ...overrides,
      },
    });
  }

  test('C1: caso Godoy exacto — un solo pago cubre el neto exacto → COMPLETE, balance 0, sin mora', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);
    await makeRecord(prisma, 'mr-c1', [makeTx(NET_TOTAL, 9)]);

    await monthlyRecordService.recalculateMultipleRecords(['mr-c1'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c1' } });

    assert.equal(updated.totalDue, NET_TOTAL);
    assert.equal(updated.amountPaid, NET_TOTAL);
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.punitoryAmount, 0);
  });

  test('C2: 20 pagos parciales que suman EXACTO el neto → converge a COMPLETE/$0, sin importar la fragmentación', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);

    // 19 pagos de $30.000 + 1 pago final de $24.167 = $594.167 (NET_TOTAL exacto).
    const transactions = [];
    for (let i = 0; i < 19; i++) transactions.push(makeTx(30000, 1));
    transactions.push(makeTx(24167, 28));
    assert.equal(transactions.reduce((s, t) => s + t.amount, 0), NET_TOTAL, 'sanity check de la suma de las 20 cuotas');

    await makeRecord(prisma, 'mr-c2', transactions);
    await monthlyRecordService.recalculateMultipleRecords(['mr-c2'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c2' } });

    assert.equal(updated.amountPaid, NET_TOTAL);
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.punitoryAmount, 0);
  });

  test('C2b: a mitad de camino (19 de los 20 pagos) sigue PARTIAL con mora real, no se zanja antes de tiempo', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);

    const transactions = [];
    for (let i = 0; i < 19; i++) transactions.push(makeTx(30000, 1)); // suma 570000, faltan 24167

    await makeRecord(prisma, 'mr-c2b', transactions);
    await monthlyRecordService.recalculateMultipleRecords(['mr-c2b'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c2b' } });

    assert.equal(updated.amountPaid, 570000);
    assert.equal(updated.status, 'PARTIAL');
    assert.ok(updated.balance < 0, `esperaba saldo pendiente negativo, dio ${updated.balance}`);
    assert.ok(updated.punitoryAmount > 0, 'con pago genuinamente parcial, la mora sobre la tasa bruta debe seguir corriendo');
  });

  test('C3: sobrepago (la cuota 20 se pasa del neto) → balance positivo (saldo a favor), sin mora', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);

    const transactions = [];
    for (let i = 0; i < 19; i++) transactions.push(makeTx(30000, 1)); // 570000
    transactions.push(makeTx(30000, 28)); // última cuota de $30.000 en vez de $24.167 → paga $600.000 (de más)

    await makeRecord(prisma, 'mr-c3', transactions);
    await monthlyRecordService.recalculateMultipleRecords(['mr-c3'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c3' } });

    assert.equal(updated.amountPaid, 600000);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.balance, 5833); // 600000 - 594167
    assert.equal(updated.punitoryAmount, 0);
  });

  test('C4 (control, SIN descuento): pagos parciales fragmentados sin ningún descuento → sigue funcionando igual que antes', async () => {
    const prisma = makeFakePrisma();
    const monthlyRecordService = makeMonthlyRecordService(prisma);
    const noDiscountServices = [{ amount: 20000, conceptType: { category: 'IMPUESTO' } }];
    const netNoDiscount = 100000 + 20000; // rentAmount fijo de este test = 100000

    await prisma.monthlyRecord.create({
      data: {
        id: 'mr-c4', groupId: 'g1', contractId: 'c1',
        monthNumber: 2, periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR,
        status: 'PENDING', isPaid: false, isCancelled: false,
        rentAmount: 100000, servicesTotal: 0,
        includeIva: false, ivaAmount: 0,
        previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
        balanceForgiven: 0, amountPaid: 0, totalDue: 0, balance: 0,
        fullPaymentDate: null, needsRecalculation: false,
        services: noDiscountServices,
        transactions: [makeTx(60000, 1), makeTx(60000, 28)], // 2 pagos de 60000 = 120000 = netNoDiscount
        contract: CONTRACT,
      },
    });

    await monthlyRecordService.recalculateMultipleRecords(['mr-c4'], null, true);
    const updated = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-c4' } });

    assert.equal(updated.amountPaid, netNoDiscount);
    assert.equal(updated.balance, 0);
    assert.equal(updated.status, 'COMPLETE');
    assert.equal(updated.punitoryAmount, 0);
  });
});
```

- [ ] **Step 2: Run it to verify Sections A+B+C pass**

Run: `cd inmobiliaria-app/backend && node --test tests/punitoryBaseDescuento.test.js`
Expected: `# tests 16`, `# pass 16`, `# fail 0`.

- [ ] **Step 3: Commit**

```bash
cd inmobiliaria-app/backend
git add tests/punitoryBaseDescuento.test.js
git commit -m "test(punitorios): convergencia real con 20 pagos parciales y descuento (Sección C)"
```

---

### Task 4: Section D (`debtService.js` call sites)

**Files:**
- Modify: `backend/tests/punitoryBaseDescuento.test.js` (append)

**Interfaces:**
- Consumes: `makeFakePrisma`, `proxyquire`, `realPunitory` (Task 1's requires).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Append Section D**

Add this new `describe` block at the end of the file:

```js

// ─── D. debtService.js — mismos call-sites con el clamp original ──────────

describe('D. debtService: descuento que deja el neto pagado no crea/mantiene deuda fantasma', () => {
  const CONTRACT = { id: 'c1', groupId: 'g1', punitoryStartDay: 1, punitoryGraceDay: 10, punitoryPercent: 0.006 };
  const PERIOD_MONTH = 3;
  const PERIOD_YEAR = 2020;
  const RENT = 680000;
  const SERVICES_TOTAL_NET = -85833; // mismo descuento neto que el caso Godoy (Sección C)
  const NET_TOTAL = 594167;

  test('D1: createDebtFromMonthlyRecord — no crea deuda fantasma cuando el descuento deja el neto pagado', async () => {
    const prisma = makeFakePrisma();
    const { createDebtFromMonthlyRecord } = proxyquire('../src/services/debtService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    });

    const monthlyRecord = {
      id: 'mr-d1', periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, monthNumber: 2,
      rentAmount: RENT, servicesTotal: SERVICES_TOTAL_NET, ivaAmount: 0,
      punitoryAmount: 0, previousBalance: 0, amountPaid: NET_TOTAL,
      status: 'PARTIAL', // aún no marcado COMPLETE en el momento del cierre de mes
      punitoryForgiven: false,
      transactions: [{ paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0) }],
    };

    const debt = await createDebtFromMonthlyRecord(monthlyRecord, CONTRACT);
    assert.equal(debt, null, 'no debe crear ninguna deuda: el descuento ya deja el neto pagado');
  });

  test('D2: recalculateDebtFromMonthlyRecord — una deuda con punitorio fantasma se corrige a $0/PAID cuando el descuento deja el neto pagado', async () => {
    const prisma = makeFakePrisma();
    const { recalculateDebtFromMonthlyRecord } = proxyquire('../src/services/debtService', {
      '../lib/prisma': prisma,
      '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    });

    await prisma.monthlyRecord.create({
      data: {
        id: 'mr-d2', periodMonth: PERIOD_MONTH, periodYear: PERIOD_YEAR, monthNumber: 2,
        rentAmount: RENT, servicesTotal: SERVICES_TOTAL_NET, ivaAmount: 0,
        punitoryAmount: 0, amountPaid: NET_TOTAL, status: 'PARTIAL', punitoryForgiven: false,
        transactions: [{ paymentDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 9, 12, 0, 0) }],
      },
    });
    await prisma.contract.create({ data: CONTRACT });
    await prisma.debt.create({
      data: {
        id: 'debt-d2', contractId: 'c1', monthlyRecordId: 'mr-d2', status: 'OPEN',
        amountPaid: 0, appliedCredit: 0,
        accumulatedPunitory: 50000, // valor fantasma ya persistido antes de este recálculo
        punitoryStartDate: new Date(PERIOD_YEAR, PERIOD_MONTH - 1, 1),
        originalAmount: 0, unpaidRentAmount: 0, unpaidServicesAmount: 0, currentTotal: 50000,
      },
    });

    const updatedDebt = await recalculateDebtFromMonthlyRecord('debt-d2', 'mr-d2');
    assert.equal(updatedDebt.accumulatedPunitory, 0);
    assert.equal(updatedDebt.currentTotal, 0);
    assert.equal(updatedDebt.status, 'PAID');

    const record = await prisma.monthlyRecord.findUnique({ where: { id: 'mr-d2' } });
    assert.equal(record.status, 'COMPLETE', 'el MonthlyRecord debe sincronizarse a COMPLETE cuando la deuda queda saldada');
  });
});
```

- [ ] **Step 2: Run it to verify Sections A+B+C+D pass**

Run: `cd inmobiliaria-app/backend && node --test tests/punitoryBaseDescuento.test.js`
Expected: `# tests 18`, `# pass 18`, `# fail 0`.

- [ ] **Step 3: Commit**

```bash
cd inmobiliaria-app/backend
git add tests/punitoryBaseDescuento.test.js
git commit -m "test(punitorios): debtService no crea/mantiene deuda fantasma (Sección D)"
```

---

### Task 5: Prove the suite would have caught the bug, then run the full regression

**Files:** none created/modified — this task only runs commands and temporarily reverts/restores existing tracked files.

**Interfaces:** none.

- [ ] **Step 1: Confirm current state is clean**

Run: `cd inmobiliaria-app/backend && git status --short src/utils/punitory.js src/services/paymentTransactionService.js src/services/debtService.js`
Expected: no output (both files match the committed fix, nothing uncommitted).

- [ ] **Step 2: Temporarily revert the fix commit**

```bash
cd inmobiliaria-app/backend
git revert --no-commit 0ebc81b
```
Expected: the revert applies cleanly (the 3 files return to their pre-fix, clamping state). If it reports a conflict, stop and re-inspect — do not force through.

- [ ] **Step 3: Run the new test file and confirm it now FAILS**

Run: `node --test tests/punitoryBaseDescuento.test.js`
Expected: multiple `not ok` failures (at minimum A1, A3, A6, A8, B1, B2, C1, C2, C3, C4, D1, D2 — every case whose expected value is `0`/`null`/`COMPLETE`/`PAID` should now fail, since the code is back to the clamped, buggy version). This is the proof the new tests would have caught the Godoy bug before it reached production.

- [ ] **Step 4: Restore the fix**

```bash
git revert --abort 2>/dev/null; git checkout -- src/utils/punitory.js src/services/paymentTransactionService.js src/services/debtService.js
git status --short src/utils/punitory.js src/services/paymentTransactionService.js src/services/debtService.js
```
Expected: no output (files back to the committed fix). If `git revert --no-commit` from Step 2 left the revert applied without committing, `git checkout -- <files>` discards that uncommitted revert and restores the last commit's content for those 3 files.

- [ ] **Step 5: Confirm the new file passes again**

Run: `node --test tests/punitoryBaseDescuento.test.js`
Expected: `# tests 18`, `# pass 18`, `# fail 0`.

- [ ] **Step 6: Run the full unit suite to confirm zero regressions elsewhere**

Run: `npm run test:unit`
Expected: same pass/fail counts as the pre-existing baseline plus the 18 new tests — i.e. `# fail 6` (the pre-existing, unrelated `liquidacion.test.js` DB-fixture-drift failures documented before this work started) and no other new failures. If the fail count differs from 6, investigate before proceeding — a new failure means Section A-D's fixtures interact badly with another file (unlikely, since this is a new, isolated file, but verify).

- [ ] **Step 7: Final status check and no further commit needed**

Run: `git status --short`
Expected: clean (Task 5 made no permanent changes — the revert was fully undone in Step 4). No commit for this task; Tasks 1-4 already committed the actual deliverable.

## Self-Review Notes (for whoever executes this plan)

- Spec coverage: Sections A (8 cases), B (3 cases), C (5 cases including the 20-payment convergence), D (2 cases) match the approved spec's sections A-D one-to-one.
- All test code above is complete and final — no placeholders, no "similar to above" shortcuts.
- Every numeric assertion was hand-verified against the exact formulas in `computePunitoryBase`, `computeLiveRecordPunitory`, `_recalculateCore` (`monthlyRecordService.js`), `calculateImputation`, `createDebtFromMonthlyRecord`, and `recalculateDebtFromMonthlyRecord` during planning — see the arithmetic in each test's inline comment.
- Deviation from the original spec wording: Section C's tests call `monthlyRecordService.recalculateMultipleRecords` directly against a `MonthlyRecord` with transactions embedded at creation, rather than calling `paymentTransactionService.registerPayment` repeatedly. This was a deliberate, user-approved adjustment made during planning: `tests/helpers/fakePrisma.js` does not resolve Prisma relational `include`, so a real `registerPayment` call's internal recalculation cannot see transactions created by an earlier `registerPayment` call in the same test — every existing test in the suite that uses the real `monthlyRecordService` sidesteps this identically, by embedding the final (or checkpoint) transaction list directly.
