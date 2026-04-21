/**
 * Aggregates liquidacion rows into grand totals.
 * Mirrors the backend computeGrandTotals in reportDataService.js.
 * Uses paymentStatus string classification from backend.
 */
export const computeGrandTotals = (dataArray) => {
  const paidRows = dataArray.filter((d) => d.paymentStatus === 'PAGADO')
  const saldoRows = dataArray.filter((d) => d.paymentStatus === 'SALDO A FAVOR')
  const partialRows = dataArray.filter((d) => d.paymentStatus === 'PAGO PARCIAL')
  const unpaidRows = dataArray.filter((d) => d.paymentStatus === 'NO COBRADO')
  return {
    // Grand totals
    grandSubtotalAlquileres: dataArray.reduce((s, d) => s + (d.subtotalAlquileresCobrado || 0), 0),
    grandSubtotalAlquileresPartial: partialRows.reduce((s, d) => s + (d.pendingAmount || 0), 0),
    grandSubtotalAlquileresUnpaid: unpaidRows.reduce((s, d) => s + (d.pendingAmount || 0), 0),
    grandTotal: dataArray.reduce((s, d) => s + (d.amountPaid || 0), 0),
    grandPending: dataArray.reduce((s, d) => s + (d.pendingAmount || 0), 0),
    grandHonorarios: dataArray.reduce((s, d) => s + (d.honorariosCobrado || 0), 0),
    // Allocation breakdown totals
    grandServiciosCobrado: dataArray.reduce((s, d) => s + (d.paidServicios || 0), 0),
    grandPunitoriosCobrado: dataArray.reduce((s, d) => s + (d.paidPunitorios || 0), 0),
    grandAlquilerCobrado: dataArray.reduce((s, d) => s + (d.paidAlquiler || 0), 0),
    grandSaldoAFavor: dataArray.reduce((s, d) => s + (d.saldoAFavor || 0), 0),
    // Counts
    paidCount: paidRows.length,
    saldoCount: saldoRows.length,
    partialCount: partialRows.length,
    unpaidCount: unpaidRows.length,
  }
}
