/**
 * Etiqueta de un MonthlyService para mostrar en vistas/reportes.
 * Si el servicio tiene cuotas (cuotaNumber + cuotaTotal), agrega "(cuota k/N)".
 *
 * @param {{ cuotaNumber?: number|null, cuotaTotal?: number|null,
 *           conceptType?: { label?: string, name?: string }, description?: string }} svc
 * @returns {string}
 */
function formatServiceLabel(svc) {
  if (!svc) return 'Servicio';
  const base =
    svc.conceptType?.label ||
    svc.description ||
    svc.conceptType?.name ||
    'Servicio';
  const n = svc.cuotaNumber;
  const total = svc.cuotaTotal;
  if (n != null && total != null && total > 0) {
    return `${base} (cuota ${n}/${total})`;
  }
  return base;
}

module.exports = { formatServiceLabel };
