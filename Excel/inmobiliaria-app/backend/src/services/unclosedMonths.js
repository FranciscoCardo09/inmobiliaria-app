// Meses terminados sin Deuda que deben plata ("meses huérfanos").
//
// Un mes que ya terminó y que el grupo ya cerró tiene que ser una Deuda si quedó debiendo.
// Cuando el cierre lo saltea (flag post-vencimiento rancio, error dentro del loop, mes fuera de
// rango ese día y en rango después) o cuando algo lo hace deber DESPUÉS del cierre (anular un
// pago, agregar un servicio, editar el cronograma), el mes queda sin Deuda y, como no tiene
// pagos propios, nada lo ve: ni el orden cronológico, ni "Pagar varios", ni Deudas, ni el
// dashboard, ni los avisos.
//
// Caso real (Gutiérrez Juan Rodrigo, agosto 2026): julio sobrepagado dejó $809.497,64 a favor,
// agosto ($900.000) quedó debiendo $130.685,41 + mora sin Deuda — el cierre de agosto lo salteó
// por el flag post-vencimiento rancio. Al cobrar Octubre con "Pagar varios meses" se sumaban
// Septiembre (Deuda) y Octubre, y agosto no aparecía.
//
// Este módulo es la fuente ÚNICA de esa definición. Lo usan:
//   - las lecturas (`getUnpaidPeriods` / `canPayCurrentMonth` / preview de "Pagar varios" /
//     preview del cierre): Deuda VIRTUAL, sin escribir nada;
//   - las escrituras (cobros, cierre, mutaciones de un mes pasado, script de reparación):
//     `ensureDebtsForUnclosedMonths` la crea de verdad (decisión del usuario 2026-10-20:
//     "convertirlo en Deuda", igual que si se hubiera cerrado a tiempo).
//
// Cierre tardío ≡ cierre a tiempo: sin pagos el ancla de la Deuda es el día 1 del período y la
// mora se cuenta en vivo desde ahí; con pagos el ancla es el último pago y el congelado es el del
// mes. En ningún caso depende del día en que se crea la Deuda.

const prisma = require('../lib/prisma');

const periodKey = (p) => p.periodYear * 12 + p.periodMonth;

// Mismo `include` que usa `closeMonth`: es lo que necesita `computeDebtDraft`.
const RECORD_INCLUDE = {
  contract: true,
  services: { include: { conceptType: { select: { category: true } } } },
  transactions: {
    orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
    include: { concepts: { select: { type: true, amount: true } } },
  },
};

/**
 * Último período que el grupo ya cerró: el más nuevo con alguna Deuda (cualquier estado; una
 * Deuda saldada sigue siendo prueba de que el período se cerró), topeado al último mes que ya
 * se puede cerrar. Sin ningún cierre todavía → null (no hay meses huérfanos posibles).
 *
 * No se usa "el mes pasado" a secas: el cierre es manual y un mes que el usuario todavía no
 * cerró no es un huérfano, es el próximo cierre.
 */
const lastClosedKey = async (groupId, today, db = prisma) => {
  const { isMonthClosable } = require('./monthlyCloseService');
  const last = await db.debt.findFirst({
    where: { groupId },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    select: { periodMonth: true, periodYear: true },
  });
  if (!last) return null;
  // Una deuda de un mes que todavía no terminó (cierre adelantado, ya bloqueado desde
  // 2026-10-20) no habilita cerrar meses por adelantado.
  let key = periodKey(last);
  while (!isMonthClosable(((key - 1) % 12) + 1, Math.floor((key - 1) / 12), today)) key -= 1;
  return key;
};

/**
 * Raíz de la cadena de renovación de cada contrato (el más viejo), para agrupar los meses de
 * una misma relación de alquiler aunque estén repartidos en varios contratos.
 */
const chainRoots = (contracts) => {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const roots = new Map();
  for (const c of contracts) {
    let cur = c;
    const seen = new Set();
    while (cur.renewedFromContractId && byId.has(cur.renewedFromContractId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.renewedFromContractId);
    }
    roots.set(c.id, cur.id);
  }
  return roots;
};

/**
 * Meses terminados, ya cerrados por el grupo, sin Deuda, que deben más de $1.
 *
 * @param {object} opts
 * @param {string} opts.groupId
 * @param {string[]|null} opts.contractIds - cadena de renovación a mirar; null = todo el grupo
 * @param {number|null} opts.beforeKey - sólo períodos anteriores a éste (año*12+mes)
 * @param {string} opts.today - "YYYY-MM-DD" ART
 * @returns {Promise<Array<{ record, draft, data }>>} ordenados del más viejo al más nuevo;
 *   `data` es la Deuda que se crearía (`buildDebtData`).
 */
const findUnclosedOwingRecords = async ({ groupId, contractIds = null, beforeKey = null, today, db = prisma }) => {
  const { computeDebtDraft, buildDebtData } = require('./debtService');
  const { isContractInRangeForMonth } = require('./monthlyRecordService');

  const capKey = await lastClosedKey(groupId, today, db);
  if (capKey === null) return [];

  const contractWhere = contractIds ? { groupId, id: { in: contractIds } } : { groupId };
  const contracts = await db.contract.findMany({
    where: contractWhere,
    select: { id: true, renewedFromContractId: true },
  });
  if (contracts.length === 0) return [];
  const ids = contracts.map((c) => c.id);
  const roots = chainRoots(contracts);

  const [records, debts] = await Promise.all([
    db.monthlyRecord.findMany({
      where: { groupId, contractId: { in: ids } },
      include: RECORD_INCLUDE,
    }),
    db.debt.findMany({
      where: { groupId, contractId: { in: ids } },
      select: { monthlyRecordId: true, contractId: true, periodMonth: true, periodYear: true },
    }),
  ]);
  const withDebt = new Set(debts.map((d) => d.monthlyRecordId));

  // Piso por cadena: el primer período con movimiento real (una Deuda o un mes con plata
  // cobrada). Los meses anteriores son los PENDING que el Control Mensual autogeneró para el
  // tiempo previo al uso del sistema (en prod, cientos de 2025) y nunca fueron obligaciones.
  const floor = new Map();
  const bumpFloor = (contractId, key) => {
    const root = roots.get(contractId);
    if (!floor.has(root) || key < floor.get(root)) floor.set(root, key);
  };
  for (const d of debts) bumpFloor(d.contractId, periodKey(d));
  for (const r of records) if ((r.amountPaid || 0) > 0) bumpFloor(r.contractId, periodKey(r));

  const candidates = records
    .filter((r) => {
      const key = periodKey(r);
      if (withDebt.has(r.id)) return false;
      if (key > capKey) return false;
      if (beforeKey !== null && key >= beforeKey) return false;
      const min = floor.get(roots.get(r.contractId));
      if (min === undefined || key < min) return false;
      if ((r.balanceForgiven || 0) > 0) return false;
      // Un mes SALDADO para el motor mensual (la fuente del Control Mensual) no es huérfano.
      // `computeDebtDraft` está pensado para cerrar un mes a fin de mes: sobre un mes ya saldado
      // con muchos pagos puede reconstruir la mora distinto y "ver" una deuda que el Control
      // Mensual no ve (Russo Carlos abril 2026: 13 pagos, COMPLETO por $940.000, y el borrador le
      // daba $36.112,83). Los caminos que lo hacen deber (anular pago, servicio, condonación)
      // recalculan el mes ANTES de llegar acá, así que el estado está fresco.
      if (r.status === 'COMPLETE') return false;
      // El rango manda, no el flag persistido: el mes extra post-vencimiento es `endMonth + 1`
      // (fuera de rango) y un flag rancio sobre un mes en rango es justamente la causa del caso
      // Gutiérrez. Mismo predicado que el cierre (`isCloseCandidate`).
      return isContractInRangeForMonth(r.contract, r.monthNumber);
    })
    .sort((a, b) => periodKey(a) - periodKey(b));

  const result = [];
  for (const record of candidates) {
    // La plata decide (misma función que el cierre): ≤ $1 neto del crédito → no debe.
    const draft = await computeDebtDraft(record, record.contract);
    const data = buildDebtData(draft, record.contract);
    if (data) result.push({ record, draft, data });
  }
  return result;
};

/**
 * Deuda VIRTUAL (sin persistir) de un mes huérfano: mismos campos que tendrá al crearse, con
 * `id: null` y la marca `pendingClose`. Sirve para `calculateDebtPunitory(..., skipUpdate=true)`.
 */
const toVirtualDebt = ({ data }) => ({ ...data, id: null, pendingClose: true, payments: [] });

/**
 * Crea las Deudas de los meses huérfanos (escritura; idempotente: `createDebtFromMonthlyRecord`
 * devuelve la existente y absorbe la carrera por la restricción única).
 *
 * @returns {Promise<object[]>} deudas creadas (o encontradas) en este llamado
 */
const ensureDebtsForUnclosedMonths = async ({ groupId, contractIds = null, beforeKey = null, today }) => {
  const { createDebtFromMonthlyRecord } = require('./debtService');
  const found = await findUnclosedOwingRecords({ groupId, contractIds, beforeKey, today });
  const created = [];
  for (const { record } of found) {
    const debt = await createDebtFromMonthlyRecord(record, record.contract);
    if (debt) created.push(debt);
  }
  return created;
};

/**
 * Versión para los ganchos posteriores a una mutación (anular pago, servicios, cronograma): la
 * mutación ya se confirmó, así que un error acá no puede convertirla en un 500. Si falla, el
 * mes igual aparece en el cobro (lectura) y lo materializa el próximo cobro o cierre.
 */
const ensureDebtsAfterMutation = async ({ groupId, contractId, today }) => {
  try {
    const { expandToChain } = require('./debtService');
    const contractIds = await expandToChain(contractId);
    return await ensureDebtsForUnclosedMonths({ groupId, contractIds, today });
  } catch (error) {
    console.error('[unclosedMonths] no se pudo pasar a deuda un mes sin cerrar:', error);
    return [];
  }
};

/**
 * Igual que `ensureDebtsAfterMutation`, partiendo de los meses tocados (servicios, IVA).
 */
const ensureDebtsAfterRecordMutation = async (recordIds, today, db = prisma) => {
  const ids = [...new Set(recordIds || [])].filter(Boolean);
  if (ids.length === 0) return [];
  const records = await db.monthlyRecord.findMany({
    where: { id: { in: ids } },
    select: { groupId: true, contractId: true },
  });
  const seen = new Set();
  const created = [];
  for (const r of records) {
    if (seen.has(r.contractId)) continue;
    seen.add(r.contractId);
    created.push(...await ensureDebtsAfterMutation({ groupId: r.groupId, contractId: r.contractId, today }));
  }
  return created;
};

module.exports = {
  periodKey,
  lastClosedKey,
  chainRoots,
  findUnclosedOwingRecords,
  toVirtualDebt,
  ensureDebtsForUnclosedMonths,
  ensureDebtsAfterMutation,
  ensureDebtsAfterRecordMutation,
};
