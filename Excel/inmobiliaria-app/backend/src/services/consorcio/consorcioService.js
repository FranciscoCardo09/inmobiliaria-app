// Servicio del módulo Consorcios: configuración (consorcio, rubros, reglas) y
// rendiciones mensuales (subir extracto, clasificar, ajustar, cerrar, generar).
// Todo está acotado al grupo (multi-tenant): nunca se busca por id sin groupId.
const crypto = require('crypto');
const prisma = require('../../lib/prisma');
const { ConsorcioError } = require('./errors');
const { extractPages } = require('./pdfText');
const { parseStatement } = require('./statementParser');
const { STATUS, classifyMovement, describeRule, ruleFromMovement, planRemember } = require('./classifier');
const { buildRendicion } = require('./rendicionBuilder');
const { previousMonth, monthName } = require('./labels');
const { DEFAULT_RUBROS } = require('./defaults');
const { generateRendicionDocx } = require('./rendicionDocx');
const { generateRendicionPdf } = require('./rendicionPdf');
const { fileBaseName } = require('./reportRows');

const MAX_PDF_BYTES = 8 * 1024 * 1024;

const notFound = (what) => new ConsorcioError('NOT_FOUND', `${what} no encontrado.`, 404);
const conflict = (code, message, details = null) => new ConsorcioError(code, message, 409, details);
const bad = (code, message, details = null) => new ConsorcioError(code, message, 400, details);

const monthLabel = (year, month) => `${monthName(month)} ${year}`;

// ───────────────────────── Consorcios ─────────────────────────

async function findConsorcio(groupId, consorcioId) {
  const c = await prisma.consorcio.findFirst({ where: { id: consorcioId, groupId } });
  if (!c) throw notFound('Consorcio');
  return c;
}

async function listConsorcios(groupId) {
  return prisma.consorcio.findMany({ where: { groupId }, orderBy: { name: 'asc' } });
}

async function getConsorcio(groupId, consorcioId) {
  const consorcio = await findConsorcio(groupId, consorcioId);
  const rubros = await prisma.consorcioRubro.findMany({ where: { consorcioId }, orderBy: { number: 'asc' } });
  const reglas = await prisma.consorcioRegla.findMany({ where: { consorcioId }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  return {
    ...consorcio,
    rubros,
    reglas: reglas.map((r) => ({ ...r, description: describeRule(r, rubros) })),
  };
}

async function assertCbuFree(groupId, cbu, exceptId = null) {
  const other = await prisma.consorcio.findFirst({ where: { groupId, cbu } });
  if (other && other.id !== exceptId) {
    throw conflict('CBU_IN_USE', `El CBU ${cbu} ya está asignado al consorcio "${other.name}".`);
  }
}

async function createConsorcio(groupId, data) {
  await assertCbuFree(groupId, data.cbu);
  return prisma.$transaction(async (tx) => {
    const consorcio = await tx.consorcio.create({
      data: {
        groupId,
        name: data.name,
        bankAccountName: data.bankAccountName || null,
        cbu: data.cbu,
        initialReserveCents: data.initialReserveCents ?? null,
        reserveLabel: data.reserveLabel || 'Reserva Caja',
      },
    });
    await tx.consorcioRubro.createMany({ data: DEFAULT_RUBROS.map((r) => ({ ...r, consorcioId: consorcio.id })) });
    return consorcio;
  });
}

async function updateConsorcio(groupId, consorcioId, data) {
  await findConsorcio(groupId, consorcioId);
  if (data.cbu) await assertCbuFree(groupId, data.cbu, consorcioId);
  return prisma.consorcio.update({ where: { id: consorcioId }, data });
}

async function deleteConsorcio(groupId, consorcioId) {
  await findConsorcio(groupId, consorcioId);
  const count = await prisma.rendicion.count({ where: { consorcioId } });
  if (count) {
    throw conflict('HAS_RENDICIONES', `El consorcio tiene ${count} rendición(es). Borralas primero o desactivá el consorcio.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.consorcioRegla.deleteMany({ where: { consorcioId } });
    await tx.consorcioRubro.deleteMany({ where: { consorcioId } });
    await tx.consorcio.delete({ where: { id: consorcioId } });
  });
}

// ───────────────────────── Rubros ─────────────────────────

async function findRubro(consorcioId, rubroId) {
  const r = await prisma.consorcioRubro.findFirst({ where: { id: rubroId, consorcioId } });
  if (!r) throw bad('UNKNOWN_RUBRO', 'El rubro elegido no pertenece a este consorcio.');
  return r;
}

async function assertRubroUnique(consorcioId, data, exceptId = null) {
  const rubros = await prisma.consorcioRubro.findMany({ where: { consorcioId } });
  const others = rubros.filter((r) => r.id !== exceptId);
  if (data.number != null && others.some((r) => r.number === data.number)) {
    throw conflict('RUBRO_NUMBER_IN_USE', `Ya existe un rubro con el número ${data.number}.`);
  }
  if (data.role && others.some((r) => r.role === data.role)) {
    throw conflict('ROLE_IN_USE', `Ya hay un rubro marcado como ${data.role}. Sólo puede haber uno.`);
  }
}

async function createRubro(groupId, consorcioId, data) {
  await findConsorcio(groupId, consorcioId);
  await assertRubroUnique(consorcioId, data);
  return prisma.consorcioRubro.create({ data: { ...data, consorcioId } });
}

async function updateRubro(groupId, consorcioId, rubroId, data) {
  await findConsorcio(groupId, consorcioId);
  await findRubro(consorcioId, rubroId);
  await assertRubroUnique(consorcioId, data, rubroId);
  return prisma.consorcioRubro.update({ where: { id: rubroId }, data });
}

async function deleteRubro(groupId, consorcioId, rubroId) {
  await findConsorcio(groupId, consorcioId);
  await findRubro(consorcioId, rubroId);
  const rendIds = (await prisma.rendicion.findMany({ where: { consorcioId }, select: { id: true } })).map((r) => r.id);
  const uses = await prisma.consorcioRegla.count({ where: { consorcioId, rubroId } })
    + await prisma.rendicionMovimiento.count({ where: { rendicionId: { in: rendIds }, rubroId } })
    + await prisma.rendicionAjuste.count({ where: { rendicionId: { in: rendIds }, rubroId } });
  if (uses) {
    throw conflict('RUBRO_IN_USE', 'El rubro se usa en reglas, movimientos o ajustes. Cambiales el rubro antes de borrarlo.');
  }
  await prisma.consorcioRubro.delete({ where: { id: rubroId } });
}

// ───────────────────────── Reglas ─────────────────────────

async function createRegla(groupId, consorcioId, data) {
  await findConsorcio(groupId, consorcioId);
  await findRubro(consorcioId, data.rubroId);
  return prisma.consorcioRegla.create({ data: { alwaysAsk: false, priority: 0, isActive: true, ...data, consorcioId } });
}

async function findRegla(consorcioId, reglaId) {
  const r = await prisma.consorcioRegla.findFirst({ where: { id: reglaId, consorcioId } });
  if (!r) throw notFound('Regla');
  return r;
}

async function updateRegla(groupId, consorcioId, reglaId, data) {
  await findConsorcio(groupId, consorcioId);
  const current = await findRegla(consorcioId, reglaId);
  if (data.rubroId) await findRubro(consorcioId, data.rubroId);
  const merged = { ...current, ...data };
  if (!merged.matchCuit && !merged.matchText && !merged.matchConcept) {
    throw bad('RULE_WITHOUT_CONDITION', 'La regla necesita al menos una condición: CUIT, texto o código de concepto.');
  }
  return prisma.consorcioRegla.update({ where: { id: reglaId }, data });
}

async function deleteRegla(groupId, consorcioId, reglaId) {
  await findConsorcio(groupId, consorcioId);
  await findRegla(consorcioId, reglaId);
  await prisma.consorcioRegla.delete({ where: { id: reglaId } });
}

// ───────────────────────── Rendiciones ─────────────────────────

async function findRendicion(groupId, rendicionId) {
  const r = await prisma.rendicion.findFirst({ where: { id: rendicionId, groupId } });
  if (!r) throw notFound('Rendición');
  return r;
}

function assertEditable(r) {
  if (r.status === 'CERRADA') {
    throw conflict('RENDICION_CERRADA', `La rendición de ${monthLabel(r.year, r.month)} está cerrada. Reabrila para modificarla.`);
  }
}

async function listRendiciones(groupId, consorcioId) {
  await findConsorcio(groupId, consorcioId);
  const rows = await prisma.rendicion.findMany({
    where: { consorcioId, groupId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    select: {
      id: true, year: true, month: true, status: true, fileName: true, openingBalanceCents: true,
      closingBalanceCents: true, totalCajaCents: true, closedAt: true, createdAt: true,
    },
  });
  return rows;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function statementMonth(period) {
  const [y, m, d] = period.from.split('-').map(Number);
  const [y2, m2, d2] = period.to.split('-').map(Number);
  if (d !== 1 || y2 !== y || m2 !== m || d2 !== lastDayOfMonth(y, m)) {
    throw bad('PERIOD_NOT_MONTH',
      `El extracto va del ${period.from} al ${period.to}. La rendición es mensual: subí el extracto del mes completo (del 1 al último día).`);
  }
  return { year: y, month: m };
}

function decodePdf(fileBase64) {
  const clean = String(fileBase64).replace(/^data:application\/pdf;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length > MAX_PDF_BYTES) throw bad('FILE_TOO_LARGE', 'El PDF pesa más de 8 MB. Un extracto mensual no debería pesar tanto: revisá que sea el archivo correcto.');
  return buffer;
}

// Huella del CONTENIDO del extracto (no de los bytes): el mismo extracto
// descargado dos veces del home banking trae otra fecha de emisión y otro
// archivo, pero los mismos movimientos.
function contentHash(statement) {
  const canonical = [statement.cbu, statement.period.from, statement.period.to, statement.openingBalanceCents,
    statement.closingBalanceCents, ...statement.movements.map((m) => m.fingerprint)].join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function movementRow(rendicionId, mv) {
  return {
    rendicionId,
    index: mv.index,
    page: mv.page,
    date: mv.date,
    voucher: mv.voucher,
    conceptCode: mv.conceptCode,
    description: mv.description,
    cuit: mv.cuit,
    counterparty: mv.counterparty,
    ownAccount: mv.ownAccount,
    amountCents: mv.amountCents,
    fingerprint: mv.fingerprint,
  };
}

function autoFields(mv, reglas, rubros) {
  const c = classifyMovement(mv, reglas, rubros);
  return { status: c.status, rubroId: c.rubroId, itemLabel: c.itemLabel, ruleId: c.ruleId, reason: c.reason, suggestions: c.suggestions, note: null };
}

async function uploadStatement(groupId, consorcioId, { fileBase64, fileName = null, replace = false }) {
  const consorcio = await findConsorcio(groupId, consorcioId);
  const buffer = decodePdf(fileBase64);
  const statement = parseStatement(await extractPages(buffer));
  const fileHash = contentHash(statement);
  if (statement.cbu !== consorcio.cbu) {
    throw bad('CBU_MISMATCH',
      `Este extracto es de la cuenta con CBU ${statement.cbu}${statement.accountName ? ` (${statement.accountName})` : ''}, pero el consorcio "${consorcio.name}" tiene el CBU ${consorcio.cbu}. ¿Te equivocaste de consorcio?`);
  }
  const { year, month } = statementMonth(statement.period);

  const sameFile = await prisma.rendicion.findFirst({ where: { consorcioId, fileHash } });
  if (sameFile) {
    throw conflict('DUPLICATE_FILE', `Este extracto (con los mismos movimientos) ya está cargado en la rendición de ${monthLabel(sameFile.year, sameFile.month)}.`, { rendicionId: sameFile.id });
  }

  const existing = await prisma.rendicion.findFirst({ where: { consorcioId, year, month } });
  if (existing) {
    assertEditable(existing);
    if (!replace) {
      throw conflict('REQUIRES_REPLACE',
        `Ya hay una rendición de ${monthLabel(year, month)} en borrador. Confirmá para reemplazar el extracto: se conservan las clasificaciones manuales y los ajustes.`,
        { rendicionId: existing.id });
    }
  }

  const rubros = await prisma.consorcioRubro.findMany({ where: { consorcioId } });
  const reglas = await prisma.consorcioRegla.findMany({ where: { consorcioId } });

  return prisma.$transaction(async (tx) => {
    let rendicion;
    let kept = new Map();
    const header = {
      fileName, fileHash, periodFrom: statement.period.from, periodTo: statement.period.to,
      openingBalanceCents: statement.openingBalanceCents, closingBalanceCents: statement.closingBalanceCents,
    };
    if (existing) {
      const old = await tx.rendicionMovimiento.findMany({ where: { rendicionId: existing.id } });
      kept = new Map(old.filter((m) => m.status === STATUS.MANUAL || m.status === STATUS.EXCLUIDO).map((m) => [m.fingerprint, m]));
      await tx.rendicionMovimiento.deleteMany({ where: { rendicionId: existing.id } });
      rendicion = await tx.rendicion.update({ where: { id: existing.id }, data: header });
    } else {
      const prev = await tx.rendicion.findFirst({
        where: { consorcioId, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      rendicion = await tx.rendicion.create({
        data: { groupId, consorcioId, year, month, status: 'BORRADOR', reserveSource: 'ANTERIOR', ...header, lineOrder: prev ? prev.lineOrder : null },
      });
    }

    const rows = statement.movements.map((mv) => {
      const prevManual = kept.get(mv.fingerprint);
      const classification = prevManual
        ? { status: prevManual.status, rubroId: prevManual.rubroId, itemLabel: prevManual.itemLabel, ruleId: null, reason: prevManual.reason, suggestions: null, note: prevManual.note }
        : autoFields(mv, reglas, rubros);
      return { ...movementRow(rendicion.id, mv), ...classification };
    });
    await tx.rendicionMovimiento.createMany({ data: rows });
    return { rendicionId: rendicion.id, replaced: Boolean(existing), keptManual: rows.filter((r) => kept.has(r.fingerprint)).length };
  });
}

// Reserva Caja de una rendición (ver rendicionBuilder): normalmente el Total
// Caja de la rendición CERRADA del mes anterior.
async function resolveReserve(r, consorcio) {
  if (r.reserveSource === 'MANUAL') return { cents: r.reserveCents, source: 'MANUAL', note: r.reserveNote };
  if (r.status === 'CERRADA') return { cents: r.reserveCents, source: r.reserveSource };
  const p = previousMonth(r.year, r.month);
  const prev = await prisma.rendicion.findFirst({ where: { consorcioId: r.consorcioId, year: p.year, month: p.month } });
  if (prev && prev.status === 'CERRADA') return { cents: prev.totalCajaCents, source: 'ANTERIOR' };
  if (prev) {
    return { cents: null, source: 'ANTERIOR', reason: `La rendición de ${monthLabel(p.year, p.month)} todavía no está cerrada: cerrala para que su Total Caja pase como Reserva Caja, o cargá la reserva a mano.` };
  }
  const earlier = await prisma.rendicion.count({
    where: { consorcioId: r.consorcioId, OR: [{ year: { lt: r.year } }, { year: r.year, month: { lt: r.month } }] },
  });
  if (earlier) {
    return { cents: null, source: 'ANTERIOR', reason: `Falta la rendición de ${monthLabel(p.year, p.month)}: subila y cerrala, o cargá la Reserva Caja a mano.` };
  }
  if (consorcio.initialReserveCents != null) return { cents: consorcio.initialReserveCents, source: 'INICIAL' };
  return { cents: null, source: 'INICIAL', reason: 'Es la primera rendición del consorcio: cargá la Reserva Caja inicial (el Total Caja del último informe hecho a mano).' };
}

async function loadRendicion(groupId, rendicionId) {
  const rendicion = await findRendicion(groupId, rendicionId);
  const consorcio = await findConsorcio(groupId, rendicion.consorcioId);
  const rubros = await prisma.consorcioRubro.findMany({ where: { consorcioId: consorcio.id }, orderBy: { number: 'asc' } });
  const movimientos = await prisma.rendicionMovimiento.findMany({ where: { rendicionId }, orderBy: { index: 'asc' } });
  const ajustes = await prisma.rendicionAjuste.findMany({ where: { rendicionId }, orderBy: { createdAt: 'asc' } });
  return { rendicion, consorcio, rubros, movimientos, ajustes };
}

async function buildReport(ctx) {
  const { rendicion, consorcio, rubros, movimientos, ajustes } = ctx;
  if (rendicion.status === 'CERRADA' && rendicion.snapshot) return rendicion.snapshot;
  const reserve = await resolveReserve(rendicion, consorcio);
  return buildRendicion({
    title: consorcio.name,
    year: rendicion.year,
    month: rendicion.month,
    rubros,
    movements: movimientos,
    adjustments: ajustes,
    reserve,
    reserveLabel: consorcio.reserveLabel,
    lineOrder: rendicion.lineOrder,
    bankClosingCents: rendicion.closingBalanceCents,
  });
}

async function getRendicion(groupId, rendicionId) {
  const ctx = await loadRendicion(groupId, rendicionId);
  const report = await buildReport(ctx);
  return { ...ctx, report };
}

const ACTIONS = ['ASIGNAR', 'EXCLUIR', 'AUTO'];

async function classifyMovements(groupId, rendicionId, items) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  const consorcioId = rendicion.consorcioId;
  const rubros = await prisma.consorcioRubro.findMany({ where: { consorcioId } });
  const rubrosById = new Map(rubros.map((r) => [r.id, r]));
  const movimientos = await prisma.rendicionMovimiento.findMany({ where: { rendicionId } });
  const byId = new Map(movimientos.map((m) => [m.id, m]));

  // Validar todo antes de escribir nada.
  for (const it of items) {
    const mv = byId.get(it.movementId);
    if (!mv) throw bad('UNKNOWN_MOVEMENT', 'Uno de los movimientos no pertenece a esta rendición.');
    if (!ACTIONS.includes(it.action)) throw bad('BAD_ACTION', `Acción desconocida: ${it.action}`);
    if (it.action === 'ASIGNAR') {
      if (!rubrosById.has(it.rubroId)) throw bad('UNKNOWN_RUBRO', 'El rubro elegido no pertenece a este consorcio.');
      if (!it.itemLabel || !it.itemLabel.trim()) throw bad('MISSING_ITEM_LABEL', `Falta el texto de la línea del informe para "${mv.description}".`);
      if (it.remember) ruleFromMovement(mv, { rubroId: it.rubroId, itemLabel: it.itemLabel.trim() });
    }
    if (it.action === 'EXCLUIR' && (!it.note || !it.note.trim())) {
      throw bad('EXCLUDED_WITHOUT_NOTE', `Para excluir "${mv.description}" del informe escribí una nota que explique por qué.`);
    }
  }

  let rulesChanged = false;
  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      const mv = byId.get(it.movementId);
      if (it.action === 'ASIGNAR') {
        const itemLabel = it.itemLabel.trim();
        const rubro = rubrosById.get(it.rubroId);
        await tx.rendicionMovimiento.update({
          where: { id: mv.id },
          data: {
            status: STATUS.MANUAL, rubroId: it.rubroId, itemLabel, ruleId: null, suggestions: null,
            note: it.note ? it.note.trim() : null,
            reason: `Elegido a mano → ${String(rubro.number).padStart(2, '0')} ${rubro.name} «${itemLabel}».`,
          },
        });
        if (it.remember) {
          const newRule = { ...ruleFromMovement(mv, { rubroId: it.rubroId, itemLabel, alwaysAsk: it.remember === 'PREGUNTAR' }), consorcioId };
          const existing = await tx.consorcioRegla.findMany({ where: { consorcioId } });
          const plan = planRemember(existing, newRule);
          for (const u of plan.update) await tx.consorcioRegla.update({ where: { id: u.id }, data: u.data });
          for (const c of plan.create) await tx.consorcioRegla.create({ data: c });
          rulesChanged = true;
        }
      } else if (it.action === 'EXCLUIR') {
        await tx.rendicionMovimiento.update({
          where: { id: mv.id },
          data: { status: STATUS.EXCLUIDO, rubroId: null, itemLabel: null, ruleId: null, suggestions: null, note: it.note.trim(), reason: 'Excluido del informe a mano.' },
        });
      } else {
        await tx.rendicionMovimiento.update({ where: { id: mv.id }, data: { status: STATUS.PENDIENTE } });
      }
    }
  });

  // Lo vuelto a "automático" y, si cambiaron reglas, todo lo no manual se recalcula.
  await reapply(rendicionId, consorcioId, rulesChanged);
  return getRendicion(groupId, rendicionId);
}

async function reapply(rendicionId, consorcioId, all) {
  const rubros = await prisma.consorcioRubro.findMany({ where: { consorcioId } });
  const reglas = await prisma.consorcioRegla.findMany({ where: { consorcioId } });
  const movimientos = await prisma.rendicionMovimiento.findMany({ where: { rendicionId } });
  let changed = 0;
  for (const mv of movimientos) {
    const isAutomatic = mv.status !== STATUS.MANUAL && mv.status !== STATUS.EXCLUIDO;
    if (!isAutomatic || (!all && mv.status !== STATUS.PENDIENTE)) continue;
    await prisma.rendicionMovimiento.update({ where: { id: mv.id }, data: autoFields(mv, reglas, rubros) });
    changed++;
  }
  return changed;
}

async function reapplyRules(groupId, rendicionId) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  const changed = await reapply(rendicionId, rendicion.consorcioId, true);
  return { changed, ...(await getRendicion(groupId, rendicionId)) };
}

// ───────────────────────── Ajustes y líneas manuales ─────────────────────────

async function createAjuste(groupId, rendicionId, data) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  await findRubro(rendicion.consorcioId, data.rubroId);
  await prisma.rendicionAjuste.create({ data: { ...data, itemLabel: data.itemLabel.trim(), note: data.note.trim(), rendicionId } });
  return getRendicion(groupId, rendicionId);
}

async function findAjuste(rendicionId, ajusteId) {
  const a = await prisma.rendicionAjuste.findFirst({ where: { id: ajusteId, rendicionId } });
  if (!a) throw notFound('Ajuste');
  return a;
}

async function updateAjuste(groupId, rendicionId, ajusteId, data) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  await findAjuste(rendicionId, ajusteId);
  if (data.rubroId) await findRubro(rendicion.consorcioId, data.rubroId);
  await prisma.rendicionAjuste.update({ where: { id: ajusteId }, data });
  return getRendicion(groupId, rendicionId);
}

async function deleteAjuste(groupId, rendicionId, ajusteId) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  await findAjuste(rendicionId, ajusteId);
  await prisma.rendicionAjuste.delete({ where: { id: ajusteId } });
  return getRendicion(groupId, rendicionId);
}

// ───────────────────────── Reserva, orden, cierre ─────────────────────────

async function setReserve(groupId, rendicionId, { mode, cents = null, note = null }) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  const data = mode === 'MANUAL'
    ? { reserveSource: 'MANUAL', reserveCents: cents, reserveNote: note }
    : { reserveSource: 'ANTERIOR', reserveCents: null, reserveNote: null };
  await prisma.rendicion.update({ where: { id: rendicionId }, data });
  return getRendicion(groupId, rendicionId);
}

async function setLineOrder(groupId, rendicionId, keys) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  await prisma.rendicion.update({ where: { id: rendicionId }, data: { lineOrder: keys } });
  return getRendicion(groupId, rendicionId);
}

async function closeRendicion(groupId, rendicionId, userId) {
  const ctx = await loadRendicion(groupId, rendicionId);
  assertEditable(ctx.rendicion);
  const report = await buildReport(ctx);
  if (!report.canGenerate) {
    throw conflict('REPORT_BLOCKED', 'No se puede cerrar: hay cosas pendientes.', { blockers: report.blockers });
  }
  await prisma.rendicion.update({
    where: { id: rendicionId },
    data: {
      status: 'CERRADA',
      snapshot: report,
      totalCajaCents: report.totals.totalCajaCents,
      reserveCents: report.totals.reserveCents,
      reserveSource: report.totals.reserveSource,
      closedAt: new Date(),
      closedById: userId,
    },
  });
  return getRendicion(groupId, rendicionId);
}

async function reopenRendicion(groupId, rendicionId) {
  const rendicion = await findRendicion(groupId, rendicionId);
  if (rendicion.status !== 'CERRADA') throw conflict('NOT_CLOSED', 'La rendición no está cerrada.');
  const n = rendicion.month === 12 ? { year: rendicion.year + 1, month: 1 } : { year: rendicion.year, month: rendicion.month + 1 };
  const next = await prisma.rendicion.findFirst({ where: { consorcioId: rendicion.consorcioId, year: n.year, month: n.month } });
  if (next && next.status === 'CERRADA') {
    throw conflict('NEXT_CLOSED', `No se puede reabrir: la rendición de ${monthLabel(n.year, n.month)} ya está cerrada y usa este Total Caja como Reserva. Reabrí primero esa.`);
  }
  const keepManual = rendicion.reserveSource === 'MANUAL';
  await prisma.rendicion.update({
    where: { id: rendicionId },
    data: {
      status: 'BORRADOR', snapshot: null, totalCajaCents: null, closedAt: null, closedById: null,
      reserveCents: keepManual ? rendicion.reserveCents : null,
    },
  });
  return getRendicion(groupId, rendicionId);
}

async function deleteRendicion(groupId, rendicionId) {
  const rendicion = await findRendicion(groupId, rendicionId);
  assertEditable(rendicion);
  await prisma.$transaction(async (tx) => {
    await tx.rendicionMovimiento.deleteMany({ where: { rendicionId } });
    await tx.rendicionAjuste.deleteMany({ where: { rendicionId } });
    await tx.rendicion.delete({ where: { id: rendicionId } });
  });
}

// ───────────────────────── Documentos ─────────────────────────

async function generateDocument(groupId, rendicionId, format) {
  const { report } = await getRendicion(groupId, rendicionId);
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { logo: true } });
  const opts = { logo: group ? group.logo : null };
  const base = fileBaseName(report);
  if (format === 'docx') {
    return {
      buffer: await generateRendicionDocx(report, opts),
      fileName: `${base}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  return { buffer: await generateRendicionPdf(report, opts), fileName: `${base}.pdf`, contentType: 'application/pdf' };
}

module.exports = {
  MAX_PDF_BYTES,
  listConsorcios,
  getConsorcio,
  createConsorcio,
  updateConsorcio,
  deleteConsorcio,
  createRubro,
  updateRubro,
  deleteRubro,
  createRegla,
  updateRegla,
  deleteRegla,
  listRendiciones,
  uploadStatement,
  getRendicion,
  classifyMovements,
  reapplyRules,
  createAjuste,
  updateAjuste,
  deleteAjuste,
  setReserve,
  setLineOrder,
  closeRendicion,
  reopenRendicion,
  deleteRendicion,
  generateDocument,
};
