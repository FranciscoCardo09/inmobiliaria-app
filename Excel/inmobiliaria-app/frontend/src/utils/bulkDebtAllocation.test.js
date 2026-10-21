// Tests de la lógica pura de "Pagar varias". Correr con: npm test (node --test).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  effectiveTotal,
  conceptCoverage,
  allocateBulkPayment,
  summarizeAllocation,
  selectBulkDebts,
  splitBulkSelection,
  bulkItemKey,
  selectBulkForRecord,
} from './bulkDebtAllocation.js'

// Deuda sin crédito: las líneas suman exacto el total (como las devuelve el preview).
const debt = (id, periodMonth, periodYear, { rent = 100000, services = 0, iva = 0, punitory = 0, days = 0, total } = {}) => ({
  type: 'DEBT', id, periodLabel: `${periodMonth}/${periodYear}`, periodMonth, periodYear,
  remainingRent: rent, remainingServices: services, iva, punitory, punitoryDays: days,
  totalToPay: total ?? rent + services + iva + punitory,
})

const JUL = debt('jul', 7, 2026, { rent: 100000, services: 20000, iva: 21000, punitory: 6000, days: 10 }) // 147.000
const AGO = debt('ago', 8, 2026, { rent: 100000, punitory: 3000 }) // 103.000
const SEP = debt('sep', 9, 2026, { rent: 100000 }) // 100.000
const ITEMS = [JUL, AGO, SEP] // total 350.000

const statuses = (alloc) => alloc.rows.map((r) => r.status)

// ─── Reparto (waterfall) ──────────────────────────────────────────────────────

test('monto 0: no cubre nada, falta todo', () => {
  const a = allocateBulkPayment(ITEMS, 0)
  assert.deepEqual(statuses(a), ['NONE', 'NONE', 'NONE'])
  assert.equal(a.overpay, 0)
  const s = summarizeAllocation(a)
  assert.equal(s.full.length, 0)
  assert.equal(s.partial, null)
  assert.equal(s.none.length, 3)
  assert.equal(s.missingTotal, 350000)
})

test('monto negativo o NaN se trata como 0 (nunca reparte plata negativa)', () => {
  for (const amount of [-5000, NaN]) {
    const a = allocateBulkPayment(ITEMS, amount)
    assert.deepEqual(statuses(a), ['NONE', 'NONE', 'NONE'])
    assert.ok(a.rows.every((r) => r.applied === 0))
    assert.equal(a.overpay, 0)
  }
})

test('menos que el primer mes: el más viejo queda parcial, el resto sin cubrir', () => {
  const a = allocateBulkPayment(ITEMS, 60000)
  assert.deepEqual(statuses(a), ['PARTIAL', 'NONE', 'NONE'])
  const s = summarizeAllocation(a)
  assert.equal(s.full.length, 0)
  assert.equal(s.partial.id, 'jul')
  assert.equal(s.partial.applied, 60000)
  assert.equal(s.partial.pending, 87000)
  assert.equal(s.missingTotal, 290000)
})

test('justo el primer mes: completo, los demás sin cubrir', () => {
  const a = allocateBulkPayment(ITEMS, 147000)
  assert.deepEqual(statuses(a), ['FULL', 'NONE', 'NONE'])
  assert.equal(summarizeAllocation(a).partial, null)
})

test('justo dos meses', () => {
  const a = allocateBulkPayment(ITEMS, 250000)
  assert.deepEqual(statuses(a), ['FULL', 'FULL', 'NONE'])
  assert.equal(summarizeAllocation(a).missingTotal, 100000)
})

test('dos meses y medio: el tercero parcial con lo que falta exacto', () => {
  const a = allocateBulkPayment(ITEMS, 300000)
  assert.deepEqual(statuses(a), ['FULL', 'FULL', 'PARTIAL'])
  const s = summarizeAllocation(a)
  assert.equal(s.partial.id, 'sep')
  assert.equal(s.partial.applied, 50000)
  assert.equal(s.partial.pending, 50000)
  assert.equal(s.missingTotal, 50000)
})

test('monto exacto del total: cancela todo, sin sobrante', () => {
  const a = allocateBulkPayment(ITEMS, 350000)
  assert.deepEqual(statuses(a), ['FULL', 'FULL', 'FULL'])
  assert.equal(a.overpay, 0)
  assert.equal(summarizeAllocation(a).missingTotal, 0)
})

test('más que el total: cancela todo y el excedente queda como sobrante', () => {
  const a = allocateBulkPayment(ITEMS, 400000)
  assert.deepEqual(statuses(a), ['FULL', 'FULL', 'FULL'])
  assert.equal(a.overpay, 50000)
  assert.ok(a.rows.every((r) => r.applied === r.totalToPay), 'ningún mes recibe más que su total')
})

test('tolerancia de redondeo: faltar menos de $1 cuenta como completo', () => {
  const a = allocateBulkPayment(ITEMS, 146999.5)
  assert.equal(a.rows[0].status, 'FULL')
})

test('faltar $2 o más NO es completo: el mes queda parcial y se ve lo que falta', () => {
  for (const short of [2, 50, 1000]) {
    const row = allocateBulkPayment(ITEMS, 147000 - short).rows[0]
    assert.equal(row.status, 'PARTIAL', `faltando $${short}`)
    assert.equal(row.pending, short)
  }
})

test('aplicar menos de 50 centavos cuenta como "sin cubrir"', () => {
  const a = allocateBulkPayment(ITEMS, 0.4)
  assert.equal(a.rows[0].status, 'NONE')
})

test('sin meses: no explota', () => {
  const a = allocateBulkPayment([], 1000)
  assert.deepEqual(a.rows, [])
  assert.equal(a.overpay, 1000)
  assert.equal(summarizeAllocation(a).missingTotal, 0)
})

test('el orden lo dan los ítems (el backend los manda del más viejo al más nuevo)', () => {
  const a = allocateBulkPayment([JUL, AGO], 103000)
  // 103.000 no alcanza para Julio (147.000): Julio parcial, Agosto sin cubrir.
  assert.deepEqual(statuses(a), ['PARTIAL', 'NONE'])
})

test('invariante: aplicado + sobrante = monto, y aplicado + faltante = total, para muchos montos', () => {
  for (let amount = 0; amount <= 420000; amount += 7919) {
    const a = allocateBulkPayment(ITEMS, amount)
    const applied = a.rows.reduce((s, r) => s + r.applied, 0)
    const missing = summarizeAllocation(a).missingTotal
    assert.ok(Math.abs(applied + a.overpay - amount) < 1e-6, `monto ${amount}`)
    assert.ok(Math.abs(applied + missing - 350000) < 1e-6, `monto ${amount}`)
    // A lo sumo UN mes parcial, y nunca un mes cubierto después de uno incompleto.
    const st = statuses(a)
    assert.ok(st.filter((x) => x === 'PARTIAL').length <= 1, `monto ${amount}: ${st}`)
    const firstIncomplete = st.findIndex((x) => x !== 'FULL')
    if (firstIncomplete >= 0) {
      assert.ok(st.slice(firstIncomplete + 1).every((x) => x === 'NONE'), `monto ${amount}: ${st}`)
    }
  }
})

// ─── Condonar punitorios ──────────────────────────────────────────────────────

test('condonar punitorios baja el total de cada mes y no deja el punitorio en el detalle', () => {
  assert.equal(effectiveTotal(JUL, true), 141000)
  assert.equal(effectiveTotal(JUL, false), 147000)
  const a = allocateBulkPayment(ITEMS, 241000, true) // Julio 141.000 + Agosto 100.000
  assert.deepEqual(statuses(a), ['FULL', 'FULL', 'NONE'])
  const partial = allocateBulkPayment(ITEMS, 130000, true).rows[0]
  assert.ok(!partial.coverage.some((c) => c.label === 'Punitorios'))
})

test('condonar con punitorio mayor que el total nunca da total negativo', () => {
  assert.equal(effectiveTotal({ totalToPay: 100, punitory: 500 }, true), 0)
})

// ─── Detalle por concepto del mes parcial ─────────────────────────────────────

test('deuda: imputa servicios → IVA → alquiler → punitorios (orden de payDebt)', () => {
  const row = allocateBulkPayment([JUL], 60000).rows[0]
  assert.deepEqual(row.coverage.map((c) => [c.label, c.paid, c.missing]), [
    ['Servicios', 20000, 0],
    ['IVA', 21000, 0],
    ['Alquiler', 19000, 81000],
    ['Punitorios', 0, 6000],
  ])
})

test('mes actual: imputa servicios → alquiler → IVA → punitorios (orden de registerPayment)', () => {
  const record = { ...JUL, type: 'RECORD', id: 'oct' }
  const cov = conceptCoverage(record, 125000)
  assert.deepEqual(cov.map((c) => [c.label, c.paid, c.missing]), [
    ['Servicios', 20000, 0],
    ['Alquiler', 100000, 0],
    ['IVA', 5000, 16000],
    ['Punitorios', 0, 6000],
  ])
})

test('conceptos en 0 no aparecen en el detalle', () => {
  const cov = allocateBulkPayment([AGO], 50000).rows[0].coverage
  assert.deepEqual(cov.map((c) => c.label), ['Alquiler', 'Punitorios'])
})

test('con saldo a favor (las líneas suman más que el total) NO se inventa el detalle', () => {
  const withCredit = debt('x', 7, 2026, { rent: 100000, services: 20000, total: 90000 })
  const row = allocateBulkPayment([withCredit], 50000).rows[0]
  assert.equal(row.status, 'PARTIAL')
  assert.equal(row.coverage, null)
})

test('con descuento (servicios netos negativos) NO se inventa el detalle', () => {
  const withDiscount = { ...debt('x', 10, 2026, { rent: 100000 }), type: 'RECORD', remainingServices: -10000, totalToPay: 90000 }
  assert.equal(conceptCoverage(withDiscount, 50000), null)
})

test('el detalle solo se calcula para el mes parcial', () => {
  const a = allocateBulkPayment(ITEMS, 300000)
  assert.equal(a.rows[0].coverage, null)
  assert.equal(a.rows[1].coverage, null)
  assert.ok(Array.isArray(a.rows[2].coverage))
})

// ─── Qué deudas se ofrecen desde el modal de una deuda ───────────────────────

const OPEN = [
  { id: 'dic', periodMonth: 12, periodYear: 2025 },
  { id: 'ene', periodMonth: 1, periodYear: 2026 },
  { id: 'feb', periodMonth: 2, periodYear: 2026 },
]

test('bloqueada por una deuda vieja: de la más vieja hasta esta inclusive (cruza el año)', () => {
  const sel = selectBulkDebts({ openDebts: OPEN, debt: OPEN[1], isBlocked: true, blocker: { type: 'DEBT' } })
  assert.deepEqual(sel.map((d) => d.id), ['dic', 'ene'])
})

test('bloqueada en la más nueva: entran todas', () => {
  const sel = selectBulkDebts({ openDebts: OPEN, debt: OPEN[2], isBlocked: true, blocker: { type: 'DEBT' } })
  assert.deepEqual(sel.map((d) => d.id), ['dic', 'ene', 'feb'])
})

test('no bloqueada (es la más vieja) y hay más deudas: entran todas', () => {
  const sel = selectBulkDebts({ openDebts: OPEN, debt: OPEN[0], isBlocked: false, blocker: null })
  assert.deepEqual(sel.map((d) => d.id), ['dic', 'ene', 'feb'])
})

test('bloqueada por un mes PARCIAL sin deuda: no se ofrece (el backend lo rechazaría)', () => {
  const sel = selectBulkDebts({ openDebts: OPEN, debt: OPEN[2], isBlocked: true, blocker: { type: 'RECORD' } })
  assert.deepEqual(sel, [])
})

test('una sola deuda: no se ofrece pagar varias', () => {
  assert.deepEqual(selectBulkDebts({ openDebts: [OPEN[0]], debt: OPEN[0], isBlocked: false }), [])
})

test('la deuda abierta no está en la lista (ya pagada / datos viejos): no se ofrece', () => {
  const ghost = { id: 'otra', periodMonth: 3, periodYear: 2026 }
  assert.deepEqual(selectBulkDebts({ openDebts: OPEN, debt: ghost, isBlocked: false }), [])
})

test('sin deuda o sin lista todavía (cargando): no se ofrece', () => {
  assert.deepEqual(selectBulkDebts({ openDebts: OPEN, debt: null, isBlocked: false }), [])
  assert.deepEqual(selectBulkDebts({ openDebts: undefined, debt: OPEN[0], isBlocked: false }), [])
})

// ─── Meses terminados sin Deuda (caso Gutiérrez, agosto 2026) ───────────────
// canPayCurrentMonth los devuelve en `debts` como PENDING_DEBT, sin id de Deuda y con su
// MonthlyRecord. Antes "Pagar varios" mandaba `d.id` de todo: el mes sin cerrar quedaba afuera y
// se cobraban Septiembre + Octubre sin Agosto.

const AUG_PENDING = { type: 'PENDING_DEBT', id: null, pendingClose: true, monthlyRecordId: 'rec-aug', periodLabel: 'Agosto 2026', periodMonth: 8, periodYear: 2026, total: 560000 }
const SEP_DEBT = { type: 'DEBT', id: 'debt-sep', pendingClose: false, monthlyRecordId: 'rec-sep', periodLabel: 'Septiembre 2026', periodMonth: 9, periodYear: 2026, total: 1100000 }
const OCT = { id: 'rec-oct', periodMonth: 10, periodYear: 2026 }

test('splitBulkSelection: Deudas por id, meses sin cerrar por su MonthlyRecord', () => {
  assert.deepEqual(splitBulkSelection([AUG_PENDING, SEP_DEBT]), { debtIds: ['debt-sep'], pendingRecordIds: ['rec-aug'] })
  assert.deepEqual(splitBulkSelection([SEP_DEBT]), { debtIds: ['debt-sep'], pendingRecordIds: [] })
  assert.deepEqual(splitBulkSelection(), { debtIds: [], pendingRecordIds: [] })
  // Ítems sin la marca (shape viejo de getOpenDebts) cuentan como Deudas.
  assert.deepEqual(splitBulkSelection([{ id: 'x' }]), { debtIds: ['x'], pendingRecordIds: [] })
})

test('bulkItemKey: id de Deuda o, si no tiene, su MonthlyRecord (claves únicas)', () => {
  assert.equal(bulkItemKey(SEP_DEBT), 'debt-sep')
  assert.equal(bulkItemKey(AUG_PENDING), 'record:rec-aug')
})

test('selectBulkDebts: un mes sin cerrar que bloquea entra en el pago múltiple', () => {
  const sel = selectBulkDebts({ openDebts: [AUG_PENDING, SEP_DEBT], debt: SEP_DEBT, isBlocked: true, blocker: { type: 'PENDING_DEBT' } })
  assert.deepEqual(sel.map(bulkItemKey), ['record:rec-aug', 'debt-sep'])
})

test('selectBulkForRecord: Octubre bloqueado → Agosto (sin cerrar) + Septiembre, con Octubre de cola', () => {
  const sel = selectBulkForRecord({ debts: [AUG_PENDING, SEP_DEBT], record: OCT, isBlocked: true })
  assert.equal(sel.mode, 'WITH_CURRENT')
  assert.deepEqual(sel.debts.map(bulkItemKey), ['record:rec-aug', 'debt-sep'])
  assert.deepEqual(splitBulkSelection(sel.debts), { debtIds: ['debt-sep'], pendingRecordIds: ['rec-aug'] })
})

test('selectBulkForRecord: períodos posteriores al mes o de tipos no pagables no entran', () => {
  const later = { ...SEP_DEBT, id: 'debt-nov', periodMonth: 11 }
  const openRecord = { type: 'RECORD', id: 'rec-x', periodMonth: 7, periodYear: 2026 }
  const sel = selectBulkForRecord({ debts: [openRecord, AUG_PENDING, SEP_DEBT, later], record: OCT, isBlocked: true })
  assert.deepEqual(sel.debts.map(bulkItemKey), ['record:rec-aug', 'debt-sep'])
  // Shape sin `type` (viejo) = Deuda.
  const legacy = selectBulkForRecord({ debts: [{ id: 'd', periodMonth: 9, periodYear: 2026 }], record: OCT, isBlocked: true })
  assert.deepEqual(legacy.debts.map((d) => d.id), ['d'])
})

test('selectBulkForRecord: bloqueado sin nada pagable antes, o no bloqueado → NONE', () => {
  assert.deepEqual(selectBulkForRecord({ debts: [], record: OCT, isBlocked: true }), { mode: 'NONE', debts: [] })
  assert.deepEqual(selectBulkForRecord({ debts: [SEP_DEBT], record: OCT, isBlocked: false }), { mode: 'NONE', debts: [] })
  assert.deepEqual(selectBulkForRecord({ debts: [SEP_DEBT], record: null, isBlocked: true }), { mode: 'NONE', debts: [] })
  assert.deepEqual(selectBulkForRecord({ record: OCT, isBlocked: true }), { mode: 'NONE', debts: [] })
})

test('selectBulkForRecord: abrir el propio mes sin cerrar → se cobra solo él, como Deuda', () => {
  const sel = selectBulkForRecord({ debts: [AUG_PENDING, SEP_DEBT], record: { id: 'rec-aug', periodMonth: 8, periodYear: 2026 }, isBlocked: false })
  assert.equal(sel.mode, 'SELF_PENDING')
  assert.deepEqual(sel.debts, [AUG_PENDING])
})

test('effectiveTotal: un ítem sin total (preview todavía cargando) vale 0, con o sin condonar', () => {
  assert.equal(effectiveTotal({}), 0)
  assert.equal(effectiveTotal({ punitory: 500 }, true), 0)
})
