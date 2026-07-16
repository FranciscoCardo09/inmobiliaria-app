/**
 * Diagnóstico (SOLO LECTURA, no escribe nada) del bug 2026-07-16: cualquier lectura de
 * una deuda nunca pagada (GET /debts/:id, punitory-preview del modal de pago, e incluso
 * el primer payDebt/payDebtsBulk) llamaba a `calculateDebtPunitory` sin `skipUpdate`, que
 * recalculaba `accumulatedPunitory` desde `calculateImputation(monthlyRecord)` — pero esa
 * función solo conoce el punitorio CONGELADO DEL ÚLTIMO PAGO del MonthlyRecord (0 si nunca
 * se pagó), no el catch-up que `createDebtFromMonthlyRecord` calculó y congeló al crear la
 * deuda (punitorio devengado entre el cierre del mes y el momento de creación). El guard
 * "no inflar" dejaba pasar esa corrección porque bajar nunca infla — y persistía el
 * catch-up borrado. Ya arreglado en `calculateDebtPunitory` (debtService.js); este script
 * busca deudas que puedan haber quedado con el campo corrompido ANTES del fix.
 *
 * Método: para cada Debt con status OPEN y amountPaid=0, se recalcula el catch-up que
 * `createDebtFromMonthlyRecord` habría calculado en su momento —mismos inputs
 * (`calculatePunitoryV2` desde `punitoryStartDate` hasta `debt.createdAt`, base =
 * `debt.unpaidRentAmount` ya neto, que es justamente lo que se pasó como base en la
 * creación)— y se compara contra el `accumulatedPunitory` almacenado hoy. Si el
 * almacenado es menor al recalculado por más de $1, se reporta como candidata.
 *
 * Es una ESTIMACIÓN para revisión humana, no una verdad absoluta ni una reparación:
 * - Si `previousRecordPayment > 0` (hubo un pago parcial del MonthlyRecord antes de
 *   cerrarse a deuda), el `monthlyRecord.punitoryAmount` congelado de ESE momento pudo
 *   haber sido >0 y sumarse al catch-up original; ese dato ya no es recuperable, así que
 *   el estimado es un PISO (podría faltar aún más de lo que se reporta). Se marca aparte.
 * - No escribe nada en la base. La decisión de reparar (y con qué método) queda para
 *   después de revisar el reporte.
 *
 * Uso:
 *   node scripts/diagnose-punitory-catchup-loss.js
 *   node scripts/diagnose-punitory-catchup-loss.js --group <groupId>
 */
const prisma = require('../src/lib/prisma');
const { calculatePunitoryV2, getHolidaysForYear, round2 } = require('../src/utils/punitory');
const { getTodayLocalString } = require('../src/utils/dateUtils');

const args = process.argv.slice(2);
const groupIdx = args.indexOf('--group');
const groupId = groupIdx !== -1 ? args[groupIdx + 1] : null;

async function main() {
  const where = { status: 'OPEN', amountPaid: 0 };
  if (groupId) where.groupId = groupId;

  const debts = await prisma.debt.findMany({
    where,
    include: {
      contract: {
        include: {
          tenant: { select: { name: true } },
          property: { select: { address: true } },
        },
      },
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  });

  console.log(`Analizando ${debts.length} deudas OPEN con amountPaid=0...\n`);

  const holidaysByYear = new Map();
  const getHolidays = async (year) => {
    if (!holidaysByYear.has(year)) {
      holidaysByYear.set(year, await getHolidaysForYear(year));
    }
    return holidaysByYear.get(year);
  };

  const candidates = [];
  let totalLoss = 0;

  for (const debt of debts) {
    if (!debt.contract) continue;

    const holidays = await getHolidays(debt.periodYear);
    const calculationDate = getTodayLocalString(debt.createdAt);

    // Base = debt.unpaidRentAmount: ya es el mismo valor neto que
    // createDebtFromMonthlyRecord pasó como base del catch-up al crearse.
    const liveResult = calculatePunitoryV2(
      calculationDate,
      debt.periodMonth,
      debt.periodYear,
      debt.unpaidRentAmount || 0,
      debt.contract.punitoryStartDay,
      debt.contract.punitoryGraceDay,
      debt.punitoryPercent,
      holidays,
      null // nunca hubo pago antes de crear la deuda con este cálculo
    );
    const expectedCatchup = round2(liveResult.amount || 0);
    const storedCatchup = round2(debt.accumulatedPunitory || 0);
    const diff = round2(expectedCatchup - storedCatchup);

    if (diff > 1) {
      totalLoss += diff;
      candidates.push({
        debtId: debt.id,
        tenant: debt.contract.tenant?.name || '-',
        address: debt.contract.property?.address || '-',
        period: `${debt.periodMonth}/${debt.periodYear}`,
        createdAt: debt.createdAt.toISOString().slice(0, 10),
        updatedAt: debt.updatedAt.toISOString().slice(0, 10),
        storedCatchup,
        expectedCatchup,
        diff,
        partialNote: (debt.previousRecordPayment || 0) > 0 ? 'huvo pago previo del mes — estimado es un PISO' : '',
      });
    }
  }

  candidates.sort((a, b) => b.diff - a.diff);

  console.log(`Candidatas con accumulatedPunitory por debajo del catch-up esperado: ${candidates.length}\n`);
  for (const c of candidates) {
    console.log(
      `- ${c.tenant} (${c.address}) período ${c.period} | deuda ${c.debtId}\n` +
      `    creada ${c.createdAt}, actualizada ${c.updatedAt}\n` +
      `    accumulatedPunitory actual: $${c.storedCatchup.toLocaleString('es-AR')} | esperado: $${c.expectedCatchup.toLocaleString('es-AR')} | diferencia: $${c.diff.toLocaleString('es-AR')}` +
      (c.partialNote ? ` | ${c.partialNote}` : '')
    );
  }

  console.log(`\nTotal estimado potencialmente perdido: $${round2(totalLoss).toLocaleString('es-AR')}`);
  console.log('\n(Solo lectura — no se modificó ningún registro.)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
