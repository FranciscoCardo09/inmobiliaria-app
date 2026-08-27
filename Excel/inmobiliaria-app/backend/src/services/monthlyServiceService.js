// Monthly Service Service - Manage services/extras for monthly records
const { recalculateMultipleRecords } = require('./monthlyRecordService');

const prisma = require('../lib/prisma');

// Campos de la deuda que una mutación de servicios puede mover. Se comparan antes/después
// del sync para saber si hace falta la segunda pasada de recálculo (ver settleRecordsWithDebt).
// El `select` que los trae vive en `debtService.getDebtSyncSnapshot`.
const DEBT_SETTLE_KEYS = ['unpaidRentAmount', 'unpaidServicesAmount', 'currentTotal', 'status'];

/**
 * Liquidar los registros afectados por una mutación de servicios: dejar el mes con sus
 * totales frescos, propagar el cambio a la deuda del mes (si la tiene) y —sólo si la deuda
 * cambió— recalcular una segunda vez.
 *
 * Por qué las tres pasadas y en ESE orden (bug reportado 2026-08-27, caso Ciuro):
 *
 *  1. `syncDebtServicesFromRecord` lee `punitoryAmount` y `previousBalance` del
 *     MonthlyRecord, columnas que sólo escribe `_recalculateCore`. Si se sincroniza la deuda
 *     antes de recalcular, se la alimenta con valores viejos.
 *  2. El recálculo tiene que ser INLINE. El modo por defecto sólo marca
 *     `needsRecalculation` y agenda `processDirtyRecords` con `setImmediate`, así que el
 *     endpoint respondía 200/201 con `servicesTotal`/`totalDue`/`balance` todavía viejos y el
 *     modal de pago —que arma el total con esas columnas— mostraba el número anterior.
 *     Ojo: `await processDirtyRecords()` NO alcanza como mitigación, porque tiene un guard
 *     global `isProcessingDirtyRecords` y si el worker ya está corriendo retorna sin hacer
 *     nada. Los caminos de dinero (`paymentTransactionService`, `debtService`) ya usan inline
 *     por este mismo motivo.
 *  3. El `totalDue` y el `status` de un mes CERRADO son función de su fila `Debt`:
 *     `_recalculateCore` la lee para decidir el status y para derivar el punitorio del mes
 *     vía `calculateDebtPunitory`. Si el sync la movió, el mes quedó calculado contra la
 *     deuda vieja y necesita una segunda pasada. Condicional, así que un mes abierto (sin
 *     deuda) sigue costando un solo recálculo.
 *
 * Los recálculos que los caminos masivos hacen DENTRO de su transacción se dejan como
 * están: marcan `needsRecalculation` y quedan como red de seguridad si el proceso muere
 * entre el commit y esta liquidación (el barrido de arranque los levanta).
 */
const settleRecordsWithDebt = async (recordIds) => {
  const ids = [...new Set(recordIds || [])].filter(Boolean);
  if (ids.length === 0) return;

  await recalculateMultipleRecords(ids, null, true);

  const { getDebtSyncSnapshot, syncDebtServicesFromRecord } = require('./debtService');
  const needSecondPass = [];
  for (const id of ids) {
    const before = await getDebtSyncSnapshot(id);
    if (!before) continue; // mes sin deuda: nada que propagar, una sola pasada
    const after = await syncDebtServicesFromRecord(id);
    if (!after || DEBT_SETTLE_KEYS.some((k) => before[k] !== after[k])) needSecondPass.push(id);
  }

  if (needSecondPass.length > 0) await recalculateMultipleRecords(needSecondPass, null, true);
};

/**
 * Add a service to a monthly record
 */
const addService = async (monthlyRecordId, conceptTypeId, amount, description = null) => {
  const service = await prisma.monthlyService.create({
    data: {
      monthlyRecordId,
      conceptTypeId,
      amount,
      description,
    },
    include: {
      conceptType: { select: { id: true, name: true, label: true, category: true } },
    },
  });

  await settleRecordsWithDebt([monthlyRecordId]);
  return service;
};

/**
 * Update a service amount
 */
const updateService = async (monthlyServiceId, amount, description) => {
  const service = await prisma.monthlyService.update({
    where: { id: monthlyServiceId },
    data: {
      amount,
      ...(description !== undefined && { description }),
    },
    include: {
      conceptType: { select: { id: true, name: true, label: true, category: true } },
    },
  });

  await settleRecordsWithDebt([service.monthlyRecordId]);
  return service;
};

/**
 * Remove a service from a monthly record
 */
const removeService = async (monthlyServiceId) => {
  const service = await prisma.monthlyService.findUnique({
    where: { id: monthlyServiceId },
  });

  if (!service) return null;

  await prisma.monthlyService.delete({ where: { id: monthlyServiceId } });
  await settleRecordsWithDebt([service.monthlyRecordId]);
  return service;
};

/**
 * Get services for a monthly record
 */
const getServicesForRecord = async (monthlyRecordId) => {
  return prisma.monthlyService.findMany({
    where: { monthlyRecordId },
    include: {
      conceptType: { select: { id: true, name: true, label: true, category: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Resolver (o crear) el MonthlyRecord de un contrato para un mes/año, respetando
 * el rango del contrato (mismo criterio que bulkAssign). Devuelve null si el mes
 * cae fuera del rango o el contrato está inactivo.
 */
const findOrCreateRecord = async (client, groupId, contractId, month, year) => {
  let record = await client.monthlyRecord.findUnique({
    where: {
      contractId_periodMonth_periodYear: {
        contractId,
        periodMonth: parseInt(month),
        periodYear: parseInt(year),
      },
    },
  });
  if (record) return record;

  const contract = await client.contract.findUnique({ where: { id: contractId } });
  if (!contract || !contract.active) return null;

  const startDate = new Date(contract.startDate);
  const totalMonthsDiff = (parseInt(year) - startDate.getFullYear()) * 12 + (parseInt(month) - (startDate.getMonth() + 1));
  const monthNumber = contract.startMonth + totalMonthsDiff;

  if (monthNumber < contract.startMonth) return null;
  const endMonth = contract.startMonth + contract.durationMonths - 1;
  if (monthNumber > endMonth) return null;
  if (contract.rescindedAt) {
    const rescDate = new Date(contract.rescindedAt);
    const rescMonthNumber = contract.startMonth + ((rescDate.getFullYear() - startDate.getFullYear()) * 12) + (rescDate.getMonth() + 1 - (startDate.getMonth() + 1));
    if (monthNumber > rescMonthNumber) return null;
  }

  return client.monthlyRecord.create({
    data: {
      groupId,
      contractId,
      monthNumber,
      periodMonth: parseInt(month),
      periodYear: parseInt(year),
      rentAmount: contract.baseRent,
      totalDue: contract.baseRent,
      balance: -contract.baseRent,
      comprobantesStatus: Array.isArray(contract.comprobantes)
        ? contract.comprobantes.map((c) => ({ ...c, presented: false }))
        : [],
    },
  });
};

/**
 * Asignar un servicio "en cuotas" a un contrato: crea N meses consecutivos a partir
 * de (startMonth/startYear), numerados cuotaNumber 1..N y cuotaTotal N. El monto total
 * se reparte parejo (la última cuota absorbe el redondeo); cada cuota queda editable
 * por mes con updateService (preserva los campos de cuota).
 */
const assignInstallmentService = async (groupId, contractId, conceptTypeId, totalCuotas, startMonth, startYear, montoTotal, description = null) => {
  const concept = await prisma.conceptType.findFirst({
    where: { id: conceptTypeId, groupId, isActive: true },
  });
  if (!concept) throw new Error('Tipo de concepto no encontrado o inactivo');

  const N = parseInt(totalCuotas);
  if (!(N >= 1)) throw new Error('Cantidad de cuotas inválida');
  const total = parseFloat(montoTotal);
  if (!(total >= 0)) throw new Error('Monto inválido');

  const per = round2(total / N);
  const plan = [];
  let m = parseInt(startMonth);
  let y = parseInt(startYear);
  for (let k = 1; k <= N; k++) {
    const amount = k === N ? round2(total - per * (N - 1)) : per;
    plan.push({ month: m, year: y, cuotaNumber: k, cuotaTotal: N, amount });
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const { results, affectedIds } = await prisma.$transaction(async (tx) => {
    const out = [];
    const affected = new Set();
    for (const it of plan) {
      const record = await findOrCreateRecord(tx, groupId, contractId, it.month, it.year);
      if (!record) continue; // fuera del rango del contrato
      const svc = await tx.monthlyService.upsert({
        where: {
          monthlyRecordId_conceptTypeId: { monthlyRecordId: record.id, conceptTypeId },
        },
        update: { amount: it.amount, description, cuotaNumber: it.cuotaNumber, cuotaTotal: it.cuotaTotal },
        create: {
          monthlyRecordId: record.id,
          conceptTypeId,
          amount: it.amount,
          description,
          cuotaNumber: it.cuotaNumber,
          cuotaTotal: it.cuotaTotal,
        },
        include: { conceptType: { select: { id: true, name: true, label: true, category: true } } },
      });
      out.push(svc);
      affected.add(record.id);
    }
    if (affected.size > 0) {
      await recalculateMultipleRecords(Array.from(affected), tx);
    }
    return { results: out, affectedIds: Array.from(affected) };
  }, { timeout: 30000 });

  await settleRecordsWithDebt(affectedIds);

  return results;
};

/**
 * Bulk assign a service to multiple months for a contract.
 * Creates MonthlyRecords if they don't exist.
 */
const bulkAssign = async (groupId, contractId, conceptTypeId, amount, months, description = null, tx = null, skipRecalculate = false, source = 'inline') => {
  const execute = async (client) => {
    const results = [];
    const affectedRecordIds = new Set();
    const overwrites = [];

    for (const { month, year } of months) {
      // Find or create the monthly record
      let record = await client.monthlyRecord.findUnique({
        where: {
          contractId_periodMonth_periodYear: {
            contractId,
            periodMonth: parseInt(month),
            periodYear: parseInt(year),
          },
        },
      });

      if (!record) {
        // Need to calculate monthNumber
        const contract = await client.contract.findUnique({ where: { id: contractId } });
        if (!contract) continue;

        const startDate = new Date(contract.startDate);
        const totalMonthsDiff = (parseInt(year) - startDate.getFullYear()) * 12 + (parseInt(month) - (startDate.getMonth() + 1));
        const monthNumber = contract.startMonth + totalMonthsDiff;

        // MINIMAL SAFE FIX: Prevent creation strictly before the start date or if explicitly inactive
        if (monthNumber < contract.startMonth) continue;
        if (!contract.active) continue;

        // Prevent creation after the natural end date of the contract
        const endMonth = contract.startMonth + contract.durationMonths - 1;
        if (monthNumber > endMonth) continue;

        if (contract.rescindedAt) {
          const rescDate = new Date(contract.rescindedAt);
          const rescMonthNumber = contract.startMonth + ((rescDate.getFullYear() - startDate.getFullYear()) * 12) + (rescDate.getMonth() + 1 - (startDate.getMonth() + 1));
          if (monthNumber > rescMonthNumber) continue;
        }

        // Alquiler del mes según el HISTORIAL (no baseRent, que muta con cada
        // ajuste): la fila vigente para ese mes, o la más antigua si ninguna lo
        // cubre, o baseRent solo si el contrato no tiene historial.
        const rentRow = await client.rentHistory.findFirst({
          where: { contractId, effectiveFromMonth: { lte: monthNumber } },
          orderBy: [{ effectiveFromMonth: 'desc' }, { createdAt: 'desc' }],
        }) || await client.rentHistory.findFirst({
          where: { contractId },
          orderBy: [{ effectiveFromMonth: 'asc' }, { createdAt: 'asc' }],
        });
        const monthRent = rentRow ? rentRow.rentAmount : contract.baseRent;

        record = await client.monthlyRecord.create({
          data: {
            groupId,
            contractId,
            monthNumber,
            periodMonth: parseInt(month),
            periodYear: parseInt(year),
            rentAmount: monthRent,
            totalDue: monthRent,
            balance: -monthRent,
            // Inicializar estado de comprobantes desde el contrato, igual que
            // getOrCreateMonthlyRecords. Sin esto, los meses creados al asignar
            // servicios (propagateServiceForward) quedaban con comprobantesStatus=[]
            // y la casilla de comprobante no aparecía en el control mensual.
            comprobantesStatus: Array.isArray(contract.comprobantes)
              ? contract.comprobantes.map(c => ({ ...c, presented: false }))
              : [],
          },
        });
      }

      // Upsert the service
      try {
        // Detect amount overwrite for observability
        const existingService = await client.monthlyService.findUnique({
          where: {
            monthlyRecordId_conceptTypeId: {
              monthlyRecordId: record.id,
              conceptTypeId,
            },
          },
          select: { id: true, amount: true },
        });
        if (existingService && Math.abs(existingService.amount - amount) > 0.001) {
          console.warn('[service-overwrite]', {
            monthlyRecordId: record.id,
            conceptTypeId,
            oldAmount: existingService.amount,
            newAmount: amount,
            contractId,
            periodMonth: month,
            periodYear: year,
            source,
          });
          overwrites.push({ monthlyRecordId: record.id, conceptTypeId, oldAmount: existingService.amount, newAmount: amount });
        }

        const service = await client.monthlyService.upsert({
          where: {
            monthlyRecordId_conceptTypeId: {
              monthlyRecordId: record.id,
              conceptTypeId,
            },
          },
          update: { amount, description },
          create: {
            monthlyRecordId: record.id,
            conceptTypeId,
            amount,
            description,
          },
          include: {
            conceptType: { select: { id: true, name: true, label: true, category: true } },
          },
        });

        results.push(service);
        affectedRecordIds.add(record.id);
      } catch (e) {
        console.error(`[bulkAssign] Error upserting service for record ${record.id}:`, e.message);
      }
    }

    console.info('[bulkAssign]', { contractId, conceptTypeId, amount, monthsRequested: months.length, recordsTouched: affectedRecordIds.size, source });

    if (affectedRecordIds.size > 0 && !skipRecalculate) {
      await recalculateMultipleRecords(Array.from(affectedRecordIds), client);
    }

    if (skipRecalculate) {
      return { results, affectedRecordIds: Array.from(affectedRecordIds), overwrites };
    }
    return results;
  };

  if (tx) {
    return await execute(tx);
  } else {
    return await prisma.$transaction(async (newTx) => await execute(newTx), { timeout: 30000 });
  }
};

/**
 * Copy service configuration from one month to target months
 */
const copyConfig = async (groupId, contractId, sourceMonth, sourceYear, targetMonths) => {
  const copiedServices = await prisma.$transaction(async (tx) => {
    // Get source services
    const sourceRecord = await tx.monthlyRecord.findUnique({
      where: {
        contractId_periodMonth_periodYear: {
          contractId,
          periodMonth: parseInt(sourceMonth),
          periodYear: parseInt(sourceYear),
        },
      },
      include: {
        services: {
          include: { conceptType: true },
        },
      },
    });

    if (!sourceRecord || sourceRecord.services.length === 0) {
      return [];
    }

    const results = [];
    // Efficiency fix: Group months by service, not service by month
    for (const service of sourceRecord.services) {
      const assigned = await bulkAssign(
        groupId,
        contractId,
        service.conceptTypeId,
        service.amount,
        targetMonths,
        service.description,
        tx
      );
      results.push(...assigned);
    }

    return results;
  });

  // Propagar a deudas existentes (igual patrón que addService), fuera de la
  // transacción — evita que un mes con Debt ya generada quede con servicios
  // desincronizados (caso C06_none, 2026-07-16).
  const affectedIds = [...new Set(copiedServices.map((s) => s.monthlyRecordId))];
  await settleRecordsWithDebt(affectedIds);

  return copiedServices;
};

/**
 * Add the same service type to multiple monthly records with different amounts.
 * Used for distributing a total amount across multiple properties.
 */
const batchAddServices = async (distributions, conceptTypeId, description = null) => {
  const results = [];

  await prisma.$transaction(async (tx) => {
    const recordIds = distributions.map(d => d.recordId);
    
    for (const { recordId, amount } of distributions) {
      const service = await tx.monthlyService.create({
        data: {
          monthlyRecordId: recordId,
          conceptTypeId,
          amount,
          description,
        },
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      });
      results.push(service);
    }

    await recalculateMultipleRecords(recordIds, tx);
  });

  // Propagar a deudas existentes (igual patrón que addService), fuera de la
  // transacción (caso C06_none, 2026-07-16).
  const affectedIds = [...new Set(results.map((s) => s.monthlyRecordId))];
  await settleRecordsWithDebt(affectedIds);

  return results;
};

/**
 * Bulk assign a service to multiple months for multiple contracts.
 * Applies the same amount uniformly to every contract+month combination.
 */
const bulkAssignMultiContract = async (groupId, contractIds, conceptTypeId, amount, months, description = null) => {
  // Validate conceptType belongs to this group
  const conceptType = await prisma.conceptType.findFirst({
    where: { id: conceptTypeId, groupId, isActive: true },
  });
  if (!conceptType) throw new Error('Tipo de concepto no encontrado o inactivo');

  // Deduplicate before validation so we check unique IDs
  const uniqueContractIds = Array.from(new Set(contractIds));

  // Validate all contracts belong to this group
  const contracts = await prisma.contract.findMany({
    where: { id: { in: uniqueContractIds }, groupId },
    select: { id: true },
  });
  if (contracts.length !== uniqueContractIds.length) {
    throw new Error('Algunos contratos no pertenecen a este grupo');
  }

  let totalAssigned = 0;
  const errors = [];
  const overwrittenAmounts = [];

  // Implement Safe Chunking
  const CHUNK_SIZE = 5; // Reducido para evitar agotar el pool de conexiones y timeouts
  for (let i = 0; i < uniqueContractIds.length; i += CHUNK_SIZE) {
    const chunkIds = uniqueContractIds.slice(i, i + CHUNK_SIZE);

    const chunkAffectedIds = new Set();
    try {
      await prisma.$transaction(async (tx) => {
        for (const contractId of chunkIds) {
          try {
            const { results, affectedRecordIds, overwrites } = await bulkAssign(groupId, contractId, conceptTypeId, amount, months, description, tx, true, 'multi');
            totalAssigned += results.length;
            affectedRecordIds.forEach(id => chunkAffectedIds.add(id));
            overwrites.forEach(o => overwrittenAmounts.push(o));
          } catch (e) {
            errors.push({ contractId, error: e.message });
          }
        }

        // Recalcular todo el lote junto, una sola vez por transacción
        if (chunkAffectedIds.size > 0) {
          await recalculateMultipleRecords(Array.from(chunkAffectedIds), tx);
        }
      }, { timeout: 30000 });

      // Propagar a deudas existentes (igual patrón que addService), fuera de la
      // transacción — sin esto, un mes que ya generó Deuda quedaba con servicios
      // desincronizados: "Deuda" y el modal de pago no veían el servicio nuevo,
      // aunque Control Mensual sí (caso C06_none, 2026-07-16).
      await settleRecordsWithDebt(Array.from(chunkAffectedIds));
    } catch (chunkError) {
      for (const contractId of chunkIds) {
        errors.push({ contractId, error: `Error en lote: ${chunkError.message}` });
      }
    }
  }

  return { totalAssigned, errors, overwrittenAmounts };
};

/**
 * Propagate a service forward from a given month to December of the same year.
 * Uses bulkAssign (upsert) so existing services are updated, missing ones are created.
 */
const propagateServiceForward = async (groupId, contractId, conceptTypeId, amount, fromMonth, fromYear, description = null) => {
  const startM = parseInt(fromMonth);
  const fixedY = parseInt(fromYear);

  // No tocar meses que YA tienen un pago registrado (confirmado por el usuario
  // 2026-07-14): propagar un servicio hacia adelante no debe modificar un mes
  // donde ya se cobró algo — cambiaría retroactivamente cuánto se le cobró al
  // inquilino sin que ese pago lo refleje. Ej.: agregar el servicio en enero
  // con marzo ya pagado → se aplica a enero, febrero, abril, mayo... pero NO a
  // marzo.
  const existingRecords = await prisma.monthlyRecord.findMany({
    where: { groupId, contractId, periodYear: fixedY, periodMonth: { gte: startM } },
    select: { periodMonth: true, amountPaid: true },
  });
  const paidMonths = new Set(
    existingRecords.filter((r) => (r.amountPaid || 0) > 0).map((r) => r.periodMonth)
  );

  const months = [];
  const skippedMonths = [];
  // Generate strictly up to month 12 of the SAME year
  for (let m = startM; m <= 12; m++) {
    if (paidMonths.has(m)) {
      skippedMonths.push(m);
      continue;
    }
    months.push({ month: m, year: fixedY });
  }

  const result = await bulkAssign(groupId, contractId, conceptTypeId, amount, months, description, null, false, 'propagate');

  // Propagar a deudas existentes (igual patrón que addService): sin esto, un mes
  // que ya generó Deuda no reflejaba el servicio nuevo en "Deuda" ni en el modal
  // de pago, aunque Control Mensual sí lo mostrara (caso C06_none, 2026-07-16).
  const affectedIds = [...new Set(result.map((s) => s.monthlyRecordId))];
  await settleRecordsWithDebt(affectedIds);

  return { results: result, skippedMonths };
};

/**
 * Remove a service for a contract from a given month through December of the same year.
 */
const removeServiceForward = async (groupId, contractId, conceptTypeId, fromMonth, fromYear) => {
  const { skippedMonths, recordIds } = await prisma.$transaction(async (tx) => {
    // Find all monthly records for this contract strictly in the same year from fromMonth
    // que NO tengan ya un pago registrado (mismo criterio que propagateServiceForward:
    // no tocar un mes donde ya se cobró algo).
    const allRecords = await tx.monthlyRecord.findMany({
      where: {
        groupId,
        contractId,
        periodYear: parseInt(fromYear),
        periodMonth: { gte: parseInt(fromMonth) },
      },
      select: { id: true, periodMonth: true, amountPaid: true },
    });

    const records = allRecords.filter((r) => (r.amountPaid || 0) <= 0);
    const skippedMonths = allRecords.filter((r) => (r.amountPaid || 0) > 0).map((r) => r.periodMonth);

    const recordIds = records.map((r) => r.id);
    if (recordIds.length === 0) return { skippedMonths, recordIds };

    await tx.monthlyService.deleteMany({
      where: {
        monthlyRecordId: { in: recordIds },
        conceptTypeId,
      },
    });

    await recalculateMultipleRecords(recordIds, tx);
    return { skippedMonths, recordIds };
  });

  // Propagar a deudas existentes (igual patrón que addService), fuera de la
  // transacción (caso C06_none, 2026-07-16).
  await settleRecordsWithDebt(recordIds);

  return { skippedMonths };
};

module.exports = {
  settleRecordsWithDebt,
  addService,
  updateService,
  removeService,
  getServicesForRecord,
  bulkAssign,
  assignInstallmentService,
  bulkAssignMultiContract,
  copyConfig,
  batchAddServices,
  propagateServiceForward,
  removeServiceForward,
};
