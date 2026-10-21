/**
 * Lógica pura de "Pagar varias" (BulkDebtPaymentModal / DebtPaymentModal): qué deudas
 * entran en el pago múltiple, cómo se reparte el monto entre los meses (waterfall), qué
 * conceptos cubre el mes que queda parcial y el resumen en palabras.
 *
 * Separada de los componentes para poder testearla (bulkDebtAllocation.test.js). Los
 * montos por mes vienen del backend (POST /debts/pay-bulk/preview); acá solo se reparte.
 */

const periodKey = (p) => p.periodYear * 12 + p.periodMonth

// Total efectivo a pagar de un mes: si se condona, el punitorio no cuenta (igual
// criterio que el backend — ver debtService.payDebtsBulk, que topea cada deuda sin
// punitorio cuando forgivePunitorios=true para no dejarla con sobrepago/saldo a favor).
export const effectiveTotal = (item, forgivePunitorios = false) => {
  const raw = item.totalToPay || 0
  return forgivePunitorios ? Math.max(raw - (item.punitory || 0), 0) : raw
}

// Qué conceptos cubre lo aplicado a un mes parcial, en el MISMO orden que imputa el
// backend: deuda → payDebt (servicios+IVA juntos, alquiler, punitorios); mes actual →
// registerPaymentCore (servicios, alquiler, IVA, punitorios). Solo se calcula cuando
// las líneas del desglose suman exacto el total del mes: con saldo a favor, descuentos
// o pagos previos el backend reparte distinto y el detalle mentiría → null.
export const conceptCoverage = (item, applied, forgivePunitorios = false) => {
  const punitory = forgivePunitorios ? 0 : (item.punitory || 0)
  const lines = item.type === 'RECORD'
    ? [['Servicios', item.remainingServices], ['Alquiler', item.remainingRent], ['IVA', item.iva], ['Punitorios', punitory]]
    : [['Servicios', item.remainingServices], ['IVA', item.iva], ['Alquiler', item.remainingRent], ['Punitorios', punitory]]
  if (lines.some(([, v]) => (v || 0) < 0)) return null
  const sum = lines.reduce((s, [, v]) => s + (v || 0), 0)
  if (Math.abs(sum - effectiveTotal(item, forgivePunitorios)) > 1) return null
  let left = applied
  return lines
    .filter(([, v]) => (v || 0) > 0.5)
    .map(([label, owed]) => {
      const paid = Math.min(Math.max(left, 0), owed)
      left -= paid
      return { label, owed, paid, missing: owed - paid }
    })
}

// Waterfall: reparte el monto entre los meses en orden (más viejo → más nuevo). Cada mes
// se topea a su total; lo que sobra después del último es `overpay` (saldo a favor).
export const allocateBulkPayment = (items, amount, forgivePunitorios = false) => {
  let remaining = amount > 0 ? amount : 0
  const rows = items.map((it) => {
    const cap = effectiveTotal(it, forgivePunitorios)
    const applied = Math.max(Math.min(remaining, cap), 0)
    remaining -= applied
    const pending = cap - applied
    let status
    if (applied <= 0.5) status = 'NONE'
    else if (pending <= 1) status = 'FULL'
    else status = 'PARTIAL'
    const coverage = status === 'PARTIAL' ? conceptCoverage(it, applied, forgivePunitorios) : null
    return { ...it, totalToPay: cap, applied, pending, status, coverage }
  })
  return { rows, overpay: remaining }
}

// Resumen en palabras: meses que cancela, el (único) mes parcial, los que no cubre y
// cuánto falta para cancelar todo.
export const summarizeAllocation = ({ rows }) => ({
  full: rows.filter((r) => r.status === 'FULL'),
  partial: rows.find((r) => r.status === 'PARTIAL') || null,
  none: rows.filter((r) => r.status === 'NONE'),
  missingTotal: rows.reduce((s, r) => s + Math.max(r.pending, 0), 0),
})

// Tipos de período que entran en el pago múltiple: Deudas y meses terminados que quedaron sin
// Deuda debiendo ('PENDING_DEBT', backend services/unclosedMonths.js — se pasan a Deuda al
// cobrar). Un mes PARCIAL todavía abierto ('RECORD') no entra → rechazo del backend.
const BULK_TYPES = new Set(['DEBT', 'PENDING_DEBT'])

// Lo que viaja al backend: las Deudas por id y los meses sin cerrar por su MonthlyRecord (no
// tienen id de Deuda todavía). Antes se mandaba `d.id` de todo y un mes sin cerrar (id null)
// quedaba afuera: el caso Gutiérrez (agosto 2026) sumaba Septiembre + Octubre sin Agosto.
export const splitBulkSelection = (debts = []) => ({
  debtIds: debts.filter((d) => !d.pendingClose).map((d) => d.id),
  pendingRecordIds: debts.filter((d) => d.pendingClose).map((d) => d.monthlyRecordId),
})

// Clave estable de un ítem (un mes sin cerrar no tiene id de Deuda).
export const bulkItemKey = (it) => it.id || `record:${it.monthlyRecordId}`

// Deudas que se ofrecen en "Pagar varias" desde el modal de UNA deuda. Tiene que ser un
// prefijo contiguo de los períodos impagos (lo valida loadAndValidateBulkDebts):
//   - bloqueada: de la más vieja hasta ESTA inclusive, y solo si el que bloquea es una
//     Deuda o un mes sin cerrar (un mes PARCIAL abierto no entra en el pago múltiple);
//   - no bloqueada (esta es la más vieja): todas las deudas abiertas.
// Devuelve [] cuando no tiene sentido ofrecerlo (menos de 2 meses o esta deuda no está).
export const selectBulkDebts = ({ openDebts = [], debt, isBlocked, blocker }) => {
  if (!debt) return []
  let selected
  if (isBlocked) {
    if (!BULK_TYPES.has(blocker?.type)) return []
    selected = openDebts.filter((d) => periodKey(d) <= periodKey(debt))
  } else {
    selected = openDebts
  }
  if (selected.length < 2 || !selected.some((d) => d.id === debt.id)) return []
  return selected
}

// "Pagar varias" desde el cobro de un MES (PaymentRegistrationModal):
//   - si este mes es uno terminado sin Deuda que debe → se cobra solo él, como Deuda (por el
//     registro común el backend lo pasa a Deuda y lo rechaza: "ya pasó a deuda");
//   - si está bloqueado → todos los períodos anteriores pagables + este mes como cola;
//   - si no → nada (se cobra con el formulario común).
export const selectBulkForRecord = ({ debts = [], record, isBlocked }) => {
  if (!record) return { mode: 'NONE', debts: [] }
  const self = debts.find((d) => d.pendingClose && d.monthlyRecordId === record.id)
  if (self) return { mode: 'SELF_PENDING', debts: [self] }
  if (!isBlocked) return { mode: 'NONE', debts: [] }
  const key = record.periodYear * 12 + record.periodMonth
  const before = debts.filter((d) => BULK_TYPES.has(d.type || 'DEBT') && periodKey(d) < key)
  return before.length > 0 ? { mode: 'WITH_CURRENT', debts: before } : { mode: 'NONE', debts: [] }
}
