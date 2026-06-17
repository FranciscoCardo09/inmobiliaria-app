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
