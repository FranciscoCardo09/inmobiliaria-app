/**
 * Aggregates liquidacion rows into grand totals, counting only fully-paid rentals.
 * Mirrors the backend computeGrandTotals in reportDataService.js.
 * Paid = isRentPaid === true (backed by MonthlyRecord.isCancelled).
 */
export const computeGrandTotals = (dataArray) => {
  const paidRows = dataArray.filter((d) => d.isRentPaid)
  const unpaidRows = dataArray.filter((d) => !d.isRentPaid)
  return {
    grandSubtotalAlquileres: paidRows.reduce((s, d) => s + (d.subtotalAlquileres || 0), 0),
    grandSubtotalAlquileresUnpaid: unpaidRows.reduce((s, d) => s + (d.subtotalAlquileres || 0), 0),
    grandTotal: paidRows.reduce((s, d) => s + (d.total || 0), 0),
    grandHonorarios: paidRows.reduce((s, d) => s + (d.honorariosCobrado || 0), 0),
    paidCount: paidRows.length,
    unpaidCount: unpaidRows.length,
  }
}
