/**
 * Pasa a Deuda los meses terminados que quedaron debiendo SIN Deuda ("meses huérfanos").
 *
 * Caso que lo originó (2026-10-20): Gutiérrez Juan Rodrigo, Miguel Cervantes 581. Agosto 2026
 * debía $130.685,41 (alquiler $900.000 − $809.497,64 a favor que dejó julio) y el cierre de agosto
 * lo había salteado por el flag post-vencimiento rancio. Al cobrar Octubre con "Pagar varios
 * meses" se sumaban Septiembre y Octubre y Agosto no aparecía.
 *
 * Usa la MISMA definición que la app (src/services/unclosedMonths.js): mes ya cerrado por el
 * grupo, posterior al primer movimiento del contrato, en rango, sin condonar, que debe > $1.
 * El código nuevo los pasa a Deuda solo en el próximo cobro o "Cerrar mes"; este script lo hace
 * ya, para que figuren hoy en Deudas, dashboard y avisos.
 *
 * Por la regla confirmada el 2026-10-20, la Deuda corre mora sobre el ALQUILER COMPLETO desde el
 * mes (el crédito se resta del total): es lo mismo que si se hubiera cerrado a tiempo.
 *
 * SOLO LECTURA por defecto. Producción corre en UTC: correr con TZ=UTC.
 *   TZ=UTC node scripts/repair-meses-sin-cerrar.js                       # dry-run, todos los grupos
 *   TZ=UTC node scripts/repair-meses-sin-cerrar.js --group <groupId>     # un grupo
 *   TZ=UTC node scripts/repair-meses-sin-cerrar.js --apply [--group <id>]
 */
const prisma = require('../src/lib/prisma');
const { findUnclosedOwingRecords, ensureDebtsForUnclosedMonths } = require('../src/services/unclosedMonths');
const { calculateDebtPunitory } = require('../src/services/debtService');
const { getTodayLocalString } = require('../src/utils/dateUtils');

const APPLY = process.argv.includes('--apply');
const groupArg = process.argv.indexOf('--group');
const ONLY_GROUP = groupArg > -1 ? process.argv[groupArg + 1] : null;

const money = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  if (process.env.TZ !== 'UTC') {
    console.error('Correr con TZ=UTC (producción corre en UTC; si no, la mora cuenta un día de más).');
    process.exit(1);
  }
  const today = getTodayLocalString();
  const groups = await prisma.group.findMany({
    where: ONLY_GROUP ? { id: ONLY_GROUP } : {},
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN'} — hoy ${today}\n`);
  let total = 0;
  let count = 0;
  for (const g of groups) {
    const found = await findUnclosedOwingRecords({ groupId: g.id, today });
    if (found.length === 0) continue;
    const contracts = await prisma.contract.findMany({
      where: { id: { in: [...new Set(found.map((f) => f.record.contractId))] } },
      select: { id: true, tenant: { select: { name: true } }, property: { select: { address: true } } },
    });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    console.log(`=== ${g.name} (${g.id}) — ${found.length} mes(es) ===`);
    for (const { record, data } of found) {
      const live = await calculateDebtPunitory({ ...data, id: null, payments: [] }, today, null, true);
      const owed = live.remainingDebt + (live.unpaidAccumulatedPunitory || 0) + live.amount;
      total += owed;
      count += 1;
      const c = byId.get(record.contractId);
      console.log(
        `  ${data.periodLabel.padEnd(16)} ${(c?.tenant?.name || '?').padEnd(30)} ${(c?.property?.address || '').padEnd(28)}`
        + ` alquiler ${money(data.unpaidRentAmount)}  servicios ${money(data.unpaidServicesAmount)}`
        + `  a favor ${money(data.appliedCredit)}  mora hoy ${money(live.amount + (live.unpaidAccumulatedPunitory || 0))} (${live.days}d)`
        + `  → debe ${money(owed)}   [record ${record.id}]`,
      );
    }
    if (APPLY) {
      const created = await ensureDebtsForUnclosedMonths({ groupId: g.id, today });
      console.log(`  → ${created.length} Deuda(s) creada(s)`);
    }
    console.log('');
  }
  console.log(`${count} mes(es), ${money(total)} en total a la fecha.`);
  if (!APPLY && count > 0) console.log('Nada se escribió. Repetir con --apply para crear las Deudas.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
