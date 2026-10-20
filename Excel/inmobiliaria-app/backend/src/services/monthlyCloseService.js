// Monthly Close Service - Cierre mensual que genera deudas automáticas
const { createDebtFromMonthlyRecord, computeDebtDraft } = require('./debtService');
const { getTodayLocalString } = require('../utils/dateUtils');
const { isContractInRangeForMonth, processDirtyRecords } = require('./monthlyRecordService');

const prisma = require('../lib/prisma');

/**
 * ¿Este registro es candidato a generar deuda?
 *
 * NO se filtra por `status` (antes era `status IN ('PENDING','PARTIAL')`). El status es un
 * campo derivado que puede quedar viejo: los recálculos por servicios / IVA / condonación
 * corren fire-and-forget (`recalculateMultipleRecords` sin `inline` + `setImmediate`), así
 * que un registro puede tener `needsRecalculation = true` y totales desactualizados justo
 * cuando se aprieta "Cerrar Mes". Decidir por el status significaba, en el peor caso,
 * generar deuda a alguien que ya había pagado (o saltear a alguien que debe).
 *
 * Ahora el filtro es estructural y la decisión la toma la PLATA:
 * `createDebtFromMonthlyRecord` calcula lo impago neto del crédito y devuelve `null` si es
 * ≤ $1. Un mes cancelado da 0 y no genera nada, sin depender del string.
 *
 * Exclusiones estructurales:
 *  - `isPostExpiry`: el mes extra post-vencimiento nunca genera deuda ni punitorios.
 *  - ya tiene deuda: idempotencia del cierre.
 *  - fuera del rango activo del contrato (A-10): p.ej. posterior a la rescisión.
 *  - `balanceForgiven > 0`: saldo condonado a mano. `calculateImputation` no conoce
 *    `balanceForgiven` (deriva lo impago de `amountPaid`), así que sin esta guarda un mes
 *    perdonado volvería a generar deuda por el monto condonado.
 */
const isCloseCandidate = (record) => {
  if (record.isPostExpiry) return false;
  if (record.debt) return false;
  if ((record.balanceForgiven || 0) > 0) return false;
  return isContractInRangeForMonth(record.contract, record.monthNumber);
};

/**
 * Sólo se cierra un mes que ya terminó (o su último día). Antes nada lo impedía: cerrar
 * Diciembre en Octubre generó 104 deudas en la prueba de la auditoría 2026-10-20, con mora
 * corriendo sobre meses que todavía no vencían.
 */
const assertMonthCanClose = (periodMonth, periodYear, today = getTodayLocalString()) => {
  const [ty, tm, td] = today.split('-').map(Number);
  const lastDay = new Date(periodYear, periodMonth, 0).getDate();
  const periodKey = periodYear * 12 + periodMonth;
  const todayKey = ty * 12 + tm;
  if (periodKey < todayKey) return;
  if (periodKey === todayKey && td >= lastDay) return;
  throw Object.assign(
    new Error(`Todavía no se puede cerrar ${monthNames[periodMonth]} ${periodYear}: se cierra a partir del ${lastDay}/${periodMonth}/${periodYear}.`),
    { code: 'PAYMENT_BLOCKED' },
  );
};

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Preview del cierre mensual: qué deudas se generarían.
 * NO ejecuta cambios, solo muestra preview.
 */
const previewCloseMonth = async (groupId, month, year) => {
  const periodMonth = parseInt(month);
  const periodYear = parseInt(year);

  // Saldar los recálculos pendientes antes de mirar los números: el preview tiene que
  // decidir sobre totales frescos, no sobre los que dejó a medias un `setImmediate`.
  await processDirtyRecords();

  const unpaidRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth,
      periodYear,
      // El mes extra post-vencimiento (solo servicios) nunca genera deuda ni punitorios.
      isPostExpiry: false,
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, name: true, dni: true } },
          contractTenants: { include: { tenant: { select: { id: true, name: true, dni: true } } }, orderBy: { isPrimary: 'desc' } },
          property: {
            select: {
              id: true, address: true,
              owner: { select: { id: true, name: true } },
            },
          },
        },
      },
      services: {
        include: {
          conceptType: { select: { name: true, label: true, category: true } },
        },
      },
      transactions: { orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }] },
      debt: true, // Verificar si ya tiene deuda
    },
  });

  // A-10 (AUDITORIA_FUNCIONAL_2026-07-10.md): un MonthlyRecord de un mes posterior a la
  // rescisión del contrato (invisible en el Control Mensual, pero vivo en la DB) generaba
  // deuda real e igual de exigible que un mes vigente. `isContractInRangeForMonth`
  // (monthlyRecordService.js) es la fuente única de "¿este mes está dentro del rango activo
  // del contrato?" — se reutiliza en `isCloseCandidate` en vez de duplicar la lógica.
  const recordsToClose = unpaidRecords.filter(isCloseCandidate);

  const debtsPreview = await Promise.all(recordsToClose.map(async (record) => {
    // Mismo cálculo que el cierre real (`computeDebtDraft`), incluido el catch-up de mora de
    // los meses sin pagos y el crédito aplicado al total: preview y cierre no pueden diferir.
    const draft = await computeDebtDraft(record, record.contract);
    const { unpaidRent, unpaidPunitory, totalOriginal, totalUnpaid, appliedCredit, netUnpaid } = draft;
    const amountPaid = record.amountPaid || 0;
    const servicesCovered = Math.min(amountPaid, record.servicesTotal || 0);
    const rentCovered = Math.min(Math.max(amountPaid - servicesCovered - (record.ivaAmount || 0), 0), record.rentAmount || 0);
    const punitoryCovered = Math.max(amountPaid - servicesCovered - (record.ivaAmount || 0) - rentCovered, 0);
    const isPropietario = record.contract.contractType === 'PROPIETARIO';

    return {
      monthlyRecordId: record.id,
      contractType: record.contract.contractType || 'INQUILINO',
      tenant: isPropietario
        ? { name: record.contract.property?.owner?.name || 'Propietario' }
        : (record.contract.tenant || null),
      tenants: isPropietario
        ? [{ name: record.contract.property?.owner?.name || 'Propietario' }]
        : (record.contract.contractTenants?.length > 0
          ? record.contract.contractTenants.map((ct) => ct.tenant)
          : record.contract.tenant ? [record.contract.tenant] : []),
      property: record.contract.property,
      periodLabel: `${monthNames[periodMonth]} ${periodYear}`,
      status: record.status,
      totalOriginal,
      amountPaid: record.amountPaid,
      servicesCovered,
      rentCovered,
      punitoryCovered,
      unpaidRent,
      unpaidPunitory,
      totalUnpaid,
      appliedCredit,
      netUnpaid,
      willGenerateDebt: netUnpaid > 1,
    };
  }));

  const summary = {
    totalRecords: unpaidRecords.length,
    alreadyHaveDebt: unpaidRecords.filter((r) => !!r.debt).length,
    outOfContractRange: unpaidRecords.filter((r) => !r.debt && !isContractInRangeForMonth(r.contract, r.monthNumber)).length,
    willGenerateDebts: debtsPreview.filter((d) => d.willGenerateDebt).length,
    // Neto del crédito y sólo de las que efectivamente se van a crear: es la plata que
    // realmente va a quedar como deuda.
    totalDebtAmount: Math.round(debtsPreview.reduce((sum, d) => sum + (d.willGenerateDebt ? d.netUnpaid : 0), 0) * 100) / 100,
  };

  return { debtsPreview, summary };
};

/**
 * Ejecutar cierre mensual: genera deudas para registros impagos.
 */
const closeMonth = async (groupId, month, year) => {
  const periodMonth = parseInt(month);
  const periodYear = parseInt(year);
  assertMonthCanClose(periodMonth, periodYear);

  // Saldar los recálculos pendientes ANTES de decidir quién debe: si un servicio o el IVA
  // se tocaron hace un instante, el recálculo corre fire-and-forget y el registro puede
  // estar todavía marcado `needsRecalculation` con totales viejos.
  await processDirtyRecords();

  const unpaidRecords = await prisma.monthlyRecord.findMany({
    where: {
      groupId,
      periodMonth,
      periodYear,
      // El mes extra post-vencimiento (solo servicios) nunca genera deuda ni punitorios.
      isPostExpiry: false,
    },
    include: {
      contract: true,
      services: {
        include: {
          conceptType: { select: { category: true } },
        },
      },
      transactions: { orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }] },
      debt: true,
    },
  });

  const debtsCreated = [];
  const errors = [];

  for (const record of unpaidRecords) {
    // Filtro estructural; el monto lo decide createDebtFromMonthlyRecord (≤ $1 → null).
    // Ver el docblock de `isCloseCandidate` para por qué ya no se filtra por `status`.
    if (!isCloseCandidate(record)) continue;

    try {
      const debt = await createDebtFromMonthlyRecord(record, record.contract);
      if (debt) {
        debtsCreated.push(debt);
        // No marcar isCancelled: solo se marca TRUE cuando el inquilino paga todo
      }
    } catch (error) {
      errors.push({
        recordId: record.id,
        contractId: record.contractId,
        error: error.message,
      });
    }
  }

  return {
    periodLabel: `${monthNames[periodMonth]} ${periodYear}`,
    debtsCreated: debtsCreated.length,
    errors: errors.length > 0 ? errors : undefined,
    summary: {
      // Registros que el cierre evaluó (ya no es "impagos": el filtro por status se quitó,
      // ver `isCloseCandidate`).
      totalUnpaid: unpaidRecords.filter(isCloseCandidate).length,
      alreadyHadDebt: unpaidRecords.filter((r) => r.debt).length,
      newDebts: debtsCreated.length,
    },
  };
};

module.exports = {
  assertMonthCanClose,
  previewCloseMonth,
  closeMonth,
};
