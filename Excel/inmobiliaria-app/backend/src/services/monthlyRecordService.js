// Monthly Record Service - Core auto-generation and control logic
const { calculatePunitoryV2, getHolidaysForYear, round2, computePunitoryBase, computeGrossRecordPunitory, debtDelinquencyDays } = require('../utils/punitory');
const { calculateDebtPunitory } = require('./debtService');
const { calculateNextAdjustmentMonth } = require('./adjustmentService');
const { MONTH_NAMES } = require('../utils/constants');
const { sumPunitoryConcepts } = require('../utils/helpers');
// A-25: "hoy" del negocio en ART, TZ-inmune (ver dateUtils.js). El servidor
// corre sin TZ configurada (= UTC); usar `new Date()` crudo como "hoy" en un
// cálculo de punitorios cuenta un día de más entre las 21:00 y las 23:59 ART.
const { getTodayLocalString, getTodayLocalDate } = require('../utils/dateUtils');
const { sweepSupersededContracts } = require('./contractSweepService');

const prisma = require('../lib/prisma');

/**
 * Calculate which calendar month/year corresponds to a given contract month number
 */
function getCalendarPeriod(contract, monthNumber) {
  const startDate = new Date(contract.startDate);
  // Month number relative to start: monthNumber startMonth = startDate month
  const monthsToAdd = monthNumber - contract.startMonth;
  const date = new Date(startDate.getFullYear(), startDate.getMonth() + monthsToAdd, 1);
  return {
    periodMonth: date.getMonth() + 1, // 1-12
    periodYear: date.getFullYear(),
  };
}

/**
 * Calculate which contract month number corresponds to a given calendar month/year
 */
function getMonthNumber(contract, periodMonth, periodYear) {
  const startDate = new Date(contract.startDate);
  const startCalMonth = startDate.getMonth() + 1;
  const startCalYear = startDate.getFullYear();

  const totalMonthsDiff = (periodYear - startCalYear) * 12 + (periodMonth - startCalMonth);
  return contract.startMonth + totalMonthsDiff;
}

/**
 * Check if a monthNumber falls inside the contract's [startMonth..endMonth] range.
 * Does NOT gate on contract.active: renewed/inactive contracts still own their
 * historical periods (their MonthlyRecord/Debt remain valid and visible).
 */
function isContractInRangeForMonth(contract, monthNumber) {
  const endMonth = contract.startMonth + contract.durationMonths - 1;
  if (monthNumber < contract.startMonth || monthNumber > endMonth) return false;

  // For rescinded contracts, cap the active range at the rescission month number
  if (contract.rescindedAt) {
    const rescDate = new Date(contract.rescindedAt);
    const rescMonthNumber = getMonthNumber(contract, rescDate.getMonth() + 1, rescDate.getFullYear());
    return monthNumber <= Math.min(endMonth, rescMonthNumber);
  }

  return true;
}

/**
 * Whether new MonthlyRecord rows can be created for this contract.
 * Renewed (active=false + renewedAt) and otherwise inactive contracts cannot
 * receive new records — we only READ what already exists for their periods.
 */
function canCreateRecordForContract(contract) {
  return contract.active === true;
}

/**
 * Repara los monthNumber de los MonthlyRecord de un contrato para que sean
 * consistentes con (startDate, startMonth, durationMonths) actuales.
 *
 * Motivo: al editar la fecha de inicio / duración de un contrato, los records
 * existentes conservaban su monthNumber viejo y quedaban fuera del rango nuevo
 * ("meses fantasma"). El filtro recordInRange los ignora silenciosamente, lo
 * que escondía pagos reales (Problema A) o dejaba meses con deuda inflada de
 * contratos vencidos (Problema B).
 *
 * Reglas:
 *  - Recalcula el monthNumber de cada record desde su período calendario.
 *  - Record dentro de rango con monthNumber distinto => se corrige.
 *  - Record fuera de rango SIN plata (sin pagos, sin deuda, sin transacciones)
 *    => se borra (mes fantasma). Los MonthlyService se borran por cascade.
 *  - Record fuera de rango CON plata => se PRESERVA y se reporta para
 *    reconciliación manual (nunca se mueve dinero automáticamente).
 *
 * @returns {Promise<{updated:number, deleted:number, paidOrphans:Array}>}
 */
async function repairContractRecordMonthNumbers(contract, { deletePhantoms = true, client = prisma } = {}) {
  const endMonth = contract.startMonth + contract.durationMonths - 1;
  const records = await client.monthlyRecord.findMany({
    where: { contractId: contract.id },
    select: {
      id: true, periodMonth: true, periodYear: true, monthNumber: true, amountPaid: true,
      debt: { select: { id: true } },
      _count: { select: { transactions: true } },
    },
  });

  const result = { updated: 0, deleted: 0, paidOrphans: [] };
  const toUpdate = []; // { id, target }

  for (const r of records) {
    const target = getMonthNumber(contract, r.periodMonth, r.periodYear);
    const inRange = target >= contract.startMonth && target <= endMonth;
    const hasMoney = (r.amountPaid || 0) > 0 || !!r.debt || (r._count?.transactions || 0) > 0;

    if (inRange) {
      if (r.monthNumber !== target) toUpdate.push({ id: r.id, target });
    } else if (hasMoney) {
      result.paidOrphans.push({
        id: r.id, periodMonth: r.periodMonth, periodYear: r.periodYear,
        monthNumber: r.monthNumber, amountPaid: r.amountPaid || 0,
      });
    } else if (deletePhantoms) {
      await client.monthlyRecord.delete({ where: { id: r.id } });
      result.deleted++;
    }
  }

  // Aplicar correcciones en dos fases para no chocar con @@unique([contractId, monthNumber])
  if (toUpdate.length > 0) {
    const apply = async (tx) => {
      for (let i = 0; i < toUpdate.length; i++) {
        await tx.monthlyRecord.update({ where: { id: toUpdate[i].id }, data: { monthNumber: -(i + 1) } });
      }
      for (const u of toUpdate) {
        await tx.monthlyRecord.update({ where: { id: u.id }, data: { monthNumber: u.target } });
      }
    };
    if (client === prisma) await prisma.$transaction(apply); else await apply(client);
    result.updated = toUpdate.length;
  }

  return result;
}

/**
 * Returns the calendar {penaltyMonth, penaltyYear} for the penalty month of a rescinded contract
 * (the calendar month immediately following the rescission month)
 */
function getRescissionPenaltyPeriod(contract) {
  if (!contract.rescindedAt) return null;
  const rescDate = new Date(contract.rescindedAt);
  let penaltyMonth = rescDate.getMonth() + 2; // getMonth() is 0-indexed; +2 = next month in 1-indexed
  let penaltyYear = rescDate.getFullYear();
  if (penaltyMonth > 12) {
    penaltyMonth = 1;
    penaltyYear++;
  }
  return { penaltyMonth, penaltyYear };
}

/**
 * Calculate rent for a specific month considering adjustments
 */
async function calculateRentForMonth(contract, monthNumber) {
  // Buscar en el historial cuál era el rent vigente para este mes
  // El historial está ordenado por effectiveFromMonth descendente
  const rentHistory = await prisma.rentHistory.findFirst({
    where: {
      contractId: contract.id,
      effectiveFromMonth: { lte: monthNumber },
    },
    orderBy: [
      { effectiveFromMonth: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  if (rentHistory) {
    return rentHistory.rentAmount;
  }

  // Hay historial pero ninguno cubre este mes (contrato sin fila INICIAL, p.ej.
  // renovaciones viejas o startMonth reseteado por una edición): usar el registro
  // MÁS ANTIGUO, que es el alquiler más viejo conocido. NUNCA baseRent, porque
  // baseRent muta con cada ajuste y reescribiría meses pasados (caso Rezzonico).
  const oldestHistory = await prisma.rentHistory.findFirst({
    where: { contractId: contract.id },
    orderBy: [
      { effectiveFromMonth: 'asc' },
      { createdAt: 'asc' },
    ],
  });
  if (oldestHistory) return oldestHistory.rentAmount;

  // Sin historial en absoluto: baseRent es lo único disponible
  return contract.baseRent;
}

/**
 * Copy MonthlyService records from the rescission month into a penalty record.
 * Returns the computed servicesTotal (discounts subtracted).
 */
async function copyRescissionMonthServices(contract, penaltyRecordId) {
  const rescDate = new Date(contract.rescindedAt);
  const rescMonth = rescDate.getMonth() + 1; // 1-indexed
  const rescYear = rescDate.getFullYear();

  const prevRecord = await prisma.monthlyRecord.findFirst({
    where: { contractId: contract.id, periodMonth: rescMonth, periodYear: rescYear },
    include: {
      services: {
        include: { conceptType: { select: { id: true, category: true } } },
      },
    },
  });

  if (!prevRecord?.services?.length) return 0;

  await prisma.monthlyService.createMany({
    data: prevRecord.services.map(s => ({
      monthlyRecordId: penaltyRecordId,
      conceptTypeId: s.conceptTypeId,
      amount: s.amount,
      description: s.description,
    })),
    skipDuplicates: true,
  });

  return prevRecord.services.reduce((sum, s) => {
    const isDiscount = s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION';
    return sum + (isDiscount ? -Math.abs(s.amount) : s.amount);
  }, 0);
}

/**
 * Copy MonthlyService records from the contract's last active month (endMonth) into
 * the post-expiry record. Servicios se pagan a mes vencido, así que el mes posterior
 * al vencimiento cobra los servicios del último mes.
 * Returns the computed servicesTotal (discounts subtracted).
 */
async function copyLastMonthServices(contract, postExpiryRecordId) {
  const endMonth = contract.startMonth + contract.durationMonths - 1;
  const { periodMonth: lastMonth, periodYear: lastYear } = getCalendarPeriod(contract, endMonth);

  const lastRecord = await prisma.monthlyRecord.findFirst({
    where: { contractId: contract.id, periodMonth: lastMonth, periodYear: lastYear },
    include: {
      services: {
        include: { conceptType: { select: { id: true, category: true } } },
      },
    },
  });

  if (!lastRecord?.services?.length) return 0;

  await prisma.monthlyService.createMany({
    data: lastRecord.services.map(s => ({
      monthlyRecordId: postExpiryRecordId,
      conceptTypeId: s.conceptTypeId,
      amount: s.amount,
      description: s.description,
    })),
    skipDuplicates: true,
  });

  return lastRecord.services.reduce((sum, s) => {
    const isDiscount = s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION';
    return sum + (isDiscount ? -Math.abs(s.amount) : s.amount);
  }, 0);
}

/**
 * Get or create monthly records for all active contracts in a group for a given period.
 * This is the core auto-generation function.
 *
 * OPTIMIZED: Uses batched queries instead of per-contract queries.
 * Before: 4-8 queries × N contracts = 600-1200 queries for 150 contracts
 * After: ~5 batch queries + individual creates/updates only for missing/changed records
 */
const getOrCreateMonthlyRecords = async (groupId, periodMonth, periodYear) => {
  const month = parseInt(periodMonth);
  const year = parseInt(periodYear);

  // Cierra las renovaciones anticipadas cuyo contrato viejo ya terminó su rango:
  // pasa a active=false (estado RENEWED) para que deje de contar como vigente.
  // Idempotente; en régimen no escribe nada.
  await sweepSupersededContracts(groupId);

  // Get contracts relevant for any period: active ones (can create new records)
  // and renewed ones (active=false + renewedAt, only read their existing records).
  const contracts = await prisma.contract.findMany({
    where: {
      groupId,
      OR: [
        { active: true },
        { renewedAt: { not: null } },
      ],
    },
    include: {
      tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } },
      contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
      property: {
        select: {
          id: true,
          address: true,
          category: { select: { id: true, name: true, color: true } },
          owner: { select: { id: true, name: true } },
        },
      },
      adjustmentIndex: { select: { id: true, name: true, frequencyMonths: true, currentValue: true } },
    },
  });

  // Pre-filter contracts whose [startMonth..endMonth] range covers (month, year).
  // Active contracts may create new records; renewed contracts only READ existing ones.
  const activeContracts = [];
  for (const contract of contracts) {
    const monthNumber = getMonthNumber(contract, month, year);

    // Check if this period is the penalty month for a rescinded contract (only relevant for active contracts)
    if (contract.active && contract.rescindedAt) {
      const penaltyPeriod = getRescissionPenaltyPeriod(contract);
      if (penaltyPeriod && penaltyPeriod.penaltyMonth === month && penaltyPeriod.penaltyYear === year) {
        const rescDate = new Date(contract.rescindedAt);
        const rescMonthNumber = getMonthNumber(contract, rescDate.getMonth() + 1, rescDate.getFullYear());
        activeContracts.push({ contract, monthNumber: rescMonthNumber + 1, isPenaltyRecord: true, canCreate: true });
        continue;
      }
    }

    if (!isContractInRangeForMonth(contract, monthNumber)) {
      // Mes extra post-vencimiento (mes vencido de servicios): el mes calendario
      // siguiente al último mes del contrato. Alquiler $0, solo se cobran los
      // servicios del último mes (se pagan a mes vencido). No aplica a contratos
      // renovados (continúan con un contrato nuevo) ni rescindidos (ya tienen su
      // mes de penalidad).
      const endMonth = contract.startMonth + contract.durationMonths - 1;
      if (
        monthNumber === endMonth + 1 &&
        contract.active &&
        !contract.renewedAt &&
        !contract.rescindedAt
      ) {
        activeContracts.push({ contract, monthNumber, isPostExpiry: true, canCreate: true });
      }
      continue;
    }
    activeContracts.push({
      contract,
      monthNumber,
      isPenaltyRecord: false,
      canCreate: canCreateRecordForContract(contract),
    });
  }

  if (activeContracts.length === 0) return [];

  const contractIds = activeContracts.map(ac => ac.contract.id);

  // --- BATCH 1: Fetch ALL existing monthly records for this period (1 query) ---
  const existingRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth: month,
      periodYear: year,
      contractId: { in: contractIds },
    },
    include: {
      services: {
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { createdAt: 'asc' },
      },
      debt: {
        include: {
          payments: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  const recordsByContractId = new Map();
  for (const r of existingRecords) {
    recordsByContractId.set(r.contractId, r);
  }

  // --- BATCH 2: Fetch ALL rent histories for active contracts (1 query) ---
  const allRentHistories = await prisma.rentHistory.findMany({
    where: { contractId: { in: contractIds } },
    orderBy: [
      { contractId: 'asc' },
      { effectiveFromMonth: 'desc' },
      { createdAt: 'desc' }, // desempate: si hay 2 filas con el mismo mes, gana la más nueva
    ],
  });
  // Group by contractId, sorted desc by effectiveFromMonth
  const rentHistoriesByContractId = new Map();
  for (const rh of allRentHistories) {
    if (!rentHistoriesByContractId.has(rh.contractId)) {
      rentHistoriesByContractId.set(rh.contractId, []);
    }
    rentHistoriesByContractId.get(rh.contractId).push(rh);
  }

  // Helper: get rent for a specific month from batched data
  function getBatchedRentForMonth(contractId, monthNumber, baseRent) {
    const histories = rentHistoriesByContractId.get(contractId) || [];
    for (const rh of histories) {
      if (rh.effectiveFromMonth <= monthNumber) return rh.rentAmount;
    }
    // Hay historial pero ninguno cubre este mes: usar el MÁS ANTIGUO (último del
    // array, ordenado desc) = alquiler más viejo conocido. NUNCA baseRent: muta
    // con cada ajuste y reescribiría el alquiler de meses pasados (caso Rezzonico).
    if (histories.length > 0) return histories[histories.length - 1].rentAmount;
    return baseRent;
  }

  // --- BATCH 3: Fetch previous month records for balance calculation (1 simple query) ---
  // All contracts in the same calendar period have prevMonthNumber = monthNumber - 1,
  // which corresponds to the previous calendar month. Use simple period-based query.
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevRecordsByContractId = new Map();
  const prevRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth: prevMonth,
      periodYear: prevYear,
      contractId: { in: contractIds },
    },
    select: { contractId: true, balance: true },
  });
  for (const pr of prevRecords) {
    prevRecordsByContractId.set(pr.contractId, pr);
  }

  // --- BATCH 3b: Final saldo a favor de los contratos que este batch renovó DESDE
  // (C-06). Las deudas ya se encadenan vía renewedFromContractId/expandToChain; el
  // crédito no tenía ningún mecanismo equivalente y se perdía en la renovación.
  const renewedFromIds = Array.from(new Set(
    activeContracts
      .filter(({ monthNumber, contract }) => monthNumber === 1 && contract.renewedFromContractId)
      .map(({ contract }) => contract.renewedFromContractId)
  ));
  const oldContractFinalBalance = new Map(); // oldContractId -> saldo a favor final (>=0)
  if (renewedFromIds.length > 0) {
    const oldLastRecords = await prisma.monthlyRecord.findMany({
      where: { contractId: { in: renewedFromIds } },
      select: { contractId: true, monthNumber: true, balance: true },
      orderBy: [{ contractId: 'asc' }, { monthNumber: 'desc' }],
    });
    for (const r of oldLastRecords) {
      // Primera ocurrencia por contrato = monthNumber más alto (el último mes real).
      if (!oldContractFinalBalance.has(r.contractId)) {
        oldContractFinalBalance.set(r.contractId, r.balance > 0 ? r.balance : 0);
      }
    }
  }

  // --- BATCH 4: Get holidays once for the year (1 call instead of N) ---
  const holidays = await getHolidaysForYear(year);

  // --- BATCH 5: Bulk-create missing records (1 createMany instead of N creates) ---
  const recordsToCreate = [];
  const penaltyContractsToSetup = []; // penalty records that need prev-month services copied
  const postExpiryContractsToSetup = []; // post-expiry records that need last-month services copied
  for (const { contract, monthNumber, isPenaltyRecord, isPostExpiry, canCreate } of activeContracts) {
    if (recordsByContractId.has(contract.id)) continue;
    // Renewed/inactive contracts only expose existing records; never create new ones.
    if (!canCreate) continue;

    if (isPostExpiry) {
      // Mes extra post-vencimiento: alquiler $0, IVA $0. Solo se cobran los
      // servicios del último mes (mes vencido), que se copian luego del bulk-create.
      recordsToCreate.push({
        groupId,
        contractId: contract.id,
        monthNumber,
        periodMonth: month,
        periodYear: year,
        rentAmount: 0,
        includeIva: false,
        ivaAmount: 0,
        servicesTotal: 0,
        previousBalance: 0,
        punitoryAmount: 0,
        punitoryDays: 0,
        totalDue: 0,
        amountPaid: 0,
        balance: 0,
        isPostExpiry: true,
        comprobantesStatus: [],
      });
      postExpiryContractsToSetup.push(contract);
    } else if (isPenaltyRecord) {
      // Penalty month: rent = penalty amount (replaces alquiler for this month)
      // Services from the rescission month will be copied after bulk-create
      const penalty = contract.rescissionPenalty || 0;
      recordsToCreate.push({
        groupId,
        contractId: contract.id,
        monthNumber,
        periodMonth: month,
        periodYear: year,
        rentAmount: penalty,
        includeIva: false,
        ivaAmount: 0,
        servicesTotal: 0,
        previousBalance: 0,
        punitoryAmount: 0,
        punitoryDays: 0,
        totalDue: penalty,
        amountPaid: 0,
        balance: -penalty,
        comprobantesStatus: Array.isArray(contract.comprobantes)
          ? contract.comprobantes.map(c => ({ ...c, presented: false }))
          : [],
      });
      penaltyContractsToSetup.push(contract);
    } else {
      const rentAmount = getBatchedRentForMonth(contract.id, monthNumber, contract.baseRent);
      let previousBalance = 0;
      if (monthNumber - 1 >= 1) {
        const prevRecord = prevRecordsByContractId.get(contract.id);
        if (prevRecord && prevRecord.balance > 0) {
          previousBalance = prevRecord.balance;
        }
      } else if (monthNumber === 1 && contract.renewedFromContractId) {
        // C-06: mes 1 de un contrato renovado hereda el saldo a favor final del viejo
        // (simétrico con las deudas, que ya se encadenan vía expandToChain).
        previousBalance = oldContractFinalBalance.get(contract.renewedFromContractId) || 0;
      }
      const includeIva = !!contract.pagaIva;
      const ivaAmount = includeIva ? rentAmount * 0.21 : 0;
      const totalDue = rentAmount + ivaAmount - previousBalance;

      recordsToCreate.push({
        groupId,
        contractId: contract.id,
        monthNumber,
        periodMonth: month,
        periodYear: year,
        rentAmount,
        includeIva,
        ivaAmount,
        servicesTotal: 0,
        previousBalance,
        punitoryAmount: 0,
        punitoryDays: 0,
        // C-01: `totalDue` persistido queda clampeado (no se puede "deber negativo"),
        // pero `balance` NO se clampea — si `previousBalance` (crédito arrastrado) supera
        // el alquiler+IVA de este mes recién creado, el excedente debe sobrevivir como
        // balance positivo (arrastrado al mes siguiente), no destruirse en el instante de
        // crear el registro (mismo criterio que _recalculateCore).
        totalDue: Math.max(totalDue, 0),
        amountPaid: 0,
        balance: -totalDue,
        comprobantesStatus: Array.isArray(contract.comprobantes) 
          ? contract.comprobantes.map(c => ({ ...c, presented: false })) 
          : [],
      });
    }
  }

  console.log(`[monthlyRecords] existing=${existingRecords.length} toCreate=${recordsToCreate.length}`);

  if (recordsToCreate.length > 0) {
    // A-06/A-07/A-26 (AUDITORIA_FUNCIONAL_2026-07-10.md): este bloque ANTES
    // reparaba inline los monthNumber obsoletos que chocan con `createMany`,
    // borrando (`delete`) o renumerando registros por fuera de cualquier
    // repair oficial — con un criterio de "¿tiene plata?" más laxo
    // (`amountPaid > 0`) que `repairContractRecordMonthNumbers` (chequea
    // también `debt` y `transactions`), sin transacción, y disparado por un
    // simple GET (incluso para el rol VIEWER). Podía borrar un registro con
    // deuda o transacciones y `amountPaid === 0`, o tirar 500 si violaba el
    // `@@unique([contractId, monthNumber])`.
    //
    // Decisión del usuario (2026-07-12): el GET deja de reparar. El repair de
    // monthNumbers vive SOLO en `repairContractRecordMonthNumbers`
    // (contractsController.js, tras editar startDate/duration), que ya usa el
    // criterio correcto y corre en una transacción de dos fases. Si un
    // contrato quedó con monthNumbers obsoletos sin pasar por ese repair,
    // `createMany` con `skipDuplicates: true` simplemente omite ese registro en
    // particular (no crashea, no borra nada) — el mes en cuestión queda
    // ausente del Control Mensual hasta que se corra el repair explícito.
    try {
      // skipDuplicates handles race conditions (another request already created the record)
      await prisma.monthlyRecord.createMany({
        data: recordsToCreate,
        skipDuplicates: true,
      });
    } catch (createErr) {
      // If createMany fails, fall back to individual creates with P2002 handling
      console.error(`[monthlyRecords] createMany failed, falling back to individual creates:`, createErr.message);
      for (const data of recordsToCreate) {
        try {
          await prisma.monthlyRecord.create({ data });
        } catch (err) {
          if (err.code !== 'P2002') throw err;
        }
      }
    }

    // Fetch the newly created records with full includes
    const newContractIds = recordsToCreate.map(r => r.contractId);
    const newRecords = await prisma.monthlyRecord.findMany({
      where: {
        groupId,
        periodMonth: month,
        periodYear: year,
        contractId: { in: newContractIds },
      },
      include: {
        services: {
          include: {
            conceptType: { select: { id: true, name: true, label: true, category: true } },
          },
        },
        transactions: {
          include: { concepts: true },
          orderBy: { createdAt: 'asc' },
        },
        debt: {
          include: {
            payments: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    console.log(`[monthlyRecords] fetched ${newRecords.length} newly created records`);
    for (const r of newRecords) {
      recordsByContractId.set(r.contractId, r);
    }

    // Copy services from rescission month into newly created penalty records
    if (penaltyContractsToSetup.length > 0) {
      for (const contract of penaltyContractsToSetup) {
        const penaltyRecord = recordsByContractId.get(contract.id);
        if (!penaltyRecord) continue;
        const svcTotal = await copyRescissionMonthServices(contract, penaltyRecord.id);
        if (svcTotal !== 0) {
          const penalty = contract.rescissionPenalty || 0;
          const newTotalDue = round2(penalty + svcTotal);
          await prisma.monthlyRecord.update({
            where: { id: penaltyRecord.id },
            data: { servicesTotal: svcTotal, totalDue: newTotalDue, balance: -newTotalDue },
          });
        }
      }
      // Re-fetch penalty records so they include the copied services
      const penaltyContractIds = penaltyContractsToSetup.map(c => c.id);
      const updatedPenaltyRecords = await prisma.monthlyRecord.findMany({
        where: { groupId, periodMonth: month, periodYear: year, contractId: { in: penaltyContractIds } },
        include: {
          services: { include: { conceptType: { select: { id: true, name: true, label: true, category: true } } } },
          transactions: { include: { concepts: true }, orderBy: { createdAt: 'asc' } },
          debt: { include: { payments: { orderBy: { createdAt: 'asc' } } } },
        },
      });
      for (const r of updatedPenaltyRecords) {
        recordsByContractId.set(r.contractId, r);
      }
    }

    // Copy last-month services into newly created post-expiry records (mes vencido)
    if (postExpiryContractsToSetup.length > 0) {
      for (const contract of postExpiryContractsToSetup) {
        const postExpiryRecord = recordsByContractId.get(contract.id);
        if (!postExpiryRecord) continue;
        const svcTotal = await copyLastMonthServices(contract, postExpiryRecord.id);
        if (svcTotal !== 0) {
          const newTotalDue = round2(svcTotal);
          await prisma.monthlyRecord.update({
            where: { id: postExpiryRecord.id },
            data: { servicesTotal: svcTotal, totalDue: newTotalDue, balance: -newTotalDue },
          });
        }
      }
      // Re-fetch post-expiry records so they include the copied services
      const postExpiryContractIds = postExpiryContractsToSetup.map(c => c.id);
      const updatedPostExpiryRecords = await prisma.monthlyRecord.findMany({
        where: { groupId, periodMonth: month, periodYear: year, contractId: { in: postExpiryContractIds } },
        include: {
          services: { include: { conceptType: { select: { id: true, name: true, label: true, category: true } } } },
          transactions: { include: { concepts: true }, orderBy: { createdAt: 'asc' } },
          debt: { include: { payments: { orderBy: { createdAt: 'asc' } } } },
        },
      });
      for (const r of updatedPostExpiryRecords) {
        recordsByContractId.set(r.contractId, r);
      }
    }
  }

  // Batch: contratos con deudas abiertas (para marcar filas del mes actual)
  const contractIdsForDebt = activeContracts.map(({ contract }) => contract.id);
  const openDebtsForContracts = await prisma.debt.findMany({
    where: { contractId: { in: contractIdsForDebt }, status: { in: ['OPEN', 'PARTIAL'] } },
    select: { contractId: true },
  });
  const contractsWithOpenDebt = new Set(openDebtsForContracts.map(d => d.contractId));

  // --- BATCH 6: Preload all data needed for live debt/punitory calculations (Avoids N+1) ---
  const allDebts = [...recordsByContractId.values()].map(r => r.debt).filter(Boolean);
  const { preloadDebtDependencies } = require('./debtService');
  const debtPreloaded = allDebts.length > 0 
    ? await preloadDebtDependencies(allDebts) 
    : { contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() };
  
  // Inject current period data into the preloaded maps
  debtPreloaded.holidayMap.set(year, holidays);
  for (const r of recordsByContractId.values()) {
    debtPreloaded.monthlyRecordMap.set(r.id, r);
  }

  const updatesToPerform = [];
  const records = [];

  for (const { contract, monthNumber, isPenaltyRecord, isPostExpiry } of activeContracts) {
    let record = recordsByContractId.get(contract.id);

    if (!record) {
      console.error(`[monthlyRecords] MISSING record for contract ${contract.id} month=${monthNumber}`);
      continue; // Skip this contract instead of crashing
    }

    // A-06 (AUDITORIA_FUNCIONAL_2026-07-10.md): este refresh corre en cada GET
    // (pantalla mensual, dashboard, reportes), incluso para el rol VIEWER.
    // ANTES recalculaba y persistía rentAmount/IVA/status de meses YA
    // COMPLETE (solo el previousBalance se protegía) — un simple "refrescar la
    // pantalla" podía cambiar montos de un mes ya pagado y cerrado, sin ningún
    // usuario/acción trazable detrás. Decisión del usuario (2026-07-12):
    // enfoque quirúrgico — un mes que YA está COMPLETE al entrar acá queda
    // completamente congelado (ni rentAmount, ni IVA, ni totalDue/balance, ni
    // status se tocan). Un mes PENDING/PARTIAL sigue pudiendo recalcularse y
    // transicionar a COMPLETE normalmente (eso no es "mutar un mes cerrado":
    // es el recálculo en vivo de un mes todavía abierto).
    // Refresh rentAmount, IVA, previousBalance, totalDue, balance y status
    // SOLO para registros que no están COMPLETE.
    // For penalty records: convert from old format (rentAmount=0, servicesTotal=penalty) if needed
    if (record && isPenaltyRecord) {
      const penalty = contract.rescissionPenalty || 0;
      // Only convert records still in old format (rentAmount=0 means old format)
      if (Math.abs(record.rentAmount - penalty) > 0.01) {
        if (record.services.length > 0) {
          await prisma.monthlyService.deleteMany({ where: { monthlyRecordId: record.id } });
        }
        const svcTotal = await copyRescissionMonthServices(contract, record.id);
        const newTotalDue = round2(penalty + svcTotal);
        const newBalance = round2(record.amountPaid - newTotalDue);
        updatesToPerform.push({
          id: record.id,
          data: { rentAmount: penalty, servicesTotal: svcTotal, totalDue: newTotalDue, balance: newBalance },
        });
        const refreshed = await prisma.monthlyService.findMany({
          where: { monthlyRecordId: record.id },
          include: { conceptType: { select: { id: true, name: true, label: true, category: true } } },
        });
        Object.assign(record, { rentAmount: penalty, servicesTotal: svcTotal, services: refreshed, totalDue: newTotalDue, balance: newBalance });
      }
    } else if (record && !isPenaltyRecord && !isPostExpiry && contract.active && record.status !== 'COMPLETE') {
      // Renewed/inactive contracts have frozen historical records: do not
      // recalculate rent/IVA/balance from the current contract config — that
      // would clobber legitimate historical values.
      // Post-expiry records (alquiler $0, solo servicios) tampoco se recalculan:
      // recomputaríamos el alquiler desde el historial y romperíamos el $0.
      // A-06: un mes ya COMPLETE nunca entra a este bloque (ver guard arriba)
      // — queda completamente congelado, no solo el previousBalance.
      const currentRent = getBatchedRentForMonth(contract.id, monthNumber, contract.baseRent);
      const rentChanged = currentRent !== record.rentAmount;

      // Bug (2026-07-14): este bloque solía "sincronizar" includeIva desde
      // contract.pagaIva en cada GET (cualquier mismatch se trataba como
      // desactualizado), pero eso no distingue "cambié pagaIva en el contrato"
      // de "el usuario tildó/destildó el IVA a mano para este mes puntual" —
      // el toggle manual por período (checkbox de Control Mensual, endpoint
      // PATCH .../iva) quedaba pisado apenas se refrescaba la pantalla (el
      // siguiente GET, disparado automáticamente tras la mutación, lo revertía
      // en milisegundos). `record.includeIva` es la fuente de verdad para un
      // registro ya creado; el contrato solo define el default al GENERARLO
      // (más arriba, `const includeIva = !!contract.pagaIva`).
      const effectiveIva = record.includeIva;

      // Refresh previousBalance from batch (el mes ya no puede estar COMPLETE acá)
      let latestPrevBalance = record.previousBalance;
      let prevBalanceChanged = false;
      if (monthNumber - 1 >= 1) {
        const prevRecord = prevRecordsByContractId.get(contract.id);
        latestPrevBalance = (prevRecord && prevRecord.balance > 0) ? prevRecord.balance : 0;
        prevBalanceChanged = latestPrevBalance !== record.previousBalance;
      }

      if (rentChanged || prevBalanceChanged) {
        const effectiveRent = rentChanged ? currentRent : record.rentAmount;
        const recordIva = round2(effectiveIva ? effectiveRent * 0.21 : 0);
        // A-04: usar el punitorio VIVO (misma función que el display y _recalculateCore),
        // no el CONGELADO (record.punitoryAmount) — antes este refresh y el recálculo
        // asíncrono podían competir con dos totalDue distintos para el mismo mes,
        // según cuál hubiera corrido último (oscilación clase Brunello/Etica).
        //
        // Bug (2026-07-13, mismo caso que _recalculateCore, ver comentario ahí): este
        // refresh corre en CADA GET a Control Mensual (getOrCreateMonthlyRecords), así
        // que aunque `_recalculateCore` ya esté arreglado, este bloque hermano pisaba el
        // totalDue/balance correctos con el mismo saldo a favor falso en la próxima
        // carga de la pantalla. Cuando el mes tiene una Deuda abierta/parcial, el
        // punitorio tiene que salir del `accumulatedPunitory` congelado de la Deuda
        // (misma fuente que usa `debt.currentTotal`), no de `computeLiveRecordPunitory`
        // (que cae a $0 si el pago cubrió alquiler+servicios pero no todos los
        // punitorios, ya que ese registro nunca tuvo una transacción propia antes de
        // la deuda).
        const openDebtForRefresh = record.debt && record.debt.status !== 'PAID' ? record.debt : null;
        // `previousBalance: latestPrevBalance` (2026-07-30, caso Biassi): este bloque
        // ya usaba el saldo a favor FRESCO para `newTotalDue` pero le pasaba el viejo
        // al cálculo de punitorios, que ahora lo cuenta como plata cobrada. Sin esto,
        // el refresh volvería a introducir la mora fantasma en cada carga de pantalla.
        const recordForLivePunitory = {
          ...record,
          rentAmount: effectiveRent,
          includeIva: effectiveIva,
          previousBalance: latestPrevBalance,
        };
        let punitoryOutsideConcepts;
        if (openDebtForRefresh) {
          try {
            const livePun = await calculateDebtPunitory(openDebtForRefresh, getTodayLocalString(), debtPreloaded, true);
            punitoryOutsideConcepts = _punitoryOutsideConcepts(openDebtForRefresh, livePun);
          } catch (e) {
            console.error(`[monthlyRecords] punitorio en vivo de la deuda ${openDebtForRefresh.id} falló: ${e.message}`);
            punitoryOutsideConcepts = openDebtForRefresh.accumulatedPunitory || 0;
          }
        }
        // Punitorio BRUTO (cobrado + adeudado), el mismo helper que `_recalculateCore` y
        // el display: única escala comparable contra `amountPaid`. Ver el comentario largo
        // en `_recalculateCore`.
        const livePunitory = computeGrossRecordPunitory(
          recordForLivePunitory, contract, holidays, { punitoryOutsideConcepts }
        ).amount;
        const grossCharges = round2(effectiveRent + record.servicesTotal + livePunitory + recordIva);
        const newTotalDue = round2(grossCharges - latestPrevBalance);
        // C-01: el balance se computa con `newTotalDue` SIN clampear, igual que
        // `_recalculateCore`. Clampearlo acá (como antes) perdía el excedente del crédito
        // cuando éste superaba los cargos del mes, y las dos rutas que escriben el mismo
        // registro devolvían números distintos según cuál corriera última.
        const newBalance = round2(record.amountPaid - newTotalDue);
        const isForgivenRefresh = (record.balanceForgiven || 0) > 0;
        const effBalanceRefresh = round2(newBalance + (record.balanceForgiven || 0));
        const creditCoversCharges = latestPrevBalance > 0 && latestPrevBalance >= grossCharges - 1;

        const updateData = {
          previousBalance: latestPrevBalance,
          totalDue: Math.max(newTotalDue, 0),
          balance: newBalance,
        };
        if (rentChanged) {
          updateData.rentAmount = currentRent;
          // El % de IVA es sobre el alquiler: si el alquiler cambió, el monto de
          // IVA debe recalcularse — pero `includeIva` en sí NUNCA se toca acá
          // (ver comentario arriba, es la fuente de verdad del registro).
          updateData.ivaAmount = recordIva;
        }

        // Recalculate status based on new amounts. Un mes con Deuda abierta/parcial
        // nunca pasa a COMPLETE acá (mismo criterio que `computeTotals` en
        // `_recalculateCore`): lo representa la Deuda, que se cierra en `payDebt`.
        if (openDebtForRefresh) {
          updateData.isPaid = false;
          updateData.status = record.amountPaid > 0 ? 'PARTIAL' : 'PENDING';
          updateData.isCancelled = false;
          updateData.fullPaymentDate = null;
        } else if (effBalanceRefresh >= -1 && (record.amountPaid > 0 || isForgivenRefresh || creditCoversCharges)) {
          // Mismo árbol que `computeTotals` en `_recalculateCore`, con la MISMA tolerancia
          // ($1) y las mismas condiciones. Antes este bloque usaba $0,01 y no miraba
          // `balanceForgiven` ni el crédito arrastrado: para un mismo registro las dos
          // rutas podían decidir status distinto según cuál corriera última, y `closeMonth`
          // decide justamente por ese status.
          updateData.isPaid = true;
          updateData.status = 'COMPLETE';
          updateData.isCancelled = true;
          if (!record.fullPaymentDate) {
            updateData.fullPaymentDate = record.transactions?.[record.transactions.length - 1]?.paymentDate || new Date();
          }
        } else if (record.amountPaid > 0) {
          updateData.isPaid = false;
          updateData.status = 'PARTIAL';
          updateData.isCancelled = false;
          updateData.fullPaymentDate = null;
        } else {
          updateData.isPaid = false;
          updateData.status = 'PENDING';
          updateData.isCancelled = false;
          updateData.fullPaymentDate = null;
        }

        // Optimize: Don't perform a heavy include on every update inside a loop.
        // Queue data for batch chunked update to avoid sequential performance hit
        // and avoid saturating DB connection pool.
        updatesToPerform.push({
          id: record.id,
          data: updateData
        });
        
        // Update in-memory record so subsequent logic uses correct values
        Object.assign(record, updateData);
      }
    }

    // Calculate next adjustment info (recalcular si el valor de DB quedó en el pasado)
    let nextAdjustmentLabel = null;
    if (contract.nextAdjustmentMonth && contract.adjustmentIndex) {
      let effectiveNextAdj = contract.nextAdjustmentMonth;
      // Recalcular si quedó desfasado
      const start = new Date(contract.startDate);
      const now = new Date();
      const mDiff = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      const sm = contract.startMonth || 1;
      const realCurrentMonth = Math.max(sm, Math.min(sm + mDiff, sm + contract.durationMonths - 1));
      if (effectiveNextAdj < realCurrentMonth) {
        effectiveNextAdj = calculateNextAdjustmentMonth(
          contract.startMonth, realCurrentMonth, contract.adjustmentIndex.frequencyMonths, contract.durationMonths
        );
      }
      if (effectiveNextAdj) {
        const adjPeriod = getCalendarPeriod(contract, effectiveNextAdj);
        nextAdjustmentLabel = `${MONTH_NAMES[adjPeriod.periodMonth]} ${adjPeriod.periodYear}`;
      }
    }

    // Calcular datos de deuda en vivo si existe
    let debtInfo = null;

    if (record.debt && record.debt.status !== 'PAID') {
      // Optimize: skip individual debt updates and use preloaded data to avoid N+1 queries.
      // A-25: día ART correcto (string, TZ-inmune), no `new Date()` crudo del proceso.
      const { amount, days, remainingDebt, unpaidAccumulatedPunitory, startDate, endDate, newPunitoryAmount, grossPunitoryToDate } = await calculateDebtPunitory(record.debt, getTodayLocalString(), debtPreloaded, true);
      debtInfo = {
        ...record.debt,
        liveAccumulatedPunitory: amount,
        // Días TOTALES de mora (desde punitoryStartDate hasta hoy), no el tramo `days`
        // desde el último pago parcial — con varios pagos en tandas ese tramo puede dar
        // "2 días" cuando la deuda lleva 20 días de atraso real.
        livePunitoryDays: debtDelinquencyDays(record.debt, endDate || getTodayLocalDate()),
        liveCurrentTotal: remainingDebt + (unpaidAccumulatedPunitory || 0) + amount,
        remainingDebt,
        unpaidAccumulatedPunitory: unpaidAccumulatedPunitory || 0,
        newPunitoryAmount: newPunitoryAmount || 0,
        grossPunitoryToDate: grossPunitoryToDate || 0,
        punitoryFromDate: startDate,
        punitoryToDate: endDate,
      };
    } else if (record.debt) {
      debtInfo = {
        ...record.debt, liveCurrentTotal: 0, liveAccumulatedPunitory: 0,
        // Deuda saldada: días totales hasta que se saldó (lastPaymentDate/closedAt).
        livePunitoryDays: debtDelinquencyDays(record.debt),
        remainingDebt: 0, newPunitoryAmount: 0, punitoryFromDate: null, punitoryToDate: null,
      };
    }

    // FUENTE ÚNICA: punitorio BRUTO del período (cobrado + adeudado), el mismo helper que
    // usan `_recalculateCore` y el refresh de más arriba. Así la columna TOTAL de la
    // pantalla y el `totalDue` guardado en la base son el mismo número por construcción:
    // antes el display ya usaba el bruto (caso Ponce) pero la persistencia usaba el neto
    // impago, y era la persistencia la que viajaba como saldo a favor al mes siguiente.
    const punitoryOutsideConceptsForDisplay = record.debt
      ? _punitoryOutsideConcepts(
        record.debt,
        record.debt.status !== 'PAID'
          ? { unpaidAccumulatedPunitory: debtInfo?.unpaidAccumulatedPunitory, amount: debtInfo?.liveAccumulatedPunitory }
          : null
      )
      : undefined;
    const livePunResult = computeGrossRecordPunitory(record, contract, holidays, {
      punitoryOutsideConcepts: punitoryOutsideConceptsForDisplay,
      isPostExpiry,
      calculationDate: getTodayLocalString(),
    });
    let livePunitoryAmount = livePunResult.amount;
    let livePunitoryDays = livePunResult.days;
    // Split para el desglose "Acumulados / Actuales" de la pantalla: "Actuales" es el tramo
    // devengado en vivo, "Acumulados" es todo el resto (ya cobrado + congelado). Se
    // mantiene la propiedad `anteriores + actuales === bruto`.
    let punitoriosActuales = livePunResult.newPunitory;
    let punitoriosAnteriores = round2(livePunitoryAmount - punitoriosActuales);

    // Calculate IVA (21% of rent if includeIva is true)
    const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;

    // Live total = rent + services + live punitorios + IVA - a favor anterior.
    // Se muestra clampeado a 0 (no se puede "deber negativo")...
    const liveTotalDueRaw = record.rentAmount + record.servicesTotal + livePunitoryAmount + ivaAmount - record.previousBalance;
    const liveTotalDue = Math.max(liveTotalDueRaw, 0);
    // ...pero el balance se calcula SIN clampear, igual que el `balance` persistido (C-01).
    // Con el clamp, un mes cubierto de sobra por el crédito mostraba "A Favor Sig." = 0
    // mientras la base arrastraba el excedente al mes siguiente: la pantalla contradecía al
    // número que efectivamente viajaba.
    const liveBalance = Math.round((record.amountPaid - liveTotalDueRaw) * 100) / 100;

    // TOTALES HISTÓRICOS: incluyen punitorios de la deuda (pagados + impagos)
    let totalPunitoriosHistoricos = livePunitoryAmount; // Punitorios del record
    let totalAbonado = record.amountPaid; // Lo pagado al record (ya incluye pagos de deuda)
    let totalHistorico = liveTotalDue; // Total con punitorios del record + IVA

    if (debtInfo && record.debt) {
      // `livePunitoryAmount` ya viene BRUTO del helper (conceptos PUNITORIOS cobrados en el
      // record + impago en vivo de la Deuda), así que el total histórico es ese mismo
      // número — el mismo que `_recalculateCore` persiste en `totalDue`. Acá sólo se
      // reconstruye el split que muestra la pantalla.
      //
      // Antes esto usaba `grossPunitoryToDate` de la Deuda. Servía para el caso Ponce
      // (2026-07-13), donde `payDebt` ya había reescrito `accumulatedPunitory` con el bruto
      // a la fecha, pero NO para una deuda recién creada: ahí `accumulatedPunitory` es el
      // punitorio IMPAGO del record, así que ese "bruto" no incluye lo que el pago
      // pre-cierre ya había cubierto — y faltaba exactamente esa parte.
      if (record.debt.status === 'PAID') {
        // Deuda saldada: no queda tramo vivo, todo el bruto es "acumulado".
        punitoriosActuales = 0;
        punitoriosAnteriores = livePunitoryAmount;
      } else {
        punitoriosActuales = debtInfo.newPunitoryAmount || 0;
        punitoriosAnteriores = round2(livePunitoryAmount - punitoriosActuales);
      }
      totalPunitoriosHistoricos = livePunitoryAmount;

      // Días de mora para mostrar en el frontend
      livePunitoryDays = debtInfo.livePunitoryDays || 0;

      // Total ADEUDADO real = alquiler + servicios + IVA + punitorios totales - a favor anterior.
      // NO usar amountPaid: incluiría el sobrepago e inflaría el total ocultando el saldo a favor.
      totalHistorico = Math.max(
        Math.round((record.rentAmount + record.servicesTotal + ivaAmount + totalPunitoriosHistoricos - record.previousBalance) * 100) / 100,
        0
      );
    }

    records.push({
      ...record,
      debtInfo,
      ivaAmount,
      livePunitoryAmount,
      livePunitoryDays,
      liveTotalDue,
      liveBalance,
      // NUEVOS CAMPOS HISTÓRICOS
      totalPunitoriosHistoricos,  // Punitorios totales (record + deuda pagada + deuda impaga)
      punitoriosAnteriores,
      punitoriosActuales,
      totalAbonado,                // Total pagado (record + deuda)
      totalHistorico,              // Total real (alquiler + servicios + todos los punitorios)
      contractHasOpenDebt: contractsWithOpenDebt.has(contract.id),
      // Enriched data
      contractType: contract.contractType || 'INQUILINO',
      contract: {
        id: contract.id,
        contractType: contract.contractType || 'INQUILINO',
        startDate: contract.startDate,
        durationMonths: contract.durationMonths,
        currentMonth: contract.currentMonth,
        punitoryStartDay: contract.punitoryStartDay,
        punitoryGraceDay: contract.punitoryGraceDay,
        punitoryPercent: contract.punitoryPercent,
        nextAdjustmentMonth: contract.nextAdjustmentMonth,
        adjustmentIndex: contract.adjustmentIndex,
        pagaIva: contract.pagaIva,
      },
      tenant: contract.contractType === 'PROPIETARIO'
        ? null
        : (contract.tenant || null),
      tenants: contract.contractType === 'PROPIETARIO'
        ? []
        : (contract.contractTenants?.length > 0
          ? contract.contractTenants.map((ct) => ct.tenant)
          : contract.tenant ? [contract.tenant] : []),
      property: contract.property,
      owner: contract.property?.owner,
      periodLabel: `${MONTH_NAMES[month]} - Mes ${monthNumber - contract.startMonth + 1}`,
      nextAdjustmentLabel,
      // Ajuste de alquiler en este mes: comparar alquiler actual vs mes anterior
      ...(() => {
        if (monthNumber <= 1) return { tieneAjuste: false };
        const currentRent = record.rentAmount;
        const prevRent = getBatchedRentForMonth(contract.id, monthNumber - 1, contract.baseRent);
        if (currentRent === prevRent || prevRent === 0) return { tieneAjuste: false };
        const pct = ((currentRent - prevRent) / prevRent * 100).toFixed(1);
        return {
          tieneAjuste: true,
          ajustePorcentaje: parseFloat(pct),
          alquilerAnterior: prevRent,
        };
      })(),
      // Calculated fields for the view
      // IMPORTANTE: Cuando hay deuda, calcular balance sobre totales históricos
      aFavorNextMonth: (() => {
        let realBalance;
        if (debtInfo && record.debt) {
          // Si hay deuda (abierta o pagada), usar totales históricos
          realBalance = totalAbonado - totalHistorico;
        } else {
          // Sin deuda, usar balance del período actual
          realBalance = liveBalance;
        }
        return realBalance > 0 ? realBalance : 0;
      })(),
      debeNextMonth: (() => {
        let realBalance;
        if (debtInfo && record.debt) {
          // Si hay deuda (abierta o pagada), usar totales históricos
          realBalance = totalAbonado - totalHistorico;
        } else {
          // Sin deuda, usar balance del período actual
          realBalance = liveBalance;
        }
        return realBalance < 0 ? Math.abs(realBalance) : 0;
      })(),
      // Recalcular isCancelled y status en vivo para corregir redondeo de IVA
      ...(() => {
        if (debtInfo && debtInfo.status !== 'PAID') return {};
        let realBalance;
        if (debtInfo && record.debt) {
          realBalance = totalAbonado - totalHistorico;
        } else {
          realBalance = liveBalance;
        }
        const liveComplete = record.amountPaid > 0 && realBalance >= -1;
        if (liveComplete) {
          return { isCancelled: true, isPaid: true, status: 'COMPLETE' };
        }
        return {};
      })(),
      isPenaltyRecord: !!isPenaltyRecord,
      isPostExpiry: !!isPostExpiry,
    });
  }

  // Perform non-nested updates in small chunks to avoid pool exhaustion
  if (updatesToPerform.length > 0) {
    const CHUNK_SIZE = 5;
    for (let i = 0; i < updatesToPerform.length; i += CHUNK_SIZE) {
      const chunk = updatesToPerform.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(update => 
        prisma.monthlyRecord.update({
          where: { id: update.id },
          data: update.data
        })
      ));
    }
  }

  return records;
};

/**
 * Recalculate a MonthlyRecord's totals after services or payment changes
 */
const recalculateMonthlyRecord = async (monthlyRecordId) => {
  // Leverage the gap-free downstream batch calculation to guarantee rolling balance consistency
  await recalculateMultipleRecords([monthlyRecordId]);

  // Return the fully updated record with expected payload footprint for legacy compatibility
  return prisma.monthlyRecord.findUnique({
    where: { id: monthlyRecordId },
    include: {
      services: {
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
};

/**
 * Helper to safely compare floats to 2 decimal places
 */
const _floatsDiffer = (a, b) => Math.abs((a || 0) - (b || 0)) >= 0.01;

/**
 * Parte del punitorio del período que NO figura en los conceptos PUNITORIOS del record,
 * cuando el mes tiene una Deuda asociada. Es el segundo término de
 * `computeGrossRecordPunitory` (utils/punitory.js) y se compone de:
 *
 *  - el punitorio IMPAGO en vivo de la Deuda (`unpaidAccumulatedPunitory + amount`, que es
 *    el impago en las dos ramas de `calculateDebtPunitory`), y
 *  - el punitorio que quedó cubierto por el SALDO A FAVOR. `payDebt` imputa el
 *    `appliedCredit` antes que el efectivo y sólo el efectivo genera concepto PUNITORIOS,
 *    así que esa porción no está en los conceptos; `calculateDebtPunitory` sí la descuenta
 *    del impago (vía `paidToPunitory`, que suma efectivo + crédito). Sin sumarla acá el
 *    crédito se restaría dos veces —una en `previousBalance` y otra en el punitorio— y
 *    volvería a aparecer un saldo a favor fantasma.
 *
 * @param {object} debt     Fila de Debt (unpaidRentAmount, unpaidServicesAmount, appliedCredit, accumulatedPunitory)
 * @param {object|null} livePun Resultado de `calculateDebtPunitory` (null si la deuda está PAID)
 */
const _punitoryOutsideConcepts = (debt, livePun) => {
  const base = round2((debt.unpaidRentAmount || 0) + (debt.unpaidServicesAmount || 0));
  const creditOnPunitory = round2(Math.min(
    Math.max((debt.appliedCredit || 0) - base, 0),
    debt.accumulatedPunitory || 0
  ));
  const liveUnpaid = livePun
    ? round2((livePun.unpaidAccumulatedPunitory || 0) + (livePun.amount || 0))
    : 0;
  return round2(liveUnpaid + creditOnPunitory);
};

/**
 * Core cascading recalculation logic (must run inside a valid transaction)
 */
const _recalculateCore = async (recordIds, tx) => {
  if (!recordIds || (Array.isArray(recordIds) && recordIds.length === 0)) return 0;
  
  const ids = Array.from(new Set(recordIds));
  
  // 1. Find the earliest affected monthNumber per contract to ensure downstream continuity
  const initialRecords = await tx.monthlyRecord.findMany({
    where: { id: { in: ids } },
    select: { contractId: true, monthNumber: true, periodYear: true } 
  });

  const minMonthsByContract = new Map();
  for (const r of initialRecords) {
    if (!minMonthsByContract.has(r.contractId) || r.monthNumber < minMonthsByContract.get(r.contractId).monthNumber) {
      minMonthsByContract.set(r.contractId, { monthNumber: r.monthNumber, periodYear: r.periodYear });
    }
  }

  // A-16 (AUDITORIA_FUNCIONAL_2026-07-10.md): antes se acotaba con
  // `periodYear: data.periodYear`, cortando la cascada en el 31/12 — una
  // corrección de diciembre nunca propagaba a enero del año siguiente (un
  // sobrepago de diciembre podía dejar un crédito fantasma en enero para
  // siempre). `monthNumber` es el contador continuo del contrato (1..N, NO se
  // reinicia cada año calendario), así que `monthNumber: { gte }` por sí solo
  // ya cruza el límite de año correctamente sin necesidad de fijar el año.
  const orConditions = Array.from(minMonthsByContract.entries()).map(([contractId, data]) => ({
    contractId,
    monthNumber: { gte: data.monthNumber },
  }));

  if (orConditions.length === 0) return 0;

  // DB-BASED DISTRIBUTED LOCKING: Apply Postgres Advisory Transaction Locks
  // Protects identically against race conditions across multiple server instances (horizontally scaled)
  const sortedContractIds = Array.from(minMonthsByContract.keys()).sort();
  for (const contractId of sortedContractIds) {
    // hashtext is natively available in postgres to convert uuid to a lockable 32-bit int
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${contractId}'))`);
  }

  // 2. Pre-fetch records with services and transactions, sorted chronologically for rolling balances
  // This guarantees we process every month after the earliest modification point sequentially.
  const records = await tx.monthlyRecord.findMany({
    where: { OR: orConditions },
    include: {
      services: { include: { conceptType: { select: { category: true } } } },
      // Ordenadas por fecha para que "la última transacción" (punitorio congelado del
      // último pago) sea determinista. `concepts` se usa para sumar los punitorios
      // efectivamente imputados a lo largo de TODAS las transacciones del mes.
      transactions: {
        orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
        include: { concepts: { select: { type: true, amount: true } } },
      },
      // Necesario para computeLivePunitoryAmount (C-02): base de punitorios en vivo.
      contract: { select: { punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true } },
    },
    orderBy: [
      { contractId: 'asc' },
      { monthNumber: 'asc' }
    ]
  });

  // Feriados por año, precargados una sola vez (evita N+1 en computeLivePunitoryAmount).
  const distinctYears = Array.from(new Set(records.map((r) => r.periodYear)));
  const holidaysByYear = new Map();
  for (const y of distinctYears) {
    holidaysByYear.set(y, await getHolidaysForYear(y));
  }

  let numUpdated = 0;
  let currentContractId = null;
  let expectedNextMonthNumber = null;
  let runningPreviousBalance = null;

  for (const record of records) {
    let servicesTotal = 0;
    for (const s of record.services) {
      if (s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION') {
        servicesTotal -= Math.abs(s.amount);
      } else {
        servicesTotal += s.amount;
      }
    }

    const amountPaid = record.transactions.reduce((sum, t) => sum + t.amount, 0);

    // `punitoryAmount` PERSISTIDO: sigue siendo el punitorio congelado del ÚLTIMO pago.
    // Otros consumidores (creación de deuda, arrastre de unpaidFrozenPunitory, recibos)
    // dependen de esta semántica "frozen del último pago"; no se debe cambiar.
    let punitoryAmount = record.punitoryAmount;
    let punitoryDays = record.punitoryDays;
    let punitoryForgiven = false;
    if (record.transactions.length > 0) {
      const lastTx = record.transactions[record.transactions.length - 1];
      punitoryAmount = lastTx.punitoryForgiven ? 0 : lastTx.punitoryAmount;
      punitoryDays = lastTx.punitoryForgiven ? 0 : record.punitoryDays;
      punitoryForgiven = lastTx.punitoryForgiven;
    } else {
      punitoryAmount = 0;
      punitoryDays = 0;
    }

    // Determine the active previous balance
    const isNewContract = currentContractId !== record.contractId;
    const isGap = !isNewContract && record.monthNumber !== expectedNextMonthNumber;

    if (isGap) {
      console.warn(`[Integridad] Secuencia rota para el contrato ${record.contractId}: salto del mes esperado ${expectedNextMonthNumber} al ${record.monthNumber}. Continuando con saldo previo.`);
    }

    const activePreviousBalance = isNewContract
      ? record.previousBalance
      : runningPreviousBalance;

    const ivaAmount = record.includeIva ? record.rentAmount * 0.21 : 0;

    // Simple check for open debt (una sola vez; se reutiliza en las dos pasadas de abajo)
    const openDebt = await tx.debt.findFirst({
      where: { monthlyRecordId: record.id, status: { in: ['OPEN', 'PARTIAL'] } },
    });

    // Sincronizar el saldo a favor (appliedCredit) de la deuda con el previousBalance
    // EN VIVO de este mes (bug reportado 2026-07-12: Control Mensual y Deudas mostraban
    // números distintos porque appliedCredit quedaba congelado desde el cierre). Ver
    // `syncDebtAppliedCreditFromRecord` (debtService.js) para el detalle y las guardas.
    if (openDebt) {
      const { syncDebtAppliedCreditFromRecord } = require('./debtService');
      await syncDebtAppliedCreditFromRecord(openDebt.id, activePreviousBalance, tx);
    }
    // Un saldo condonado (balanceForgiven) salda el registro aunque no haya pago real:
    // permite "perdonar multa"/condonar el total de un registro nunca pagado (status COMPLETE).
    const isForgiven = (record.balanceForgiven || 0) > 0;

    const computeTotals = (punitoryForTotalDue) => {
      const grossCharges = record.rentAmount + servicesTotal + punitoryForTotalDue + ivaAmount;
      // Un mes cuyos cargos quedaron cubiertos ENTEROS por el saldo a favor arrastrado
      // está saldado, aunque no haya entrado un peso nuevo (`amountPaid === 0`). Antes
      // exigía `amountPaid > 0 || isForgiven` y esos meses quedaban PENDING para siempre:
      // se mostraban como impagos y `closeMonth` los volvía a levantar todos los meses.
      const creditCoversCharges = activePreviousBalance > 0 && activePreviousBalance >= grossCharges - 1;
      const td = grossCharges - activePreviousBalance;
      // C-01: el balance se computa con `td` SIN clampear. Si el crédito arrastrado
      // (activePreviousBalance) supera los cargos brutos del mes, `td` da negativo — y
      // restarlo (sin clamp) es lo que hace sobrevivir el excedente como balance
      // positivo, para que se arrastre al mes siguiente (runningPreviousBalance más
      // abajo). Clampear acá (como antes) perdía ese excedente sin dejar rastro. El
      // campo PERSISTIDO `totalDue` sigue clampeado a 0 al escribir (no se puede
      // "deber negativo") — eso no cambia.
      const bal = Math.round((amountPaid - td) * 100) / 100;
      const effBal = bal + (record.balanceForgiven || 0);
      let st = 'PENDING';
      if (openDebt) {
        st = (amountPaid > 0) ? 'PARTIAL' : 'PENDING';
      } else if (effBal >= -1 && (amountPaid > 0 || isForgiven || creditCoversCharges)) {
        st = 'COMPLETE';
      } else if (amountPaid > 0) {
        st = 'PARTIAL';
      }
      return { totalDue: td, balance: bal, effectiveBalance: effBal, status: st };
    };

    // El punitorio que entra en `totalDue` es el BRUTO del período: lo ya COBRADO más lo
    // que sigue ADEUDADO (`computeGrossRecordPunitory`, utils/punitory.js). Es la única
    // escala comparable contra `amountPaid`, que es toda la plata que entró — incluida la
    // imputada al concepto PUNITORIOS.
    //
    // Antes había dos pasadas: la primera con el punitorio ADEUDADO y, si eso ya daba
    // COMPLETE, una segunda con `sumPunitoryConcepts` (lo cobrado). Ese parche tapaba el
    // problema sólo cuando el mes cerraba justo, y estaba explícitamente APAGADO cuando
    // había una Deuda abierta — que es justo cuando importa. Con `totalDue` en escala
    // neta y `amountPaid` en escala bruta, los punitorios ya cobrados contaban dos veces
    // a favor del inquilino (`balance = 2 × cobrado − total + crédito`):
    //   - Bastaba pagar más de la MITAD de la mora para que cerrar el mes generara un
    //     saldo a favor fantasma y, al mismo tiempo, una Deuda por el resto (reproducido
    //     2026-08-26: el balance saltaba de −153,50 a +100 sólo por cerrar).
    //   - Y al revés: si lo cobrado superaba lo adeudado, la primera pasada daba COMPLETE
    //     y la mora impaga se auto-condonaba en silencio (el mes quedaba "CANCELÓ SÍ"
    //     debiendo punitorios, y `closeMonth` ni lo miraba).
    //
    // La capa de display ya usaba el bruto desde el caso Ponce (2026-07-13, ver
    // `totalPunitoriosHistoricos` más abajo) con este mismo razonamiento; el arreglo nunca
    // había llegado a las dos rutas que PERSISTEN `totalDue`/`balance` — ésta y el refresh
    // de `getOrCreateMonthlyRecords`. Ahora las tres consumen el mismo helper.
    const holidaysForRecord = holidaysByYear.get(record.periodYear) || [];

    // Bug (2026-07-30, caso Biassi Gonzalo Amir, julio 2026): este loop recomputa
    // `servicesTotal`, `amountPaid` y el `previousBalance` en cadena y los escribe
    // más abajo, pero antes le pasaba a `computeLiveRecordPunitory` el `record`
    // CRUDO de la DB — y esa función lee `record.amountPaid`/`record.servicesTotal`/
    // `record.previousBalance` directamente. O sea: el registro se guardaba con un
    // `totalDue` calculado contra un estado que ya no existía.
    //
    // No es teórico, los dos callers principales llegan acá desincronizados a
    // propósito: `registerPaymentCore` crea la PaymentTransaction y recalcula ANTES
    // de persistir `amountPaid` (sólo escribe los campos de punitorios), y
    // `updateService` escribe la fila de monthly_services y recién después
    // recalcula. En Biassi, tras borrar y volver a cargar el pago, `amountPaid`
    // valía 0 con la transacción ya creada → la base de punitorios tomó la rama
    // "sin ningún pago" (alquiler completo) y devengó $648.823 × 0,6% × 23 días =
    // $89.537,57 de mora inventada sobre un mes que cancelaba justo.
    const recordForLivePunitory = {
      ...record,
      servicesTotal,                          // recomputado desde services[] arriba
      amountPaid,                             // recomputado desde transactions[] arriba
      previousBalance: activePreviousBalance, // el rolling, no el persistido
    };

    // Con Deuda asociada, el punitorio IMPAGO lo define la Deuda (fuente única, la misma
    // que alimenta su `currentTotal` y el badge DEUDA del Control Mensual). Se usa el
    // impago EN VIVO (`unpaidAccumulatedPunitory + amount`, que es el impago en las dos
    // ramas de `calculateDebtPunitory`) y NO `accumulatedPunitory` crudo: en una deuda
    // recién creada ese campo es el impago del record, pero después de `payDebt` pasa a
    // ser el bruto a la fecha — semánticas distintas que no se pueden sumar a mano sin
    // duplicar los punitorios cobrados vía deuda.
    let punitoryOutsideConcepts;
    if (openDebt) {
      try {
        const livePun = await calculateDebtPunitory(openDebt, getTodayLocalString(), null, /* skipUpdate */ true);
        punitoryOutsideConcepts = _punitoryOutsideConcepts(openDebt, livePun);
      } catch (e) {
        // Sin el cálculo en vivo, el congelado de la Deuda es la mejor aproximación al
        // impago (es lo que usaba esta función antes del fix).
        console.error(`[recalc] punitorio en vivo de la deuda ${openDebt.id} falló: ${e.message}`);
        punitoryOutsideConcepts = openDebt.accumulatedPunitory || 0;
      }
    }
    const totalPunitory = computeGrossRecordPunitory(
      recordForLivePunitory,
      record.contract,
      holidaysForRecord,
      { punitoryOutsideConcepts }
    ).amount;
    const totals = computeTotals(totalPunitory);
    const { totalDue, balance, effectiveBalance, status } = totals;

    // Update tracking variables for the next iteration.
    // IMPORTANTE: solo se arrastra el saldo A FAVOR (positivo). El saldo negativo
    // (deuda) se gestiona con entidades Debt en el cierre mensual; arrastrarlo acá
    // duplicaría la deuda en el totalDue del mes siguiente (y los caminos de
    // creación/refresh de getOrCreateMonthlyRecords ya clampean a >= 0).
    currentContractId = record.contractId;
    expectedNextMonthNumber = record.monthNumber + 1;
    runningPreviousBalance = Math.max(effectiveBalance, 0);

    const isPaid = status === 'COMPLETE';
    const fullPaymentDate = isPaid && !record.fullPaymentDate ? new Date() : (isPaid ? record.fullPaymentDate : null);

    // Early break calculation: Don't write to DB if absolutely nothing financially changed
    // Safe float precision matching
    const shouldUpdate = 
      _floatsDiffer(record.servicesTotal, servicesTotal) ||
      _floatsDiffer(record.punitoryAmount, punitoryAmount) ||
      record.punitoryDays !== punitoryDays ||
      record.punitoryForgiven !== punitoryForgiven ||
      _floatsDiffer(record.previousBalance, activePreviousBalance) ||
      _floatsDiffer(record.totalDue, Math.max(totalDue, 0)) ||
      _floatsDiffer(record.amountPaid, amountPaid) ||
      _floatsDiffer(record.balance, balance) ||
      record.status !== status ||
      record.isPaid !== isPaid ||
      record.isCancelled !== isPaid;

    if (shouldUpdate || ids.includes(record.id) || record.needsRecalculation) {
      await tx.monthlyRecord.update({
        where: { id: record.id },
        data: {
          servicesTotal,
          punitoryAmount,
          punitoryDays,
          punitoryForgiven,
          previousBalance: activePreviousBalance,
          totalDue: Math.max(totalDue, 0),
          amountPaid,
          balance,
          status,
          isPaid,
          isCancelled: isPaid,
          fullPaymentDate,
          // Bug (2026-07-14): _recalculateCore corre tanto por el camino INLINE
          // (pagos, síncrono) como por processDirtyRecords (async) — pero antes
          // solo processDirtyRecords limpiaba needsRecalculation (con su propio
          // updateMany posterior). Un recálculo inline dejaba el registro
          // correctamente actualizado pero TODAVÍA marcado sucio, y el frontend
          // (useMonthlyRecords.js) sondea en bucle mientras algún registro cargado
          // tenga needsRecalculation=true — parecía "tardar" sin motivo real.
          needsRecalculation: false,
        }
      });
      numUpdated++;
    }
  }
  return numUpdated;
};

let isProcessingDirtyRecords = false;

const processDirtyRecords = async () => {
  if (isProcessingDirtyRecords) return;
  isProcessingDirtyRecords = true;

  try {
    let hasMore = true;
    while (hasMore) {
      // Find the first contract with dirty records
      const dirtyRecord = await prisma.monthlyRecord.findFirst({
        where: { needsRecalculation: true },
        select: { contractId: true },
      });

      if (!dirtyRecord) {
        hasMore = false;
        break;
      }

      await prisma.$transaction(async (tx) => {
        // Use the same hashtext() key as _recalculateCore so both paths serialize on the same lock
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${dirtyRecord.contractId}'))`);

        const dirtyRecords = await tx.monthlyRecord.findMany({
          where: { contractId: dirtyRecord.contractId, needsRecalculation: true },
          select: { id: true },
          orderBy: { monthNumber: 'asc' }
        });

        if (dirtyRecords.length > 0) {
          const ids = dirtyRecords.map(r => r.id);
          
          await _recalculateCore(ids, tx);

          await tx.monthlyRecord.updateMany({
            where: { contractId: dirtyRecord.contractId, needsRecalculation: true },
            data: { needsRecalculation: false }
          });
        }
      }, { timeout: 30000 });
    }
  } catch (error) {
    console.error('[AsyncRecalculation] Error processing dirty records:', error);
  } finally {
    isProcessingDirtyRecords = false;
  }
};

const _markRecordsDirty = async (recordIds, txClient) => {
  const records = await txClient.monthlyRecord.findMany({
    where: { id: { in: recordIds } },
    select: { contractId: true, monthNumber: true }
  });

  if (records.length === 0) return;

  // A-16: igual que en `_recalculateCore`, se usa `monthNumber` (contador
  // continuo del contrato) en vez de `periodYear`+`periodMonth` — antes esto
  // solo marcaba dirty los meses del MISMO año calendario (`periodMonth: {gte}`
  // combinado con `periodYear` fijo), así que una corrección de diciembre
  // nunca disparaba el recálculo async de enero del año siguiente.
  const minMonthsByContract = new Map();
  for (const r of records) {
    if (!minMonthsByContract.has(r.contractId) || r.monthNumber < minMonthsByContract.get(r.contractId).monthNumber) {
      minMonthsByContract.set(r.contractId, { monthNumber: r.monthNumber });
    }
  }

  const orConditions = Array.from(minMonthsByContract.entries()).map(([contractId, data]) => ({
    contractId,
    monthNumber: { gte: data.monthNumber },
  }));

  if (orConditions.length > 0) {
    await txClient.monthlyRecord.updateMany({
      where: { OR: orConditions },
      data: { needsRecalculation: true }
    });
  }
};

/**
 * Recalculate multiple MonthlyRecords' totals.
 * Defaults to async dirty marking. Pass inline=true to force sync recalculation.
 */
const recalculateMultipleRecords = async (recordIds, tx = null, inline = false) => {
  if (!recordIds || recordIds.length === 0) return 0;

  if (inline) {
    if (tx) return _recalculateCore(recordIds, tx);
    return prisma.$transaction((t) => _recalculateCore(recordIds, t), { timeout: 30000 });
  }

  if (tx) {
    await _markRecordsDirty(recordIds, tx);
    setImmediate(processDirtyRecords);
    return 0;
  } else {
    await prisma.$transaction(async (t) => {
      await _markRecordsDirty(recordIds, t);
    });
    setImmediate(processDirtyRecords);
    return 0;
  }
};

/**
 * Get a single monthly record by ID with full relations
 */
const getMonthlyRecordById = async (groupId, id) => {
  const record = await prisma.monthlyRecord.findUnique({
    where: { id },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } },
          contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true, email: true, phone: true } } }, orderBy: { isPrimary: 'desc' } },
          property: {
            select: {
              id: true,
              address: true,
              category: { select: { id: true, name: true, color: true } },
              owner: { select: { id: true, name: true } },
            },
          },
          adjustmentIndex: true,
        },
      },
      services: {
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      },
      transactions: {
        include: { concepts: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!record || record.groupId !== groupId) return null;
  return record;
};

module.exports = {
  getOrCreateMonthlyRecords,
  recalculateMonthlyRecord,
  recalculateMultipleRecords,
  processDirtyRecords,
  getMonthlyRecordById,
  getCalendarPeriod,
  getMonthNumber,
  calculateRentForMonth,
  isContractInRangeForMonth,
  canCreateRecordForContract,
  repairContractRecordMonthNumbers,
};
