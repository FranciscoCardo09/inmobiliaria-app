// Etiqueta de un MonthlyService para mostrar. Si tiene cuotas, agrega "(cuota k/N)".
export function formatServiceLabel(svc) {
  if (!svc) return 'Servicio'
  const base =
    svc.conceptType?.label ||
    svc.conceptType?.name ||
    svc.description ||
    'Servicio'
  const n = svc.cuotaNumber
  const total = svc.cuotaTotal
  if (n != null && total != null && total > 0) {
    return `${base} (cuota ${n}/${total})`
  }
  return base
}

// Categorías cuyo importe RESTA del neto de servicios del mes. La fila de `monthly_services`
// guarda el monto siempre en POSITIVO; el signo se aplica al leer, y el backend usa la misma
// regla para derivar `servicesTotal` (monthlyRecordService `_recalculateCore`).
export const DISCOUNT_CATEGORIES = ['DESCUENTO', 'BONIFICACION']

export function isDiscountService(svc) {
  return DISCOUNT_CATEGORIES.includes(svc?.conceptType?.category)
}

/**
 * Importe CON SIGNO de un servicio, para mostrarlo en un desglose.
 *
 * Los desgloses pintaban cada servicio con su `amount` crudo (en positivo), así que un
 * DESCUENTO se veía como un cargo y las líneas visibles NO sumaban el "Subtotal servicios"
 * de abajo (que sí viene neteado). Con un descuento cargado por error era imposible darse
 * cuenta mirando la pantalla — justo el caso que hay que poder verificar (Ciuro, mayo 2026).
 */
export function serviceSignedAmount(svc) {
  const amount = svc?.amount || 0
  return isDiscountService(svc) ? -Math.abs(amount) : amount
}
