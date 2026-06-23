/*
 * Simulación de cobertura completa: 20 contratos diversos × 4 meses (Ene–Abr 2026).
 * Ejercita TODOS los casos contra el service layer REAL y valida con asserts +
 * invariant scan. Corre contra una base LOCAL postgres (no prod).
 *
 * Run:
 *   DATABASE_URL=postgresql://postgres:sim@localhost:55432/simdb \
 *     node -r ./sim/clock.js sim/full-coverage.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const mrSvc = require('../src/services/monthlyRecordService');
const svcSvc = require('../src/services/monthlyServiceService');
const paySvc = require('../src/services/paymentTransactionService');
const closeSvc = require('../src/services/monthlyCloseService');
const debtSvc = require('../src/services/debtService');
const reportSvc = require('../src/services/reportDataService');
const { calculatePunitoryV2, getHolidaysForYear } = require('../src/utils/punitory');

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n) => (n == null ? 'null' : Number(n).toLocaleString('es-AR'));

// ---------- resultado / report ----------
const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, ok: !!cond, detail });
  if (!cond) console.log(`   ❌ ${name} ${detail}`);
}
function info(msg) { console.log(`   · ${msg}`); }

async function flush() {
  // registerPayment/payDebt marcan dirty + setImmediate(processDirtyRecords).
  // Forzamos el drenaje para tener estado determinista antes de asertar.
  await new Promise((r) => setTimeout(r, 30));
  await mrSvc.processDirtyRecords();
  await new Promise((r) => setTimeout(r, 30));
  await mrSvc.processDirtyRecords();
}

const GID = 'sim-group';
let CT = {}; // concept types por categoría
const C = {}; // contratos por key

// ---------------- setup ----------------
async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      payment_transactions, debt_payments, debts, monthly_services, monthly_records,
      rent_history, contract_tenants, contracts, tenants, properties, owners,
      concept_types, categories, adjustment_indices, user_groups, groups, users
    RESTART IDENTITY CASCADE;
  `);
}

async function seed() {
  const user = await prisma.user.create({
    data: { id: 'sim-user', email: 'sim@test.com', name: 'Sim', passwordHash: 'x', globalRole: 'USER' },
  });
  await prisma.group.create({
    data: { id: GID, name: 'Sim Group', slug: 'sim-group', punitoryRate: 0.006, companyName: 'Inmobiliaria Sim', cuit: '30-11111111-1' },
  });
  await prisma.userGroup.create({ data: { userId: user.id, groupId: GID, role: 'ADMIN' } });

  const mkCT = async (name, category) =>
    (await prisma.conceptType.create({ data: { groupId: GID, name, label: name, category } })).id;
  CT.LUZ = await mkCT('LUZ', 'SERVICIO');
  CT.MUNI = await mkCT('MUNICIPALIDAD', 'IMPUESTO');
  CT.EXPENSAS = await mkCT('EXPENSAS', 'GASTO');
  CT.DESCUENTO = await mkCT('DESCUENTO', 'DESCUENTO');
  CT.BONIF = await mkCT('BONIFICACION', 'BONIFICACION');

  // índice de ajuste (para C15)
  const adj = await prisma.adjustmentIndex.create({
    data: { groupId: GID, name: 'TRIMESTRAL', frequencyMonths: 3, indexType: 'PERCENTAGE' },
  }).catch(async () => {
    // fallback si el modelo tiene otros campos requeridos
    return prisma.adjustmentIndex.create({ data: { groupId: GID, name: 'TRIMESTRAL', frequencyMonths: 3 } });
  });
  CT.adjId = adj.id;
}

// ---------------- contratos ----------------
// startMonth=1, startDate Ene 2026 → monthNumber: Ene=1,Feb=2,Mar=3,Abr=4
async function createContract(key, opts = {}) {
  const {
    baseRent, pagaIva = false, punitoryStartDay = 4, punitoryGraceDay = 10, punitoryPercent = 0.006,
    comprobantes = [], services = [],
  } = opts;
  const prop = await prisma.property.create({
    data: { groupId: GID, address: `Calle ${key} 123` },
  });
  const tenant = await prisma.tenant.create({
    data: { groupId: GID, name: `Inquilino ${key}`, dni: `DNI-${key}` },
  });
  const contract = await prisma.contract.create({
    data: {
      groupId: GID, tenantId: tenant.id, propertyId: prop.id, contractType: 'INQUILINO',
      startDate: new Date(2026, 0, 1), startMonth: 1, durationMonths: 24, currentMonth: 1,
      baseRent, punitoryStartDay, punitoryGraceDay, punitoryPercent, pagaIva,
      comprobantes,
      contractTenants: { create: [{ tenantId: tenant.id, isPrimary: true }] },
    },
  });
  await prisma.rentHistory.create({
    data: { contractId: contract.id, effectiveFromMonth: 1, rentAmount: baseRent, reason: 'INICIAL' },
  });
  C[key] = { id: contract.id, ...opts };
  return contract;
}

async function setupContracts() {
  await createContract('C01_full_ontime', { baseRent: 300000 });
  await createContract('C02_full_services', { baseRent: 320000, services: [['LUZ', 15000], ['MUNI', 8000]] });
  await createContract('C03_iva', { baseRent: 500000, pagaIva: true });
  await createContract('C04_late_punit', { baseRent: 280000 });
  await createContract('C05_partial', { baseRent: 350000 });
  await createContract('C06_none', { baseRent: 290000 });
  await createContract('C07_multi_same_month', { baseRent: 400000 });
  await createContract('C08_overpay', { baseRent: 260000 });
  await createContract('C09_debt_pay_full', { baseRent: 310000 });
  await createContract('C10_debt_multi_install', { baseRent: 330000 });
  await createContract('C11_discount', { baseRent: 300000, services: [['LUZ', 10000], ['DESCUENTO', 20000]] });
  await createContract('C12_bonif', { baseRent: 300000, services: [['BONIF', 25000]] });
  await createContract('C13_forgive', { baseRent: 270000 });
  await createContract('C14_comprobantes', { baseRent: 340000, comprobantes: ['RECIBO_SUELDO', 'SEGURO'] });
  await createContract('C15_adjustment', { baseRent: 300000 });
  await createContract('C16_mixed', { baseRent: 360000, services: [['EXPENSAS', 30000]] });
  await createContract('C17_high_late', { baseRent: 800000, punitoryPercent: 0.006 });
  await createContract('C18_two_debts', { baseRent: 250000 });
  await createContract('C19_credit_consume', { baseRent: 300000 });
  await createContract('C20_everything', { baseRent: 450000, pagaIva: true, comprobantes: ['RECIBO'], services: [['LUZ', 12000], ['MUNI', 6000]] });
  await createContract('C21_credit_to_debt', { baseRent: 300000 }); // sobrepaga mes 1 → crédito; mes 2 no paga → deuda con crédito aplicado

  // C15: ajuste de alquiler a partir del mes 3 (Marzo) → 360000
  await prisma.rentHistory.create({
    data: { contractId: C.C15_adjustment.id, effectiveFromMonth: 3, rentAmount: 360000, adjustmentPercent: 20, reason: 'AJUSTE' },
  });
}

// ---------------- helpers de operación ----------------
async function recordFor(key, year, month) {
  return prisma.monthlyRecord.findFirst({
    where: { contractId: C[key].id, periodMonth: month, periodYear: year },
    include: { services: { include: { conceptType: true } }, transactions: { include: { concepts: true } }, debt: true },
  });
}
function netOwed(rec) {
  // alquiler + servicios (neto, con desc/bonif) + iva, sin punitorios, sin prevBalance
  let services = 0;
  for (const s of rec.services) {
    const cat = s.conceptType.category;
    if (cat === 'DESCUENTO' || cat === 'BONIFICACION') services -= Math.abs(s.amount);
    else services += s.amount;
  }
  const iva = rec.includeIva ? rec.rentAmount * 0.21 : 0;
  return r2(rec.rentAmount + services + iva);
}
async function pay(key, year, month, amount, day, opts = {}) {
  global.__setNow(year, month, day);
  const rec = await recordFor(key, year, month);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try {
    await paySvc.registerPayment(GID, rec.id, { paymentDate: date, amount: r2(amount), paymentMethod: 'EFECTIVO', ...opts });
  } catch (e) {
    if (e.code === 'DEBT_BLOCK' || /pagar primero/i.test(e.message)) { info(`${key} ${MN[month]}: bloqueado por deuda anterior (esperado)`); return null; }
    throw e;
  }
  await flush();
  return rec;
}

// Paga la deuda más vieja (base alquiler/servicios + punitorios) en su totalidad.
async function settleOldestDebtFull(key, payYear, payMonth, day, note = 'sim settle') {
  const d = await oldestDebt(key);
  if (!d) return null;
  global.__setNow(payYear, payMonth, day);
  const pd = `${payYear}-${String(payMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const cur = await debtSvc.calculateDebtPunitory(d, pd, null, true);
  const full = r2(cur.remainingDebt + cur.amount);
  await debtSvc.payDebt(d.id, full, pd, 'EFECTIVO', note);
  await flush();
  return full;
}
async function punitPreview(recId, date) {
  const prev = await paySvc.calculatePunitoryPreview(recId, date);
  return prev?.amount ?? prev?.punitoryAmount ?? 0;
}
async function payFullLate(key, year, month, day) {
  global.__setNow(year, month, day);
  const rec = await recordFor(key, year, month);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  await pay(key, year, month, netOwed(rec) + (await punitPreview(rec.id, date)), day);
}
// Paga el neto + una fracción de los punitorios (deja punitorios pendientes a propósito).
async function payNetPlusPunitFraction(key, year, month, day, frac) {
  global.__setNow(year, month, day);
  const rec = await recordFor(key, year, month);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  await pay(key, year, month, netOwed(rec) + r2((await punitPreview(rec.id, date)) * frac), day);
}
// Paga exactamente lo que falta (neto restante + punitorios pendientes).
async function payRemainingLate(key, year, month, day) {
  global.__setNow(year, month, day);
  const rec = await recordFor(key, year, month);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const remainingNet = Math.max(netOwed(rec) - r2(rec.amountPaid), 0);
  await pay(key, year, month, r2(remainingNet + (await punitPreview(rec.id, date))), day);
}

const MONTHS = [[2026, 1], [2026, 2], [2026, 3], [2026, 4]];
const MN = { 1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril' };

// ---------------- driver ----------------
async function run() {
  console.log('=== SETUP ===');
  await reset();
  await seed();
  await setupContracts();
  info(`${Object.keys(C).length} contratos creados`);

  for (let i = 0; i < MONTHS.length; i++) {
    const [y, m] = MONTHS[i];
    console.log(`\n===== ${MN[m]} ${y} (mes ${i + 1}) =====`);

    // 1) generar registros del mes
    global.__setNow(y, m, 1);
    await mrSvc.getOrCreateMonthlyRecords(GID, m, y);

    // 2) asignar servicios (solo el primer mes, salvo recurrentes — los asignamos cada mes)
    for (const [key, cfg] of Object.entries(C)) {
      for (const [cname, amount] of (cfg.services || [])) {
        await svcSvc.bulkAssign(GID, cfg.id, CT[cname], amount, [{ month: m, year: y }], `sim ${cname}`);
      }
    }
    await flush();

    // 3) pagos del mes según escenario
    await doMonthPayments(y, m, i);
    await flush();

    // 4) cerrar mes (genera deudas de lo impago)
    global.__setNow(y, m, 28);
    const close = await closeSvc.closeMonth(GID, m, y);
    info(`cierre ${MN[m]}: ${close.debtsCreated} deudas generadas`);
    await flush();

    // 5) pagos de deuda (al mes siguiente, tras cerrar el anterior)
    await doDebtPayments(y, m, i);
    await flush();
  }

  console.log('\n===== VERIFICACIÓN =====');
  await verifyAll();
  await verifyReports();
  await verifyEnrichedHistorico();
  await invariantScan();

  // ---------- resumen ----------
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n================ RESULTADO ================`);
  console.log(`Checks: ${checks.length} | OK: ${checks.length - failed.length} | FALLOS: ${failed.length}`);
  if (failed.length) {
    console.log('\nFALLOS:');
    for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`);
  } else {
    console.log('✅ TODO OK — 100% de los checks pasaron.');
  }
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

// pagos por mes (i = índice de mes 0..3)
async function doMonthPayments(y, m, i) {
  const net = async (key) => netOwed(await recordFor(key, y, m));

  // C01: full on time todos los meses
  await pay('C01_full_ontime', y, m, await net('C01_full_ontime'), 5);
  // C02: full on time + servicios
  await pay('C02_full_services', y, m, await net('C02_full_services'), 5);
  // C03: IVA, full on time
  await pay('C03_iva', y, m, await net('C03_iva'), 5);
  // C04: full pero tarde (punitorios)
  await payFullLate('C04_late_punit', y, m, 25);
  // C05: pago parcial (50%)
  await pay('C05_partial', y, m, r2((await net('C05_partial')) * 0.5), 8);
  // C06: no paga (deuda)
  // C07: dos pagos tarde con punitorios en AMBOS → reproduce el caso del bug (2 conceptos
  // PUNITORIOS en un mismo registro) y verifica que NO genera saldo a favor falso.
  await payNetPlusPunitFraction('C07_multi_same_month', y, m, 15, 0.5); // neto + mitad de punitorios
  await payRemainingLate('C07_multi_same_month', y, m, 26);             // resto de punitorios
  // C08: sobrepago mes 1 (genera saldo a favor real); luego full on time
  if (i === 0) await pay('C08_overpay', y, m, (await net('C08_overpay')) + 50000, 5);
  else await pay('C08_overpay', y, m, await net('C08_overpay'), 5);
  // C09/C10: no pagan (deuda); se pagan en doDebtPayments
  // C11: descuento, full on time
  await pay('C11_discount', y, m, await net('C11_discount'), 5);
  // C12: bonificación, full on time
  await pay('C12_bonif', y, m, await net('C12_bonif'), 5);
  // C13: tarde pero condona punitorios
  {
    const rec = await recordFor('C13_forgive', y, m);
    await pay('C13_forgive', y, m, netOwed(rec), 25, { forgivePunitorios: true });
  }
  // C14: comprobantes, full on time
  await pay('C14_comprobantes', y, m, await net('C14_comprobantes'), 5);
  // C15: ajuste, full on time (rent sube en mes 3)
  await pay('C15_adjustment', y, m, await net('C15_adjustment'), 5);
  // C16: mixto — parcial meses pares, full impares
  if (i % 2 === 0) await pay('C16_mixed', y, m, await net('C16_mixed'), 5);
  else await pay('C16_mixed', y, m, r2((await net('C16_mixed')) * 0.4), 8);
  // C17: alquiler alto, paga tarde full
  await payFullLate('C17_high_late', y, m, 25);
  // C18: no paga meses 1 y 2 (dos deudas); paga full meses 3 y 4
  if (i >= 2) await pay('C18_two_debts', y, m, await net('C18_two_debts'), 5);
  // C19: sobrepago grande mes 1 (cubre mes 2 completo), mes 2 no paga, luego full
  if (i === 0) await pay('C19_credit_consume', y, m, (await net('C19_credit_consume')) + 350000, 5);
  else if (i === 1) { /* no paga: el crédito del mes anterior lo cubre */ }
  else await pay('C19_credit_consume', y, m, await net('C19_credit_consume'), 5);
  // C20: todo junto — mes par parcial, impar full late
  if (i % 2 === 0) await payFullLate('C20_everything', y, m, 25);
  else await pay('C20_everything', y, m, r2((await net('C20_everything')) * 0.5), 8);
  // C21: mes 1 sobrepaga (+100000 crédito); mes 2 NO paga → deuda con saldo a favor aplicado
  if (i === 0) await pay('C21_credit_to_debt', y, m, (await net('C21_credit_to_debt')) + 100000, 5);
  // meses 2-4: no paga (queda deuda con el crédito aplicado al total, punitorios sobre alquiler completo)
}

// pagos de deuda — se ejecutan después de cerrar el mes `m`
async function doDebtPayments(y, m, i) {
  // C09: tras cerrar mes 1, pagar la deuda completa
  if (i === 0) {
    const d = await oldestDebt('C09_debt_pay_full');
    if (d) {
      global.__setNow(y, m + 1 > 12 ? 1 : m + 1, 15);
      const pd = `${y}-${String(m + 1).padStart(2, '0')}-15`;
      const cur = await debtSvc.calculateDebtPunitory(d, pd, null, true);
      const full = r2(cur.remainingDebt + cur.amount);
      await debtSvc.payDebt(d.id, full, pd, 'EFECTIVO', 'sim full deuda');
      info(`C09: deuda pagada full = ${fmt(full)} (base ${fmt(cur.remainingDebt)} + punit ${fmt(cur.amount)})`);
    }
  }
  // C10: tras cerrar mes 1, pagar en 2 tandas: primero el alquiler, luego los punitorios
  if (i === 0) {
    const d = await oldestDebt('C10_debt_multi_install');
    if (d) {
      const mm = m + 1;
      // tanda 1: alquiler + parte de los punitorios (deja punitorios pendientes).
      // Esto crea un registro con DOS transacciones que llevan PUNITORIOS → reproduce
      // exactamente la forma del bug (caso Ponce) y valida que balance queda en 0.
      global.__setNow(y, mm, 15);
      const pd1 = `${y}-${String(mm).padStart(2, '0')}-15`;
      const cur1 = await debtSvc.calculateDebtPunitory(d, pd1, null, true);
      await debtSvc.payDebt(d.id, r2(d.unpaidRentAmount + cur1.amount * 0.6), pd1, 'EFECTIVO', 'sim tanda1 alquiler+punit');
      await flush();
      // tanda 2: los punitorios pendientes (sobre el saldo pendiente, no sobre el total)
      const d2 = await prisma.debt.findUnique({ where: { id: d.id } });
      global.__setNow(y, mm, 25);
      const pd2 = `${y}-${String(mm).padStart(2, '0')}-25`;
      const cur2 = await debtSvc.calculateDebtPunitory(d2, pd2, null, true);
      C.C10_debt_multi_install._install2Punit = cur2.amount;
      await debtSvc.payDebt(d2.id, cur2.amount, pd2, 'EFECTIVO', 'sim tanda2 punitorios');
      info(`C10: tanda2 punitorios sobre pendiente = ${fmt(cur2.amount)}`);
    }
  }
  // Partial-payers: saldar la deuda más vieja antes del próximo mes (para no quedar bloqueados).
  // Se deja la deuda del último mes (i=3) sin saldar para cubrir el caso "deuda abierta al final".
  if (i < 3) {
    for (const key of ['C05_partial', 'C16_mixed', 'C20_everything']) {
      const settled = await settleOldestDebtFull(key, y, m + 1 > 12 ? 1 : m + 1, 3, `sim settle ${key}`);
      if (settled) info(`${key}: deuda saldada = ${fmt(settled)}`);
    }
  }

  // C18: dos deudas (mes1 y mes2). Tras cerrar mes2, intentar pagar la MÁS NUEVA primero (debe bloquear)
  if (i === 1) {
    const debts = await debtSvc.getOpenDebts(GID, C.C18_two_debts.id);
    if (debts.length >= 2) {
      const sorted = [...debts].sort((a, b) => (a.periodYear * 12 + a.periodMonth) - (b.periodYear * 12 + b.periodMonth));
      const newer = sorted[sorted.length - 1];
      global.__setNow(y, 3, 15);
      let blocked = false;
      try {
        await debtSvc.payDebt(newer.id, 1000, '2026-03-15', 'EFECTIVO', 'sim intento fuera de orden');
      } catch (e) { blocked = e.code === 'ORDER_BLOCK' || /primero/i.test(e.message); }
      check('C18: orden cronológico bloquea pagar deuda más nueva primero', blocked, blocked ? '' : 'no bloqueó');
      // ahora pagar la MÁS VIEJA (Enero) — permitido
      const s1 = await settleOldestDebtFull('C18_two_debts', 2026, 3, 4, 'sim C18 oldest');
      if (s1) info(`C18: deuda Enero saldada = ${fmt(s1)}`);
    }
  }
  // C18: al mes siguiente, saldar la que quedó (Febrero)
  if (i === 2) {
    const s2 = await settleOldestDebtFull('C18_two_debts', 2026, 4, 4, 'sim C18 next');
    if (s2) info(`C18: deuda Febrero saldada = ${fmt(s2)}`);
  }
}

async function oldestDebt(key) {
  const debts = await debtSvc.getOpenDebts(GID, C[key].id);
  if (!debts.length) return null;
  return [...debts].sort((a, b) => (a.periodYear * 12 + a.periodMonth) - (b.periodYear * 12 + b.periodMonth))[0];
}

// ---------------- verificaciones ----------------
async function verifyAll() {
  const recs = await prisma.monthlyRecord.findMany({
    where: { groupId: GID },
    include: { services: { include: { conceptType: true } }, transactions: { include: { concepts: true } }, debt: true, contract: true },
    orderBy: [{ contractId: 'asc' }, { monthNumber: 'asc' }],
  });

  for (const r of recs) {
    const tag = `${r.contract ? labelOf(r.contractId) : '?'} ${MN[r.periodMonth]}`;
    // servicios
    let servicesTotal = 0;
    for (const s of r.services) {
      const cat = s.conceptType.category;
      if (cat === 'DESCUENTO' || cat === 'BONIFICACION') servicesTotal -= Math.abs(s.amount);
      else servicesTotal += s.amount;
    }
    const amountPaid = r2(r.transactions.reduce((a, t) => a + t.amount, 0));
    const totalPunitory = r2(r.transactions.reduce((a, t) => {
      if (t.punitoryForgiven) return a;
      return a + t.concepts.filter((c) => c.type === 'PUNITORIOS').reduce((s, c) => s + c.amount, 0);
    }, 0));
    const iva = r.includeIva ? r.rentAmount * 0.21 : 0;
    const expTotalDue = r2(Math.max(r.rentAmount + servicesTotal + totalPunitory + iva - r.previousBalance, 0));
    const expBalance = r2(amountPaid - expTotalDue);

    // A) totalDue correcto (suma punitorios de TODAS las tx)
    check(`[${tag}] totalDue = renta+serv+punit(todas)+iva-prevBal`, Math.abs(r2(r.totalDue) - expTotalDue) <= 1,
      `stored=${fmt(r.totalDue)} esperado=${fmt(expTotalDue)}`);
    // B) balance = amountPaid - totalDue
    check(`[${tag}] balance = pagado - totalDue`, Math.abs(r2(r.balance) - expBalance) <= 1,
      `stored=${fmt(r.balance)} esperado=${fmt(expBalance)}`);
    // C) amountPaid coincide con la suma de transacciones
    check(`[${tag}] amountPaid = suma transacciones`, Math.abs(r2(r.amountPaid) - amountPaid) <= 1,
      `stored=${fmt(r.amountPaid)} txsum=${fmt(amountPaid)}`);
    // D) status COMPLETE ⇒ cubre totalDue
    if (r.status === 'COMPLETE') check(`[${tag}] COMPLETE cubre totalDue`, amountPaid + 1 >= r.totalDue, `pagado=${fmt(amountPaid)} due=${fmt(r.totalDue)}`);
    // E) punitorios no negativos
    check(`[${tag}] punitorios >= 0`, (r.punitoryAmount || 0) >= -0.01, `${fmt(r.punitoryAmount)}`);
  }

  // F) NO saldo a favor falso: balance>1 sólo en contratos con sobrepago real (C08, C19)
  const creditAllowed = new Set([C.C08_overpay.id, C.C19_credit_consume.id, C.C21_credit_to_debt.id]);
  for (const r of recs) {
    if (r2(r.balance) > 1) {
      check(`[${labelOf(r.contractId)} ${MN[r.periodMonth]}] saldo a favor sólo si sobrepago real`,
        creditAllowed.has(r.contractId), `balance=${fmt(r.balance)} (contrato no debía tener crédito)`);
    }
  }

  // --- casos puntuales ---
  // C07: pagó todo (en 2 tandas con punitorios) → balance ~0, status COMPLETE, sin crédito falso
  {
    for (const [y, m] of MONTHS) {
      const r = await recordFor('C07_multi_same_month', y, m);
      const punTx = r.transactions.filter((t) => t.concepts.some((c) => c.type === 'PUNITORIOS')).length;
      check(`C07 ${MN[m]}: 2 pagos con punitorios y balance≈0 (sin crédito falso)`, punTx >= 2 && Math.abs(r2(r.balance)) <= 1,
        `punTx=${punTx} balance=${fmt(r.balance)}`);
    }
  }
  // C08: mes 1 sobrepago +50000 → mes 2 previousBalance = 50000
  {
    const m2 = await recordFor('C08_overpay', 2026, 2);
    check('C08: crédito real se propaga al mes siguiente', Math.abs(r2(m2.previousBalance) - 50000) <= 1, `prevBal=${fmt(m2.previousBalance)}`);
  }
  // C09: deuda pagada full → debt PAID, currentTotal 0
  {
    const d = await prisma.debt.findFirst({ where: { contractId: C.C09_debt_pay_full.id } });
    check('C09: deuda saldada (PAID, total 0)', d && d.status === 'PAID' && r2(d.currentTotal) <= 1, d ? `status=${d.status} total=${fmt(d.currentTotal)}` : 'sin deuda');
  }
  // C10: la 2da tanda de punitorios fue chica (sobre saldo pendiente, no sobre el total acumulado)
  {
    const d = await prisma.debt.findFirst({ where: { contractId: C.C10_debt_multi_install.id } });
    const install2 = C.C10_debt_multi_install._install2Punit || 0;
    // punitorios sobre ~0 base de alquiler (ya pagado) → debe ser una fracción del alquiler, no múltiplos
    check('C10: punitorios 2da tanda sobre saldo pendiente (no sobre total)', install2 < C.C10_debt_multi_install.baseRent * 0.5,
      `install2=${fmt(install2)} (baseRent=${fmt(C.C10_debt_multi_install.baseRent)})`);
    check('C10: deuda finalmente saldada', d && d.status === 'PAID', d ? `status=${d.status}` : 'sin deuda');
    // el registro de Enero quedó con 2 transacciones que llevan PUNITORIOS y balance 0
    // (este es exactamente el bug del Control Mensual: NO debe generar saldo a favor falso)
    const recJan = await recordFor('C10_debt_multi_install', 2026, 1);
    const punTx = recJan.transactions.filter((t) => t.concepts.some((c) => c.type === 'PUNITORIOS')).length;
    check('C10: registro Enero con 2 tx de punitorios y SIN saldo a favor falso', punTx >= 2 && r2(recJan.balance) <= 1,
      `punTx=${punTx} balance=${fmt(recJan.balance)}`);
  }
  // C13: punitorios condonados → record.punitoryForgiven o punitoryAmount 0 pese a pago tarde
  {
    const r = await recordFor('C13_forgive', 2026, 1);
    const punTotal = r2(r.transactions.reduce((a, t) => a + (t.punitoryForgiven ? 0 : t.concepts.filter((c) => c.type === 'PUNITORIOS').reduce((s, c) => s + c.amount, 0)), 0));
    check('C13: punitorios condonados (0 cobrados pese a pago tarde)', punTotal <= 0.01 && Math.abs(r2(r.balance)) <= 1, `punit=${fmt(punTotal)} balance=${fmt(r.balance)}`);
  }
  // C14: comprobantesStatus presente
  {
    const r = await recordFor('C14_comprobantes', 2026, 1);
    const have = Array.isArray(r.comprobantesStatus) && r.comprobantesStatus.length === 2;
    check('C14: comprobantesStatus presente (2)', have, `=${JSON.stringify(r.comprobantesStatus)}`);
  }
  // C15: ajuste de alquiler aplicado en mes 3
  {
    const m2 = await recordFor('C15_adjustment', 2026, 2);
    const m3 = await recordFor('C15_adjustment', 2026, 3);
    check('C15: rent sube en mes 3 (ajuste)', r2(m2.rentAmount) === 300000 && r2(m3.rentAmount) === 360000, `m2=${fmt(m2.rentAmount)} m3=${fmt(m3.rentAmount)}`);
  }
  // C04/C17: pago tarde generó punitorios > 0 y balance ~0
  for (const key of ['C04_late_punit', 'C17_high_late']) {
    const r = await recordFor(key, 2026, 1);
    const punTotal = r2(r.transactions.reduce((a, t) => a + t.concepts.filter((c) => c.type === 'PUNITORIOS').reduce((s, c) => s + c.amount, 0), 0));
    check(`${key} mes1: punitorios>0 y balance≈0`, punTotal > 0 && Math.abs(r2(r.balance)) <= 1, `punit=${fmt(punTotal)} balance=${fmt(r.balance)}`);
  }
  // C06: nunca paga → deudas creadas
  {
    const debts = await prisma.debt.count({ where: { contractId: C.C06_none.id } });
    check('C06: genera deudas (nunca paga)', debts >= 1, `deudas=${debts}`);
  }
  // C21: saldo a favor (100000) NO reduce la base de punitorios; se aplica al total.
  // La deuda de Febrero debe tener unpaidRentAmount = alquiler COMPLETO (300000) y
  // appliedCredit ≈ 100000, con punitorios calculados sobre el alquiler completo.
  {
    const feb = await recordFor('C21_credit_to_debt', 2026, 2);
    const d = feb.debt;
    check('C21: deuda con base de alquiler COMPLETA (crédito no reduce la base)', d && Math.abs(r2(d.unpaidRentAmount) - 300000) <= 1,
      d ? `unpaidRent=${fmt(d.unpaidRentAmount)} (esperado 300000)` : 'sin deuda Febrero');
    check('C21: saldo a favor aplicado al total (appliedCredit≈100000)', d && Math.abs(r2(d.appliedCredit) - 100000) <= 1,
      d ? `appliedCredit=${fmt(d.appliedCredit)}` : 'sin deuda');
    // punitorios deben calcularse sobre 300000 (no sobre 200000): comparar con la base reducida
    if (d) {
      const cur = await debtSvc.calculateDebtPunitory(d, '2026-06-22', null, true);
      const punitFull = r2(300000 * 0.006 * (cur.days || 0));
      const punitReduced = r2(200000 * 0.006 * (cur.days || 0));
      check('C21: punitorios sobre alquiler completo, no sobre (alquiler-crédito)',
        Math.abs(r2(cur.amount) - punitFull) <= Math.abs(r2(cur.amount) - punitReduced),
        `punit=${fmt(cur.amount)} full=${fmt(punitFull)} reducido=${fmt(punitReduced)}`);
    }
  }
}

let _labelCache = null;
function labelOf(contractId) {
  if (!_labelCache) { _labelCache = {}; for (const [k, v] of Object.entries(C)) _labelCache[v.id] = k; }
  return _labelCache[contractId] || contractId.slice(0, 6);
}

// ---------------- reportes ----------------
async function verifyReports() {
  // Control Mensual de cada mes
  for (const [y, m] of MONTHS) {
    try {
      const data = await reportSvc.getControlMensualData(GID, m, y);
      const rows = data?.registros;
      check(`Reporte Control Mensual ${MN[m]} corre y trae filas`, !!rows && rows.length >= 1, `rows=${rows ? rows.length : 'null'}`);
      // cross-check: total del reporte = suma de totalDue de los registros del mes
      if (rows && data.totales) {
        const recsMes = await prisma.monthlyRecord.findMany({ where: { groupId: GID, periodMonth: m, periodYear: y }, select: { totalDue: true } });
        const sumDue = r2(recsMes.reduce((a, r) => a + (r.totalDue || 0), 0));
        check(`Control Mensual ${MN[m]}: total reporte ≈ suma totalDue`, Math.abs(r2(data.totales.total) - sumDue) <= 5, `reporte=${fmt(data.totales.total)} suma=${fmt(sumDue)}`);
      }
    } catch (e) { check(`Reporte Control Mensual ${MN[m]}`, false, e.message); }
  }
  // Liquidación de un par de contratos
  for (const key of ['C03_iva', 'C04_late_punit', 'C20_everything']) {
    try {
      const liq = await reportSvc.getLiquidacionData(GID, C[key].id, 1, 2026);
      check(`Reporte Liquidación ${key} corre`, !!liq, '');
    } catch (e) { check(`Reporte Liquidación ${key}`, false, e.message); }
  }
  // Detalle de pago (getPagoEfectivoFromRecord) — punitorios y conceptos correctos
  for (const key of ['C04_late_punit', 'C07_multi_same_month', 'C02_full_services']) {
    const rec = await recordFor(key, 2026, 1);
    if (!rec) continue;
    try {
      const detail = await reportSvc.getPagoEfectivoFromRecord(GID, rec.id);
      check(`Detalle de pago ${key} corre y devuelve datos`, !!detail, '');
      // si hubo punitorios en el registro, deben figurar en el detalle
      const recPunit = r2(rec.transactions.reduce((a, t) => a + t.concepts.filter((c) => c.type === 'PUNITORIOS').reduce((s, c) => s + c.amount, 0), 0));
      if (recPunit > 0) {
        const blob = JSON.stringify(detail).toLowerCase();
        check(`Detalle de pago ${key} muestra punitorios`, blob.includes('punitor'), 'no aparece punitorios en el detalle');
      }
    } catch (e) { check(`Detalle de pago ${key}`, false, e.message); }
  }
  // Estado de cuentas
  try {
    const ec = await reportSvc.getEstadoCuentasData(GID, C.C05_partial.id);
    check('Reporte Estado de Cuentas corre', !!ec, '');
  } catch (e) { check('Reporte Estado de Cuentas', false, e.message); }
}

// ---------------- campos "histórico" del Control Mensual (front) ----------------
// El front usa getOrCreateMonthlyRecords (enriquecido): totalHistorico, punitoriosAnteriores,
// punitoriosActuales, aFavorNextMonth, debeNextMonth. Verifica que no haya doble conteo de
// punitorios ni "total" inflado por sobrepago, y que el saldo a favor mostrado sea real.
async function verifyEnrichedHistorico() {
  const creditAllowed = new Set([C.C08_overpay.id, C.C19_credit_consume.id]);
  for (const [y, m] of MONTHS) {
    const recs = await mrSvc.getOrCreateMonthlyRecords(GID, m, y);
    await flush();
    for (const r of recs) {
      const tag = `${labelOf(r.contractId)} ${MN[m]}`;
      const iva = r.includeIva ? r.rentAmount * 0.21 : 0;
      // 1) totalHistorico = alquiler + servicios + iva + punitorios totales - aFavorAnt (lo ADEUDADO)
      const expHist = Math.max(r2(r.rentAmount + r.servicesTotal + (r.totalPunitoriosHistoricos || 0) + iva - r.previousBalance), 0);
      check(`[${tag}] totalHistorico = adeudado (no incluye sobrepago)`, Math.abs(r2(r.totalHistorico) - expHist) <= 2,
        `hist=${fmt(r.totalHistorico)} esperado=${fmt(expHist)}`);
      // 2) sin doble conteo: para records con deuda, punitoriosAnteriores = accumulated de la deuda
      if (r.debt) {
        check(`[${tag}] punitoriosAnteriores = acumulado deuda (sin duplicar)`, Math.abs(r2(r.punitoriosAnteriores) - r2(r.debt.accumulatedPunitory || 0)) <= 2,
          `ant=${fmt(r.punitoriosAnteriores)} accum=${fmt(r.debt.accumulatedPunitory)}`);
      }
      // 3) saldo a favor mostrado (aFavorNextMonth) sólo si sobrepago real
      if ((r.aFavorNextMonth || 0) > 1) {
        check(`[${tag}] aFavorNextMonth sólo si sobrepago real`, creditAllowed.has(r.contractId) || r2(r.totalAbonado) > r2(r.totalHistorico),
          `aFavor=${fmt(r.aFavorNextMonth)} abonado=${fmt(r.totalAbonado)} hist=${fmt(r.totalHistorico)}`);
      }
      // 4) aFavor - debe = abonado - totalHistorico (coherencia)
      const net = r2((r.aFavorNextMonth || 0) - (r.debeNextMonth || 0));
      const expNet = r2((r.totalAbonado || 0) - r2(r.totalHistorico));
      check(`[${tag}] aFavor-debe coherente con abonado-total`, Math.abs(net - expNet) <= 2, `net=${fmt(net)} esperado=${fmt(expNet)}`);
    }
  }
}

// ---------------- invariant scan (del harness) ----------------
async function invariantScan() {
  const anomalies = [];
  const recs = await prisma.monthlyRecord.findMany({
    where: { groupId: GID },
    select: { id: true, contractId: true, monthNumber: true, totalDue: true, amountPaid: true, balance: true, status: true, punitoryAmount: true, isCancelled: true },
  });
  // balance math
  let bad = 0;
  for (const r of recs) { if (r.isCancelled) continue; const exp = r2((r.amountPaid || 0) - (r.totalDue || 0)); if (Math.abs(r2(r.balance || 0) - exp) > 1) bad++; }
  if (bad) anomalies.push(`${bad} registros con balance != pagado-totalDue`);
  // negativos
  if (recs.some((r) => (r.punitoryAmount || 0) < -0.01)) anomalies.push('punitorios negativos');
  // duplicados monthNumber
  const dup = await prisma.$queryRawUnsafe(`SELECT contract_id, month_number, count(*) c FROM monthly_records GROUP BY contract_id, month_number HAVING count(*)>1`);
  if (dup.length) anomalies.push(`${dup.length} duplicados monthNumber/contrato`);
  // deudas
  const debts = await prisma.debt.findMany({ where: { groupId: GID } });
  if (debts.some((d) => (d.currentTotal || 0) < -0.01 || (d.accumulatedPunitory || 0) < -0.01)) anomalies.push('deudas con total/punitorio negativo');
  const underpaid = debts.filter((d) => d.status === 'PAID' && (d.amountPaid || 0) > 0.01 && (d.amountPaid || 0) + 1 < (d.currentTotal || 0));
  if (underpaid.length) anomalies.push(`${underpaid.length} deudas PAID realmente impagas`);

  check('Invariant scan sin anomalías', anomalies.length === 0, anomalies.join(' | '));
}

run().catch((e) => { console.error(e); process.exit(1); });
