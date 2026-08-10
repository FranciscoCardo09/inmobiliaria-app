/**
 * Saldo a favor fantasma por servicio sobrescrito DESPUÉS del pago.
 *
 * QUÉ PASÓ (casos reales de julio 2026, grupo Habitar Administracion)
 *   Amicucci Romina Desiree (Cabo Segundo R. A. Moreno 6662/6670 L17 PhA):
 *     10/07 se registra el pago de julio por $1.323.550. Los TransactionConcept
 *     quedan congelados con ALQUILER 1.300.000 + AGUA 23.550 = exactamente lo
 *     facturado y cobrado. Días después la fila AGUA de monthly_services de ESE
 *     mes (ya COMPLETE) se sobrescribe a 23.330.
 *   Falco Sanchez Carolina (mismo edificio, L17 PhB): idem, AGUA 23.352 → 23.332.
 *
 * POR QUÉ APARECE COMO SALDO A FAVOR
 *   `_recalculateCore` (monthlyRecordService.js) recomputa `servicesTotal` desde
 *   las filas de monthly_services y con eso `totalDue`, pero `amountPaid` viene
 *   de las transacciones ya registradas — que NO se re-imputan. Al bajar el
 *   servicio, `balance = amountPaid - totalDue` queda positivo y la cascada lo
 *   arrastra al `previousBalance` del mes siguiente (columna "A Favor Ant." del
 *   Control Mensual).
 *
 * NO ES EL CIERRE MENSUAL
 *   `monthlyCloseService.closeMonth` solo crea filas de `debts` para los records
 *   PENDING/PARTIAL; no escribe un solo campo de monthly_records, transactions ni
 *   monthly_services (verificado end-to-end contra una copia de prod, y cubierto
 *   por tests/closeMonthNoDataMutation.test.js). En ambos casos el saldo fantasma
 *   ya existía días ANTES de que corriera el cierre de julio.
 *
 * DE DÓNDE VIENE LA SOBRESCRITURA
 *   `monthlyServiceService.bulkAssign` hace `upsert` del servicio en cada mes del
 *   rango pedido sin excluir los meses ya pagados: solo deja un `console.warn`
 *   ('[service-overwrite]'). Asignar/corregir un servicio "de julio en adelante"
 *   pisa el importe de un mes COMPLETE y genera este saldo fantasma.
 *
 * QUÉ HACE ESTE SCRIPT
 *   Para cada MonthlyRecord del período pedido que cumpla TODAS las condiciones:
 *     - status COMPLETE y balance > 0 (saldo a favor),
 *     - sin ningún concepto SOBREPAGO (si lo hay, el inquilino pagó de más de
 *       verdad — es un saldo a favor legítimo y NO se toca),
 *     - sin deuda asociada,
 *     - el ALQUILER cobrado coincide con `rentAmount` (si no, es otro defecto),
 *     - al restaurar los servicios al importe efectivamente facturado y cobrado
 *       el balance da exactamente 0,
 *   restaura `monthly_services.amount` al importe del TransactionConcept
 *   correspondiente y dispara `recalculateMultipleRecords`, que recalcula el mes
 *   y arrastra la corrección hacia adelante (previousBalance de los meses
 *   siguientes).
 *
 * QUÉ NO TOCA
 *   - Las transacciones, sus conceptos y los recibos: quedan intactos.
 *   - Los saldos a favor reales (con concepto SOBREPAGO).
 *   - Los meses con deuda generada.
 *
 * Uso:
 *   DATABASE_URL=<db> node scripts/repair-servicio-sobrescrito-post-pago.js                    # dry-run 7/2026
 *   DATABASE_URL=<db> node scripts/repair-servicio-sobrescrito-post-pago.js --period 8/2026
 *   DATABASE_URL=<db> node scripts/repair-servicio-sobrescrito-post-pago.js --all              # barre todos los períodos
 *   DATABASE_URL=<db> node scripts/repair-servicio-sobrescrito-post-pago.js --apply
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const periodArg = (() => {
  const i = process.argv.indexOf('--period');
  if (i === -1) return { month: 7, year: 2026 };
  const [m, y] = String(process.argv[i + 1] || '').split('/');
  return { month: parseInt(m), year: parseInt(y) };
})();

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const EPS = 0.005;

// Conceptos que NO son servicios (no tienen fila en monthly_services).
const NON_SERVICE_CONCEPTS = new Set([
  'ALQUILER', 'ALQUILER_DEUDA', 'IVA', 'PUNITORIOS', 'SOBREPAGO', 'A_FAVOR',
]);

const analyze = (record) => {
  const concepts = record.transactions.flatMap((t) => t.concepts);

  // Saldo a favor REAL: el motor de pagos dejó un concepto SOBREPAGO. No se toca.
  const sobrepago = r2(concepts.filter((c) => c.type === 'SOBREPAGO').reduce((s, c) => s + c.amount, 0));
  if (sobrepago > EPS) return { skip: `saldo a favor real (concepto SOBREPAGO $${sobrepago})` };
  if (record.debt) return { skip: 'el mes tiene deuda generada' };

  // El alquiler cobrado tiene que coincidir con el del registro; si no, el
  // desvío no viene de un servicio y este script no es el arreglo correcto.
  const paidRent = r2(concepts.filter((c) => c.type === 'ALQUILER').reduce((s, c) => s + c.amount, 0));
  if (Math.abs(paidRent - record.rentAmount) > EPS) {
    return { skip: `el ALQUILER cobrado ($${paidRent}) no coincide con rentAmount ($${r2(record.rentAmount)})` };
  }

  // Importe de cada servicio tal como fue facturado y cobrado.
  const billed = new Map();
  for (const c of concepts) {
    if (NON_SERVICE_CONCEPTS.has(c.type)) continue;
    billed.set(c.type, r2((billed.get(c.type) || 0) + c.amount));
  }

  const fixes = [];
  for (const svc of record.services) {
    const name = svc.conceptType.name;
    if (!billed.has(name)) continue; // servicio agregado después del pago: no es este patrón
    const paid = billed.get(name);
    if (Math.abs(paid - svc.amount) <= EPS) continue;
    fixes.push({ serviceId: svc.id, name, from: r2(svc.amount), to: paid });
  }
  if (fixes.length === 0) return { skip: 'ningún servicio difiere de lo cobrado' };

  // Al subir/bajar los servicios, totalDue se mueve igual y balance al revés.
  const delta = r2(fixes.reduce((s, f) => s + (f.to - f.from), 0));
  const projected = r2(record.balance - delta);
  if (Math.abs(projected) > EPS) {
    return { skip: `restaurar los servicios no deja el mes en cero (quedaría $${projected})`, fixes };
  }
  return { fixes, delta, projected };
};

const main = async () => {
  const where = {
    status: 'COMPLETE',
    balance: { gt: EPS },
    ...(ALL ? {} : { periodMonth: periodArg.month, periodYear: periodArg.year }),
  };

  const records = await prisma.monthlyRecord.findMany({
    where,
    include: {
      services: { include: { conceptType: { select: { name: true } } } },
      transactions: { include: { concepts: true }, orderBy: { createdAt: 'asc' } },
      debt: { select: { id: true } },
      contract: {
        select: {
          id: true,
          tenant: { select: { name: true } },
          property: { select: { address: true } },
          group: { select: { name: true } },
        },
      },
    },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { balance: 'desc' }],
  });

  console.log(`\n${APPLY ? '=== APPLY ===' : '=== DRY-RUN (agregá --apply para escribir) ==='}`);
  console.log(`Alcance: ${ALL ? 'todos los períodos' : `${periodArg.month}/${periodArg.year}`}`);
  console.log(`Registros COMPLETE con saldo a favor: ${records.length}\n`);

  const targets = [];
  const skipped = [];
  for (const rec of records) {
    const res = analyze(rec);
    const label = `[${String(rec.periodMonth).padStart(2, '0')}/${rec.periodYear}] ${rec.contract.tenant?.name || '(sin inquilino)'} — ${rec.contract.property?.address}`;
    if (res.skip) { skipped.push({ label, balance: r2(rec.balance), reason: res.skip }); continue; }
    targets.push({ rec, label, ...res });
  }

  console.log(`--- Saldos a favor legítimos / fuera de patrón: ${skipped.length}`);
  for (const s of skipped) console.log(`    $${String(s.balance).padStart(10)}  ${s.label}\n                  → ${s.reason}`);

  console.log(`\n--- Saldo a favor FANTASMA (servicio sobrescrito post-pago): ${targets.length}`);
  for (const t of targets) {
    console.log(`\n  ${t.label}`);
    console.log(`    balance actual: +$${r2(t.rec.balance)}   pagado: $${r2(t.rec.amountPaid)}   totalDue: $${r2(t.rec.totalDue)}`);
    for (const f of t.fixes) console.log(`    ${f.name}: $${f.from} → $${f.to}  (facturado y cobrado)`);
    console.log(`    balance proyectado: $${t.projected}`);
  }

  if (!APPLY) { console.log('\n(dry-run: no se escribió nada)\n'); return; }
  if (targets.length === 0) { console.log('\nNada para reparar.\n'); return; }

  for (const t of targets) {
    await prisma.$transaction(async (tx) => {
      for (const f of t.fixes) {
        await tx.monthlyService.update({ where: { id: f.serviceId }, data: { amount: f.to } });
      }
    });
    // Recálculo INLINE (tercer parámetro): el modo por defecto solo marca
    // `needsRecalculation` y agenda `processDirtyRecords` con setImmediate — en un
    // script de un solo uso el proceso cierra la conexión antes de que corra y el
    // recálculo muere con P2028 dejando el servicio arreglado pero el total viejo.
    await recalculateMultipleRecords([t.rec.id], null, true);
    const after = await prisma.monthlyRecord.findUnique({
      where: { id: t.rec.id },
      select: { servicesTotal: true, totalDue: true, amountPaid: true, balance: true, status: true },
    });
    console.log(`\n  ✔ ${t.label}`);
    console.log(`    servicesTotal=${r2(after.servicesTotal)} totalDue=${r2(after.totalDue)} paid=${r2(after.amountPaid)} balance=${r2(after.balance)} ${after.status}`);
  }
  console.log('');
};

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
