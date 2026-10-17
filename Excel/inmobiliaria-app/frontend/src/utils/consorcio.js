// Lógica pura de la pantalla de Consorcios (testeada en consorcio.test.js).
// Los montos viajan en centavos enteros, igual que en el backend.

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export const monthName = (m) => MONTHS[m - 1]

// 428213491 → "$ 4.282.134,91"
export function formatMoney(cents) {
  if (cents === null || cents === undefined) return '—'
  const abs = Math.abs(cents)
  const pesos = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cents < 0 ? '-' : ''}$ ${pesos},${String(abs % 100).padStart(2, '0')}`
}

// Lo que escribe el usuario → centavos. Acepta "4.282.134,91", "4282134,91",
// "$ 1.500", "1500.5" (punto decimal sólo si hay 1 o 2 decimales y no hay coma).
// Devuelve null si no se entiende.
export function parseMoneyInput(text) {
  let s = String(text ?? '').replace(/\$/g, '').replace(/\s/g, '')
  if (!s) return null
  const negative = s.startsWith('-')
  if (negative) s = s.slice(1)
  let intPart
  let decPart = ''
  if (s.includes(',')) {
    const parts = s.split(',')
    if (parts.length !== 2) return null
    intPart = parts[0]
    decPart = parts[1]
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(intPart)) return null
    intPart = intPart.replace(/\./g, '')
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const parts = s.split('.')
    intPart = parts[0]
    decPart = parts[1]
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    intPart = s.replace(/\./g, '')
  } else {
    return null
  }
  if (!/^\d{0,2}$/.test(decPart)) return null
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return negative ? -cents : cents
}

// Cómo se muestra cada estado de un movimiento.
export const STATUS_INFO = {
  PENDIENTE: { label: 'Pendiente', badge: 'badge-error', help: 'Falta decidir a qué rubro va. Sin esto no se puede generar el informe.' },
  AUTO: { label: 'Automático', badge: 'badge-ghost', help: 'El sistema lo sabe por el código del banco (cobranzas, comisiones, impuestos).' },
  REGLA: { label: 'Por regla', badge: 'badge-info', help: 'Lo clasificó una regla guardada (por CUIT, nombre o código).' },
  MANUAL: { label: 'Manual', badge: 'badge-success', help: 'Lo elegiste vos para este mes.' },
  EXCLUIDO: { label: 'Excluido', badge: 'badge-neutral', help: 'No entra en el informe (con nota).' },
}

export function countByStatus(movements) {
  const counts = { PENDIENTE: 0, AUTO: 0, REGLA: 0, MANUAL: 0, EXCLUIDO: 0 }
  for (const m of movements) counts[m.status] = (counts[m.status] || 0) + 1
  return counts
}

export const FILTERS = [
  { value: 'PENDIENTES', label: 'Pendientes' },
  { value: 'TRANSFERENCIAS', label: 'Transferencias' },
  { value: 'TODOS', label: 'Todos' },
  { value: 'EXCLUIDOS', label: 'Excluidos' },
]

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function filterMovements(movements, filter, search = '') {
  const q = norm(search).trim()
  return movements.filter((m) => {
    if (filter === 'PENDIENTES' && m.status !== 'PENDIENTE') return false
    if (filter === 'TRANSFERENCIAS' && !m.cuit) return false
    if (filter === 'EXCLUIDOS' && m.status !== 'EXCLUIDO') return false
    if (!q) return true
    return norm(`${m.description} ${m.cuit || ''} ${m.conceptCode} ${formatMoney(m.amountCents)}`).includes(q)
  })
}

// "06/07/2026"
export const formatDate = (iso) => iso.split('-').reverse().join('/')

// Quién es la contraparte, para mostrar en la tabla.
export function movementWho(m) {
  if (m.counterparty) return m.cuit ? `${m.counterparty} (CUIT ${m.cuit})` : m.counterparty
  return m.description
}

// Espejo de labels.js del backend para la vista previa al escribir un texto.
export const LABEL_VARIABLES = [
  { name: 'mesAnterior', help: 'Mes anterior, ej. "Junio - 26"' },
  { name: 'mes', help: 'Mes de la rendición, ej. "Julio - 26"' },
  { name: 'periodoAnterior', help: 'Mes anterior, ej. "06/2026"' },
  { name: 'periodo', help: 'Mes de la rendición, ej. "07/2026"' },
]

export function renderLabelPreview(template, year, month) {
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const vals = {
    mes: `${monthName(month)} - ${String(year).slice(-2)}`,
    mesAnterior: `${monthName(prev.m)} - ${String(prev.y).slice(-2)}`,
    periodo: `${String(month).padStart(2, '0')}/${year}`,
    periodoAnterior: `${String(prev.m).padStart(2, '0')}/${prev.y}`,
  }
  const unknown = []
  const text = String(template ?? '').replace(/\{(\w+)\}/g, (all, name) => {
    if (name in vals) return vals[name]
    unknown.push(name)
    return all
  })
  return { text, unknown }
}

// Textos ya usados en un rubro (para autocompletar al clasificar).
export function itemLabelOptions(report, rubroId) {
  const section = report?.sections?.find((s) => s.rubro.id === rubroId)
  if (!section) return []
  return [...new Set(section.lines.filter((l) => !l.isReserve).map((l) => l.template))]
}

// Mueve una línea arriba/abajo dentro de su rubro y devuelve el orden completo
// (todas las claves del informe) para guardar.
export function moveLine(report, key, direction) {
  const allKeys = report.sections.flatMap((s) => s.lines.map((l) => l.key))
  const section = report.sections.find((s) => s.lines.some((l) => l.key === key))
  if (!section) return allKeys
  const keys = section.lines.map((l) => l.key)
  const i = keys.indexOf(key)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= keys.length) return allKeys
  const tmp = keys[i]
  keys[i] = keys[j]
  keys[j] = tmp
  const others = allKeys.filter((k) => !keys.includes(k))
  return [...others, ...keys]
}

// Explica por qué no se puede generar todavía, en una lista corta.
export function blockerSummary(report) {
  if (!report || report.canGenerate) return []
  return report.blockers.map((b) => b.message)
}

// Arma los items para "asignar varios juntos".
export function bulkItems(movementIds, { action, rubroId, itemLabel, note, remember }) {
  return movementIds.map((movementId) => ({
    movementId,
    action,
    ...(action === 'ASIGNAR' ? { rubroId, itemLabel, remember: remember || null } : {}),
    ...(note ? { note } : {}),
  }))
}

// Archivo → base64 sin el prefijo data: (para subir el PDF en JSON).
export function stripDataUrl(dataUrl) {
  return String(dataUrl).replace(/^data:[^;]+;base64,/, '')
}
