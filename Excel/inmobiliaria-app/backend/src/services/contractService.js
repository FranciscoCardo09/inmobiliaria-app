const prisma = require('../lib/prisma');
const {
  calculateNextAdjustmentMonth,
  computeCurrentMonth,
  findOutOfScheduleAdjustments,
  isMonthLocked,
} = require('./adjustmentService');
const { calculateRentForMonth, recalculateMultipleRecords } = require('./monthlyRecordService');
const { getPeriodLabel, calculateCurrentContractMonth } = require('../utils/dateUtils');

/**
 * Fecha de vencimiento del contrato: startDate + durationMonths - 1 día.
 * No es una columna: se deriva siempre desde (startDate, durationMonths).
 */
const computeEndDate = (c) => {
  const endDate = new Date(c.startDate);
  endDate.setMonth(endDate.getMonth() + c.durationMonths);
  endDate.setDate(endDate.getDate() - 1);
  return endDate;
};

const enrichContract = (c) => {
  const adjustmentIndex = c.adjustmentIndex;

  const start = new Date(c.startDate);
  const now = new Date();
  
  const computedCurrentMonth = calculateCurrentContractMonth(c.startDate, c.startMonth, c.durationMonths, now);
  const sm = c.startMonth || 1;
  const endMonth = sm + c.durationMonths - 1;

  const currentPeriodLabel = getPeriodLabel(c.startDate, computedCurrentMonth, sm);

  let nextAdjustmentLabel = null;
  let nextAdjustmentIsThisMonth = false;

  let effectiveNextAdj = c.nextAdjustmentMonth;
  if (adjustmentIndex && effectiveNextAdj && effectiveNextAdj < computedCurrentMonth) {
    effectiveNextAdj = calculateNextAdjustmentMonth(
      c.startMonth, computedCurrentMonth, adjustmentIndex.frequencyMonths, c.durationMonths
    );
  }

  if (adjustmentIndex && effectiveNextAdj) {
    nextAdjustmentIsThisMonth = computedCurrentMonth === effectiveNextAdj;
    if (nextAdjustmentIsThisMonth) {
      nextAdjustmentLabel = `Ajuste este mes (Mes ${computedCurrentMonth})`;
    } else {
      const adjLabel = getPeriodLabel(c.startDate, effectiveNextAdj, sm);
      nextAdjustmentLabel = `${adjLabel} (${adjustmentIndex.name})`;
    }
  }

  const endDate = computeEndDate(c);

  const remainingMonths = Math.max(0, endMonth - computedCurrentMonth);

  let status;
  if (!c.active && c.renewedAt) {
    status = 'RENEWED';
  } else if (!c.active) {
    status = 'TERMINATED';
  } else if (c.rescindedAt) {
    status = 'RESCINDED';
  } else if (now > endDate) {
    status = 'EXPIRED';
  } else {
    status = 'ACTIVE';
  }

  // Un contrato ya renovado (aunque siga operativo por renovación anticipada)
  // NO vuelve a avisar "por vencer": su sucesión ya está resuelta.
  const isExpiringSoon = status === 'ACTIVE' && remainingMonths <= 2 && !c.renewedAt;

  // Renovación anticipada: el viejo sigue OPERATIVO (active=true) hasta su
  // endDate, pero ya tiene un contrato sucesor programado.
  const hasScheduledRenewal = c.active === true && !!c.renewedAt;
  // El contrato nuevo de una renovación anticipada, todavía sin arrancar.
  const isScheduled = c.active === true && !c.renewedAt && start > now;

  // Única fuente de verdad para habilitar el botón "Renovar" (front y back).
  const canRenew = !c.renewedAt && !c.rescindedAt && (status === 'EXPIRED' || isExpiringSoon);

  return {
    ...c,
    contractType: c.contractType || 'INQUILINO',
    currentMonth: computedCurrentMonth,
    nextAdjustmentMonth: effectiveNextAdj,
    endDate,
    status,
    rentAmount: (c.rescindedAt && c.rescissionPenalty) ? c.rescissionPenalty : c.baseRent,
    currentPeriodLabel,
    remainingMonths,
    isExpiringSoon,
    hasScheduledRenewal,
    isScheduled,
    canRenew,
    nextAdjustmentIsThisMonth,
    nextAdjustmentLabel,
    rescindedAt: c.rescindedAt || null,
    rescissionPenalty: c.rescissionPenalty || null,
  };
};

const getExpiringContractsOptimized = async (groupId) => {
  const contracts = await prisma.contract.findMany({
    where: { groupId, active: true, renewedAt: null },
    include: {
      tenant: { select: { id: true, name: true, dni: true, phone: true } },
      contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
      property: {
        select: {
          id: true, address: true,
          category: { select: { id: true, name: true, color: true } },
        },
      },
      adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true } },
    },
    orderBy: { startDate: 'asc' },
  });

  const expiring = contracts
    .map((c) => {
      const tenants = c.contractTenants.length > 0
        ? c.contractTenants.map((ct) => ct.tenant)
        : c.tenant ? [c.tenant] : [];
      return { ...enrichContract(c), tenants };
    })
    .filter((c) => c.isExpiringSoon)
    .sort((a, b) => a.remainingMonths - b.remainingMonths || new Date(a.endDate) - new Date(b.endDate));

  return expiring;
};

/**
 * Devuelve la cadena de IDs de contratos vinculados por renovación, partiendo
 * del contractId y caminando hacia atrás vía renewedFromContractId.
 * Útil para encontrar deudas/registros mensuales que pertenecen a contratos
 * anteriores en la cadena de renovaciones.
 *
 * @param {string} contractId - ID del contrato (típicamente el más reciente)
 * @param {object} [client=prisma] - Cliente Prisma o transacción
 * @returns {Promise<string[]>} Lista de contractIds incluyendo el original, ordenada desde el más nuevo al más viejo.
 */
const getContractChain = async (contractId, client = prisma) => {
  const chain = [];
  let currentId = contractId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    chain.push(currentId);
    const c = await client.contract.findUnique({
      where: { id: currentId },
      select: { renewedFromContractId: true },
    });
    currentId = c?.renewedFromContractId || null;
  }

  return chain;
};

const formatDMY = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

/**
 * Valida la fecha de inicio de una renovación contra el contrato viejo.
 *
 * Regla 1 (siempre): el nuevo contrato tiene que empezar DESPUÉS del
 * vencimiento del viejo. Sin esto, los rangos de meses se superponen y Control
 * Mensual mostraría dos filas para la misma propiedad en el mismo período.
 *
 * Regla 2 (solo renovación anticipada): además tiene que empezar dentro del mes
 * calendario siguiente al último mes del viejo. Así no queda un mes en blanco
 * entre un contrato y el otro.
 *
 * @param {object} oldContract - contrato a renovar (con startDate/durationMonths)
 * @param {Date} newStartDate
 * @param {{ strictAdjacency?: boolean }} [opts]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
const validateRenewalStartDate = (oldContract, newStartDate, { strictAdjacency = false } = {}) => {
  const oldEndDate = computeEndDate(oldContract);

  if (!(newStartDate > oldEndDate)) {
    return {
      ok: false,
      message: `La fecha de inicio debe ser posterior al vencimiento del contrato actual (${formatDMY(oldEndDate)})`,
    };
  }

  if (strictAdjacency) {
    // El mes calendario siguiente al del vencimiento.
    const expected = new Date(oldEndDate);
    expected.setDate(1);
    expected.setMonth(expected.getMonth() + 1);
    const sameMonth =
      newStartDate.getFullYear() === expected.getFullYear() &&
      newStartDate.getMonth() === expected.getMonth();
    if (!sameMonth) {
      return {
        ok: false,
        message: `La renovación anticipada debe comenzar en el mes siguiente al vencimiento (${formatDMY(oldEndDate)}), para no dejar meses sin contrato`,
      };
    }
  }

  return { ok: true };
};

/**
 * Borra los AJUSTE_AUTOMATICO que quedaron fuera del cronograma vigente (típicamente
 * los que aplicó un índice anterior de otra frecuencia) y devuelve los meses abiertos
 * al alquiler que realmente corresponde.
 *
 * Caso Ciuro (2026-08-10) — ver `findOutOfScheduleAdjustments` y
 * `tests/adjustmentIndexCleanup.test.js`. NO se dispara solo al cambiar el índice:
 * `updateContract` avisa (ADJUSTMENTS_FROM_PREVIOUS_INDEX) y esto corre únicamente si
 * el usuario confirma, misma política que el resto del código de no mover plata sin
 * avisar. Decisión del usuario, 2026-08-10.
 *
 * Es todo-o-nada: si CUALQUIER mes desde el primer ajuste huérfano ya está cobrado o
 * cerrado, no borra nada (borrarlo le bajaría el alquiler a un mes ya cobrado, misma
 * guarda A-09 que usan las tres funciones de ajuste).
 *
 * No toca `nextAdjustmentMonth`: por definición las filas borradas están FUERA del
 * cronograma, así que no pueden afectar cuál es el próximo mes de ajuste.
 *
 * @returns {Promise<{deleted: Array, skipped: Array, recordsUpdated: number}>}
 */
const cleanupOutOfScheduleAdjustments = async (groupId, contractId) => {
  const empty = { deleted: [], skipped: [], recordsUpdated: 0 };

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, groupId },
    include: { adjustmentIndex: { select: { frequencyMonths: true } } },
  });
  if (!contract) return empty;

  const orphans = await findOutOfScheduleAdjustments(contract);
  if (orphans.length === 0) return empty;

  const fromMonth = Math.min(...orphans.map((h) => h.effectiveFromMonth));
  const affected = await prisma.monthlyRecord.findMany({
    where: { contractId, monthNumber: { gte: fromMonth } },
    orderBy: { monthNumber: 'asc' },
  });

  const lockedMonths = [];
  for (const record of affected) {
    if (await isMonthLocked(contractId, record.monthNumber)) lockedMonths.push(record.monthNumber);
  }
  if (lockedMonths.length > 0) {
    const reason =
      `Hay mes(es) ya cobrado(s) o cerrado(s) desde el mes ${fromMonth} del contrato ` +
      `(${lockedMonths.join(', ')}). No se limpió ningún ajuste para no reabrir un mes ya cobrado.`;
    return {
      deleted: [],
      recordsUpdated: 0,
      skipped: orphans.map((h) => ({ effectiveFromMonth: h.effectiveFromMonth, reason })),
    };
  }

  const deleted = [];
  for (const h of orphans) {
    await prisma.rentHistory.delete({ where: { id: h.id } });
    deleted.push({
      id: h.id,
      effectiveFromMonth: h.effectiveFromMonth,
      calendarMonth: h.calendarMonth,
      calendarYear: h.calendarYear,
      rentAmount: h.rentAmount,
      adjustmentPercent: h.adjustmentPercent,
    });
  }

  // Resincronizar el alquiler con la MISMA función que usa la app para mostrarlo,
  // en vez de escribir montos a mano.
  let recordsUpdated = 0;
  for (const record of affected) {
    const rent = await calculateRentForMonth(contract, record.monthNumber);
    if (rent === record.rentAmount) continue;
    await prisma.monthlyRecord.update({
      where: { id: record.id },
      data: { rentAmount: rent, ivaAmount: record.includeIva ? rent * 0.21 : 0 },
    });
    recordsUpdated++;
  }

  // baseRent debe quedar con el alquiler realmente vigente hoy: si la fila borrada
  // era el último ajuste aplicado, seguiría inflado (mismo criterio que el undo).
  const liveRent = await calculateRentForMonth(contract, computeCurrentMonth(contract));
  if (liveRent !== contract.baseRent) {
    await prisma.contract.update({ where: { id: contractId }, data: { baseRent: liveRent } });
  }

  if (affected.length > 0) {
    await recalculateMultipleRecords([affected[0].id], null, true);
  }

  return { deleted, skipped: [], recordsUpdated };
};

module.exports = {
  enrichContract,
  computeEndDate,
  validateRenewalStartDate,
  getExpiringContractsOptimized,
  getContractChain,
  cleanupOutOfScheduleAdjustments,
};
