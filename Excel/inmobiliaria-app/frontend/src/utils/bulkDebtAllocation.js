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

// Deudas que se ofrecen en "Pagar varias" desde el modal de UNA deuda. Tiene que ser un
// prefijo contiguo de los períodos impagos (lo valida loadAndValidateBulkDebts):
//   - bloqueada: de la más vieja hasta ESTA inclusive, y solo si el que bloquea es una
//     Deuda (un mes PARCIAL sin deuda no entra en el pago múltiple → rechazo del backend);
//   - no bloqueada (esta es la más vieja): todas las deudas abiertas.
// Devuelve [] cuando no tiene sentido ofrecerlo (menos de 2 meses o esta deuda no está).
export const selectBulkDebts = ({ openDebts = [], debt, isBlocked, blocker }) => {
  if (!debt) return []
  let selected
  if (isBlocked) {
    if (blocker?.type !== 'DEBT') return []
    selected = openDebts.filter((d) => periodKey(d) <= periodKey(debt))
  } else {
    selected = openDebts
  }
  if (selected.length < 2 || !selected.some((d) => d.id === debt.id)) return []
  return selected
}
