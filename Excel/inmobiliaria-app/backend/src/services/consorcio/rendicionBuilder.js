// Arma la rendición mensual a partir de los movimientos ya clasificados.
// Función pura: misma entrada → mismo informe. La usan la vista previa, el
// Word, el PDF y el cierre del mes, así que todos muestran exactamente lo mismo.
//
//   TOTAL CAJA = Reserva (Total Caja del mes anterior) + Ingresos − Egresos
//
// Cada línea del informe junta los movimientos con el mismo rubro y el mismo
// texto, y guarda de qué movimientos sale (para que la pantalla lo explique).
// Lo que impide generar el informe va en `blockers`; lo que conviene revisar
// pero no impide, en `warnings`.
const { STATUS } = require('./classifier');
const { renderLabel, labelKey, monthName } = require('./labels');
const { formatAmount } = require('./money');

const RESERVE_KEY = '__reserva__';

function lineKey(rubroId, template) {
  return `${rubroId}::${template === RESERVE_KEY ? RESERVE_KEY : labelKey(template)}`;
}

function buildRendicion(input) {
  const {
    title, year, month, rubros, movements, adjustments = [], reserve,
    reserveLabel = 'Reserva Caja', lineOrder = null, bankClosingCents = null,
  } = input;

  const blockers = [];
  const warnings = [];
  const block = (code, message, extra = {}) => blockers.push({ code, message, ...extra });

  const rubrosSorted = [...rubros].sort((a, b) => a.number - b.number);
  const rubrosById = new Map(rubrosSorted.map((r) => [r.id, r]));
  const lines = new Map(); // key → line

  const render = (template) => {
    try {
      return renderLabel(template, year, month);
    } catch (err) {
      block(err.code, err.message);
      return template;
    }
  };

  const getLine = (rubroId, template, order) => {
    const key = lineKey(rubroId, template);
    if (!lines.has(key)) {
      lines.set(key, {
        key, rubroId, template, label: template === RESERVE_KEY ? reserveLabel : render(template),
        computedCents: 0, finalCents: 0, sources: [], manualSources: [], adjustment: null,
        isReserve: template === RESERVE_KEY, firstOrder: order,
      });
    }
    return lines.get(key);
  };

  // 1) Movimientos
  const pending = movements.filter((m) => m.status === STATUS.PENDIENTE);
  if (pending.length) {
    block('PENDING_MOVEMENTS',
      `Faltan clasificar ${pending.length} movimiento(s). Elegí el rubro de cada uno o excluilos del informe.`,
      { movementIds: pending.map((m) => m.id) });
  }
  const excluded = movements.filter((m) => m.status === STATUS.EXCLUIDO);
  const excludedNoNote = excluded.filter((m) => !m.note || !m.note.trim());
  if (excludedNoNote.length) {
    block('EXCLUDED_WITHOUT_NOTE', 'Cada movimiento excluido necesita una nota que explique por qué no va en el informe.',
      { movementIds: excludedNoNote.map((m) => m.id) });
  }

  const unknownRubro = [];
  movements.forEach((m, idx) => {
    if (m.status === STATUS.PENDIENTE || m.status === STATUS.EXCLUIDO) return;
    const rubro = rubrosById.get(m.rubroId);
    if (!rubro) {
      unknownRubro.push(m.id);
      return;
    }
    const line = getLine(rubro.id, m.itemLabel || rubro.defaultItemLabel || rubro.name, idx);
    const signed = rubro.kind === 'INGRESO' ? m.amountCents : -m.amountCents;
    line.computedCents += signed;
    line.sources.push({ movementId: m.id, date: m.date, description: m.description, amountCents: m.amountCents, status: m.status });
  });
  if (unknownRubro.length) {
    block('UNKNOWN_RUBRO', 'Hay movimientos asignados a un rubro que ya no existe. Volvé a clasificarlos.', { movementIds: unknownRubro });
  }

  // 2) Reserva Caja
  const reserveRubro = rubrosSorted.find((r) => r.role === 'RESERVA');
  const reserveCents = reserve && reserve.cents != null ? reserve.cents : null;
  if (reserveCents == null) {
    block('MISSING_RESERVE', (reserve && reserve.reason)
      || 'Falta la Reserva Caja: cerrá la rendición del mes anterior o cargala a mano.');
  } else if (!reserveRubro) {
    block('MISSING_RESERVE_RUBRO', 'Ningún rubro está marcado para mostrar la Reserva Caja.');
  } else {
    const line = getLine(reserveRubro.id, RESERVE_KEY, -1);
    line.computedCents = reserveCents;
  }

  // 3) Líneas manuales y ajustes de monto
  const manual = adjustments.filter((a) => a.kind === 'MANUAL');
  const fixes = adjustments.filter((a) => a.kind === 'AJUSTE');
  manual.forEach((a, i) => {
    if (!rubrosById.has(a.rubroId)) return block('UNKNOWN_RUBRO', `La línea manual "${a.itemLabel}" apunta a un rubro que ya no existe.`, { adjustmentId: a.id });
    if (!a.note || !a.note.trim()) block('ADJUSTMENT_WITHOUT_NOTE', `La línea manual "${a.itemLabel}" necesita una nota.`, { adjustmentId: a.id });
    if (!(a.amountCents > 0)) block('BAD_MANUAL_AMOUNT', `La línea manual "${a.itemLabel}" tiene que tener un importe mayor a cero.`, { adjustmentId: a.id });
    const line = getLine(a.rubroId, a.itemLabel, movements.length + i);
    line.computedCents += a.amountCents;
    line.manualSources.push({ adjustmentId: a.id, amountCents: a.amountCents, note: a.note });
  });
  for (const line of lines.values()) line.finalCents = line.computedCents;

  const fixedKeys = new Set();
  for (const a of fixes) {
    const key = lineKey(a.rubroId, a.itemLabel);
    const line = lines.get(key);
    if (!line) {
      block('ORPHAN_ADJUSTMENT',
        `Hay un ajuste para "${a.itemLabel}" pero esa línea ya no existe en el informe (¿cambió la clasificación?). Borralo o volvé a cargarlo.`,
        { adjustmentId: a.id });
      continue;
    }
    if (fixedKeys.has(key)) {
      block('DUPLICATE_ADJUSTMENT', `La línea "${line.label}" tiene más de un ajuste. Dejá uno solo.`, { adjustmentId: a.id });
      continue;
    }
    fixedKeys.add(key);
    if (!a.note || !a.note.trim()) block('ADJUSTMENT_WITHOUT_NOTE', `El ajuste de "${line.label}" necesita una nota que explique la diferencia.`, { adjustmentId: a.id });
    if (!(a.amountCents >= 0)) block('BAD_ADJUSTMENT_AMOUNT', `El ajuste de "${line.label}" no puede ser negativo.`, { adjustmentId: a.id });
    line.finalCents = a.amountCents;
    line.adjustment = { adjustmentId: a.id, fromCents: line.computedCents, toCents: a.amountCents, differenceCents: a.amountCents - line.computedCents, note: a.note };
  }

  // 4) Secciones ordenadas
  const orderIndex = new Map((lineOrder || []).map((k, i) => [k, i]));
  const sortLines = (a, b) => {
    const ia = orderIndex.has(a.key) ? orderIndex.get(a.key) : Infinity;
    const ib = orderIndex.has(b.key) ? orderIndex.get(b.key) : Infinity;
    if (ia !== ib) return ia - ib;
    return a.firstOrder - b.firstOrder;
  };

  let ingresosCents = 0;
  let egresosCents = 0;
  const sections = rubrosSorted.map((rubro) => {
    const sectionLines = [...lines.values()].filter((l) => l.rubroId === rubro.id).sort(sortLines);
    for (const l of sectionLines) {
      if (l.isReserve) continue;
      if (rubro.kind === 'INGRESO') ingresosCents += l.finalCents;
      else egresosCents += l.finalCents;
      if (l.finalCents < 0) {
        warnings.push({ code: 'NEGATIVE_LINE', message: `La línea "${l.label}" da negativa (${formatAmount(l.finalCents)}). Revisá si hay un movimiento en el rubro equivocado.`, key: l.key });
      }
    }
    return {
      rubro: { id: rubro.id, number: rubro.number, name: rubro.name, kind: rubro.kind, role: rubro.role || null },
      lines: sectionLines.map(({ firstOrder, ...l }) => l),
    };
  });

  const totalCajaCents = (reserveCents || 0) + ingresosCents - egresosCents;
  if (bankClosingCents != null && bankClosingCents !== totalCajaCents) {
    warnings.push({
      code: 'BANK_DIFFERENCE',
      message: `El Total Caja (${formatAmount(totalCajaCents)}) no coincide con el saldo final del banco (${formatAmount(bankClosingCents)}): diferencia ${formatAmount(bankClosingCents - totalCajaCents)}. Es normal si hay movimientos excluidos o ajustes; revisá que se pueda explicar.`,
    });
  }

  const lastNumber = rubrosSorted.length ? rubrosSorted[rubrosSorted.length - 1].number : 0;
  return {
    title,
    subtitle: `Rendición de cuentas mes de ${monthName(month)} de ${year}`,
    year,
    month,
    sections,
    total: { number: lastNumber + 1, label: 'TOTAL CAJA' },
    totals: { reserveCents, reserveSource: reserve ? reserve.source || null : null, ingresosCents, egresosCents, totalCajaCents },
    control: {
      bankClosingCents,
      differenceCents: bankClosingCents == null ? null : bankClosingCents - totalCajaCents,
      excludedCents: excluded.reduce((s, m) => s + m.amountCents, 0),
    },
    excluded: excluded.map((m) => ({ movementId: m.id, date: m.date, description: m.description, amountCents: m.amountCents, note: m.note || null })),
    blockers,
    warnings,
    canGenerate: blockers.length === 0,
  };
}

module.exports = { buildRendicion, lineKey, RESERVE_KEY };
