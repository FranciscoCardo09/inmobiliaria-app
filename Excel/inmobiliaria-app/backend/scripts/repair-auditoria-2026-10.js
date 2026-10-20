/**
 * Reparaciones de datos de la auditoría de pagos del 2026-10-20.
 *
 * Por defecto NO escribe nada: muestra qué haría. Cada parte se aplica sólo si se la pide:
 *
 *   TZ=UTC node scripts/repair-auditoria-2026-10.js                       # dry-run de todo
 *   TZ=UTC node scripts/repair-auditoria-2026-10.js --apply feriados
 *   TZ=UTC node scripts/repair-auditoria-2026-10.js --apply post-rescision
 *   TZ=UTC node scripts/repair-auditoria-2026-10.js --apply condonadas
 *   TZ=UTC node scripts/repair-auditoria-2026-10.js --apply ciuro-cobrar   (o ciuro-condonar)
 *   TZ=UTC node scripts/repair-auditoria-2026-10.js --apply recalcular
 *   (se pueden combinar: --apply feriados,post-rescision,condonadas)
 *
 * Partes:
 *  - feriados: carga los feriados nacionales 2026 y 2027 (la tabla estaba vacía y la gracia
 *    no se corría por feriados). 2027 sin días puente: agregarlos cuando salga el decreto.
 *  - post-rescision: borra las deudas abiertas de meses posteriores a la rescisión / fuera del
 *    rango del contrato, sin pagos propios (decisión del usuario 2026-10-20).
 *  - condonadas: deudas condonadas con "Condonar deuda" antes del arreglo: graba en el mes la
 *    condonación (`balanceForgiven`) para que un recálculo no lo vuelva a abrir.
 *  - ciuro-cobrar / ciuro-condonar: Ciuro Felipe, agosto 2026 tiene $136.760 de saldo a favor
 *    guardado cuando correspondían $5.027,36 (lo grabó una versión vieja). Recalcular deja
 *    agosto debiendo la diferencia (cobrar) o, con "condonar", la condona.
 *  - recalcular: recalcula todos los contratos con el código nuevo (centavos de mora
 *    fantasma, mora negativa de Gimenez, Semamart jul/ago, Alarmas, etc.).
 *  - completar-condonaciones: meses condonados que, recalculados, siguen debiendo (la
 *    condonación la calculó una versión vieja del motor): la condonación pasa a cubrir el
 *    saldo de hoy. Correr DESPUÉS de recalcular.
 */
const prisma = require('../src/lib/prisma');
const { recalculateMultipleRecords } = require('../src/services/monthlyRecordService');
const { round2 } = require('../src/utils/punitory');

const args = process.argv.slice(2);
const applyIdx = args.indexOf('--apply');
const APPLY = new Set(applyIdx === -1 ? [] : String(args[applyIdx + 1] || '').split(',').filter(Boolean));
const money = (n) => `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Feriados nacionales (Ley 27.399, trasladables ya movidos, días puente 2026).
const HOLIDAYS = [
  ['2026-01-01', 'Año Nuevo'],
  ['2026-02-16', 'Carnaval'], ['2026-02-17', 'Carnaval'],
  ['2026-03-23', 'Día puente'], ['2026-03-24', 'Día de la Memoria'],
  ['2026-04-02', 'Malvinas'], ['2026-04-03', 'Viernes Santo'],
  ['2026-05-01', 'Día del Trabajador'], ['2026-05-25', 'Revolución de Mayo'],
  ['2026-06-15', 'Paso a la Inmortalidad de Güemes (trasladado)'], ['2026-06-20', 'Día de la Bandera'],
  ['2026-07-09', 'Independencia'], ['2026-07-10', 'Día puente'],
  ['2026-08-17', 'Paso a la Inmortalidad de San Martín'],
  ['2026-10-12', 'Día del Respeto a la Diversidad Cultural'],
  ['2026-11-23', 'Día de la Soberanía Nacional (trasladado)'],
  ['2026-12-07', 'Día puente'], ['2026-12-08', 'Inmaculada Concepción'], ['2026-12-25', 'Navidad'],
  ['2027-01-01', 'Año Nuevo'],
  ['2027-02-08', 'Carnaval'], ['2027-02-09', 'Carnaval'],
  ['2027-03-24', 'Día de la Memoria'], ['2027-03-26', 'Viernes Santo'],
  ['2027-04-02', 'Malvinas'],
  ['2027-05-01', 'Día del Trabajador'], ['2027-05-25', 'Revolución de Mayo'],
  ['2027-06-21', 'Paso a la Inmortalidad de Güemes (trasladado)'], ['2027-06-20', 'Día de la Bandera'],
  ['2027-07-09', 'Independencia'],
  ['2027-08-16', 'Paso a la Inmortalidad de San Martín (trasladado)'],
  ['2027-10-11', 'Día del Respeto a la Diversidad Cultural (trasladado)'],
  ['2027-11-20', 'Día de la Soberanía Nacional'],
  ['2027-12-08', 'Inmaculada Concepción'], ['2027-12-25', 'Navidad'],
];

async function feriados() {
  console.log('\n=== Feriados ===');
  const existing = await prisma.holiday.findMany({ where: { year: { in: [2026, 2027] } } });
  const have = new Set(existing.map((h) => h.date.toISOString().slice(0, 10)));
  const missing = HOLIDAYS.filter(([d]) => !have.has(d));
  console.log(`  cargados: ${existing.length}, faltan: ${missing.length}`);
  missing.forEach(([d, n]) => console.log(`   + ${d} ${n}`));
  if (!APPLY.has('feriados')) return;
  for (const [d, name] of missing) {
    const [y, m, day] = d.split('-').map(Number);
    await prisma.holiday.create({ data: { date: new Date(Date.UTC(y, m - 1, day)), name, year: y } });
  }
  console.log(`  ✓ ${missing.length} feriados cargados`);
}

async function postRescision() {
  console.log('\n=== Deudas de meses fuera del contrato (post-rescisión) ===');
  const rows = await prisma.$queryRawUnsafe(`
    select d.id, d.period_label, d.current_total, t.name, p.address,
           (select count(*)::int from debt_payments dp where dp.debt_id = d.id) pagos
    from debts d
    join monthly_records m on m.id = d.monthly_record_id
    join contracts c on c.id = d.contract_id
    join properties p on p.id = c.property_id
    left join tenants t on t.id = c.tenant_id
    where d.status in ('OPEN','PARTIAL')
      and (m.month_number < c.start_month
        or m.month_number > c.start_month + c.duration_months - 1
        or (c.rescinded_at is not null and
            (m.period_year * 12 + m.period_month) >
            (extract(year from c.rescinded_at)::int * 12 + extract(month from c.rescinded_at)::int)))
    order by t.name, m.period_year, m.period_month`);
  rows.forEach((r) => console.log(`   ${r.pagos > 0 ? '⚠ CON PAGOS, no se toca' : '-'} ${(r.name || '').trim()} · ${r.address} · ${r.period_label} · ${money(r.current_total)}`));
  const deletable = rows.filter((r) => r.pagos === 0);
  if (!APPLY.has('post-rescision')) return;
  for (const r of deletable) await prisma.debt.delete({ where: { id: r.id } });
  console.log(`  ✓ ${deletable.length} deudas borradas`);
}

async function condonadas() {
  console.log('\n=== Deudas condonadas sin la condonación grabada en el mes ===');
  const rows = await prisma.$queryRawUnsafe(`
    select d.id debt_id, d.closed_at, m.id record_id, m.balance, m.balance_forgiven, d.period_label, t.name
    from debts d
    join monthly_records m on m.id = d.monthly_record_id
    join contracts c on c.id = d.contract_id
    left join tenants t on t.id = c.tenant_id
    where d.status = 'PAID' and d.observations ilike '%condon%'
      and coalesce(m.balance_forgiven, 0) = 0 and m.balance < -1
      -- Biassi marzo: los $35.145 se COBRARON y no se cargaron (pendiente FIX_BIASSI en
      -- scripts/repair-conceptos.js), no es una condonación.
      and coalesce(t.name, '') not ilike 'Biassi%'
    order by t.name`);
  rows.forEach((r) => console.log(`   - ${(r.name || '').trim()} · ${r.period_label} · condona ${money(-r.balance)}`));
  if (!APPLY.has('condonadas')) return;
  for (const r of rows) {
    await prisma.monthlyRecord.update({
      where: { id: r.record_id },
      data: { balanceForgiven: round2(-r.balance), balanceForgivenAt: r.closed_at || new Date() },
    });
  }
  console.log(`  ✓ ${rows.length} meses con la condonación grabada`);
}

async function ciuro() {
  console.log('\n=== Ciuro Felipe, agosto 2026 (saldo a favor viejo) ===');
  const rec = (await prisma.$queryRawUnsafe(`
    select m.id, m.previous_balance, m.balance, m.status from monthly_records m
    join contracts c on c.id = m.contract_id join tenants t on t.id = c.tenant_id
    where t.name ilike 'Ciuro Felipe%' and m.period_month = 8 and m.period_year = 2026`))[0];
  // El recálculo arranca en JULIO: el saldo a favor de agosto se deriva del cierre de julio.
  const julio = (await prisma.$queryRawUnsafe(`
    select m.id from monthly_records m
    join contracts c on c.id = m.contract_id join tenants t on t.id = c.tenant_id
    where t.name ilike 'Ciuro Felipe%' and m.period_month = 7 and m.period_year = 2026`))[0];
  if (!rec || !julio) { console.log('  no encontrado'); return; }
  console.log(`  hoy: a favor anterior ${money(rec.previous_balance)}, saldo ${money(rec.balance)}, ${rec.status}`);
  const mode = APPLY.has('ciuro-cobrar') ? 'cobrar' : (APPLY.has('ciuro-condonar') ? 'condonar' : null);
  if (!mode) { console.log('  (dry-run) recalcular deja agosto debiendo la diferencia: elegir ciuro-cobrar o ciuro-condonar'); return; }
  await recalculateMultipleRecords([julio.id], null, true);
  const after = await prisma.monthlyRecord.findUnique({ where: { id: rec.id } });
  console.log(`  recalculado: a favor anterior ${money(after.previousBalance)}, saldo ${money(after.balance)}, ${after.status}`);
  if (mode === 'condonar' && after.balance < -1) {
    await prisma.monthlyRecord.update({ where: { id: rec.id }, data: { balanceForgiven: round2(-after.balance), balanceForgivenAt: new Date() } });
    await recalculateMultipleRecords([rec.id], null, true);
    console.log(`  ✓ condonados ${money(-after.balance)}`);
  }
}

async function recalcular() {
  console.log('\n=== Recalcular todos los contratos ===');
  const firsts = await prisma.$queryRawUnsafe('select distinct on (contract_id) id from monthly_records order by contract_id, month_number');
  console.log(`  ${firsts.length} contratos`);
  if (!APPLY.has('recalcular')) return;
  if (!APPLY.has('ciuro-cobrar') && !APPLY.has('ciuro-condonar')) {
    console.log('  ✗ No se recalcula: recalcular todo deja a Ciuro agosto debiendo. Elegí antes ciuro-cobrar o ciuro-condonar.');
    return;
  }
  let errs = 0;
  for (const f of firsts) {
    try { await recalculateMultipleRecords([f.id], null, true); } catch (e) { errs++; console.error(`   ✗ ${f.id}: ${e.message}`); }
  }
  console.log(`  ✓ recalculados (${errs} errores)`);
}

async function condonacionesIncompletas() {
  console.log('\n=== Meses condonados que igual siguen debiendo ===');
  // La condonación se calculó con una versión vieja del motor y no alcanza a cubrir el saldo
  // de hoy. "completar-condonaciones" la lleva al saldo actual (el mes queda saldado).
  const rows = await prisma.$queryRawUnsafe(`
    select m.id, t.name, m.period_month, m.period_year, m.balance, m.balance_forgiven, c.active
    from monthly_records m join contracts c on c.id = m.contract_id
    left join tenants t on t.id = c.tenant_id
    where m.balance_forgiven > 0 and m.balance + m.balance_forgiven < -1
    order by t.name, m.period_year, m.period_month`);
  rows.forEach((r) => console.log(`   - ${(r.name || '').trim()} ${r.period_month}/${r.period_year}${r.active ? '' : ' (contrato inactivo)'} · condonado ${money(r.balance_forgiven)} · sigue debiendo ${money(-(r.balance + r.balance_forgiven))}`));
  if (!APPLY.has('completar-condonaciones')) return;
  for (const r of rows) {
    await prisma.monthlyRecord.update({ where: { id: r.id }, data: { balanceForgiven: round2(-r.balance) } });
    await recalculateMultipleRecords([r.id], null, true);
  }
  console.log(`  ✓ ${rows.length} condonaciones completadas`);
}

(async () => {
  if (new Date().getTimezoneOffset() !== 0) throw new Error('Correr con TZ=UTC (producción corre en UTC).');
  console.log(APPLY.size ? `APLICANDO: ${[...APPLY].join(', ')}` : 'DRY-RUN (no escribe nada)');
  await feriados();
  await postRescision();
  await condonadas();
  await ciuro();
  await recalcular();
  await condonacionesIncompletas();
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
