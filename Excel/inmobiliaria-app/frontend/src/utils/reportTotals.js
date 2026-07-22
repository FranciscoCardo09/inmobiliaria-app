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
    // Hallazgo #4: la caja real del mes = lo cobrado del propio período +
    // lo cobrado de deudas/meses anteriores (cobradoOtrosPeriodos), no solo
    // amountPaid del período (AUDITORIA_CONTROL_LIQUIDACION_2026-07.md).
    grandTotal: dataArray.reduce((s, d) => s + (d.amountPaid || 0) + (d.cobradoOtrosPeriodos?.total || 0), 0),
    // "Total Pendiente" incluye el mes actual impago Y las deudas viejas abiertas
    // (antes solo sumaba pendingAmount, perdiendo meses anteriores sin pagar).
    grandPending: dataArray.reduce((s, d) => s + (d.pendingAmount || 0) + (d.totalDeuda || 0), 0),
    grandHonorarios: dataArray.reduce((s, d) => s + (d.honorariosCobrado || 0), 0),
    // Allocation breakdown totals — incluyen lo cobrado de otros períodos por concepto
    grandServiciosCobrado: dataArray.reduce((s, d) => s + (d.paidServicios || 0) + (d.cobradoOtrosPeriodos?.servicios || 0), 0),
    grandPunitoriosCobrado: dataArray.reduce((s, d) => s + (d.paidPunitorios || 0) + (d.cobradoOtrosPeriodos?.punitorios || 0), 0),
    // Unificado con grandSubtotalAlquileres/honorarios (BONIFICACION resta, DESCUENTO no):
    // usa paidAlquilerHonorarios en vez de paidAlquiler crudo (mismo criterio que el backend).
    grandAlquilerCobrado: dataArray.reduce((s, d) => s + (d.paidAlquilerHonorarios ?? d.paidAlquiler ?? 0) + (d.cobradoOtrosPeriodos?.alquiler || 0), 0),
    grandSaldoAFavor: dataArray.reduce((s, d) => s + (d.saldoAFavor || 0), 0),
    // Counts
    paidCount: paidRows.length,
    saldoCount: saldoRows.length,
    partialCount: partialRows.length,
    unpaidCount: unpaidRows.length,
  }
}
