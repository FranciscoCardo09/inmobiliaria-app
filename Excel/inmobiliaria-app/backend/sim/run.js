/*
 * 6-month real-environment simulation against a LOCAL copy of production.
 * Run: DATABASE_URL=postgresql://postgres:sim@localhost:55432/simdb \
 *      node -r ./sim/clock.js sim/run.js
 *
 * Drives the real service layer month-by-month (Jun..Nov 2026) with a
 * controllable clock, exercising every feature + good/bad cases, and runs
 * DB-wide invariant scans after each month to surface month-to-month bugs.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const mrSvc = require('../src/services/monthlyRecordService');
const svcSvc = require('../src/services/monthlyServiceService');
const paySvc = require('../src/services/paymentTransactionService');
const closeSvc = require('../src/services/monthlyCloseService');
const debtSvc = require('../src/services/debtService');
let reportSvc = {}; try { reportSvc = require('../src/services/reportDataService'); } catch (e) {}
let contractsCtrl = {}; try { contractsCtrl = require('../src/controllers/contractsController'); } catch (e) {}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const PK = (y, m) => y * 12 + m;

// ---------- findings collector ----------
const findings = []; // {cat, name, status: PASS|FAIL|BUG|INFO, detail}
const counts = { PASS: 0, FAIL: 0, BUG: 0, INFO: 0 };
function rec(cat, name, status, detail = '') {
  findings.push({ cat, name, status, detail });
  counts[status] = (counts[status] || 0) + 1;
  if (status === 'FAIL' || status === 'BUG') {
    console.log(`  [${status}] ${cat} :: ${name} -- ${detail}`);
  }
}
async function step(cat, name, fn) {
  try { const r = await fn(); rec(cat, name, 'PASS', typeof r === 'string' ? r : ''); return r; }
  catch (e) { rec(cat, name, 'FAIL', e.message); return null; }
}

// ---------- invariant scanner (the bug hunt) ----------
async function invariantScan(label) {
  const anomalies = [];
  // contracts in scope
  const contracts = await prisma.contract.findMany({
    select: { id: true, startMonth: true, durationMonths: true, rescindedAt: true, comprobantes: true, active: true },
  });
  const cmap = new Map(contracts.map((c) => [c.id, c]));

  // 1) duplicate monthNumber per contract
  const dupMN = await prisma.$queryRawUnsafe(
    `SELECT contract_id, month_number, count(*) c FROM monthly_records GROUP BY contract_id, month_number HAVING count(*) > 1`
  );
  if (dupMN.length) anomalies.push(`duplicate monthNumber/contract: ${dupMN.length} groups (e.g. ${JSON.stringify(dupMN[0])})`);

  // 2) record monthNumber outside contract active range ("meses fantasma")
  let outOfRange = 0, outSample = null;
  const recs = await prisma.monthlyRecord.findMany({
    select: { id: true, contractId: true, monthNumber: true, periodMonth: true, periodYear: true, totalDue: true, amountPaid: true, balance: true, status: true, punitoryAmount: true, comprobantesStatus: true, rentAmount: true, servicesTotal: true, ivaAmount: true, previousBalance: true, isCancelled: true },
  });
  for (const r of recs) {
    const c = cmap.get(r.contractId);
    if (!c || r.monthNumber == null) continue;
    const endMonth = c.startMonth + c.durationMonths - 1;
    if (r.monthNumber < c.startMonth || r.monthNumber > endMonth) { outOfRange++; if (!outSample) outSample = r; }
  }
  if (outOfRange) anomalies.push(`records with monthNumber out of contract range: ${outOfRange} (e.g. rec ${outSample.id} mN=${outSample.monthNumber})`);

  // 3) negative punitorios
  const negPun = recs.filter((r) => (r.punitoryAmount || 0) < -0.001).length;
  if (negPun) anomalies.push(`records with negative punitoryAmount: ${negPun}`);

  // 4) comprobantesStatus missing where contract requires comprobantes (regression guard)
  let missingComp = 0, compSample = null;
  for (const r of recs) {
    const c = cmap.get(r.contractId);
    if (!c) continue;
    const need = Array.isArray(c.comprobantes) && c.comprobantes.length > 0;
    const have = Array.isArray(r.comprobantesStatus) && r.comprobantesStatus.length > 0;
    if (need && !have) { missingComp++; if (!compSample) compSample = r; }
  }
  if (missingComp) anomalies.push(`records missing comprobantesStatus while contract needs it: ${missingComp} (e.g. ${compSample && compSample.periodYear}-${compSample && compSample.periodMonth})`);

  // 5) balance math: balance ~= amountPaid - totalDue
  let badBalance = 0, balSample = null;
  for (const r of recs) {
    if (r.isCancelled) continue;
    const expected = round2((r.amountPaid || 0) - (r.totalDue || 0));
    if (Math.abs(round2(r.balance || 0) - expected) > 1) { badBalance++; if (!balSample) balSample = { id: r.id, balance: r.balance, expected }; }
  }
  if (badBalance) anomalies.push(`records where balance != amountPaid-totalDue (>1): ${badBalance} (e.g. ${JSON.stringify(balSample)})`);

  // 6) status consistency: COMPLETE => amountPaid covers totalDue
  let badStatus = 0, stSample = null;
  for (const r of recs) {
    if (r.isCancelled) continue;
    if (r.status === 'COMPLETE' && (r.amountPaid || 0) + 1 < (r.totalDue || 0)) { badStatus++; if (!stSample) stSample = { id: r.id, paid: r.amountPaid, due: r.totalDue }; }
  }
  if (badStatus) anomalies.push(`COMPLETE records not fully paid: ${badStatus} (e.g. ${JSON.stringify(stSample)})`);

  // 7) debt consistency
  const debts = await prisma.debt.findMany({ select: { id: true, contractId: true, periodMonth: true, periodYear: true, status: true, currentTotal: true, amountPaid: true, accumulatedPunitory: true, unpaidRentAmount: true, monthlyRecordId: true } });
  let negDebt = debts.filter((d) => (d.currentTotal || 0) < -0.01 || (d.accumulatedPunitory || 0) < -0.01).length;
  if (negDebt) anomalies.push(`debts with negative total/punitory: ${negDebt}`);
  // PAID debts that were genuinely underpaid (exclude forgiven: amountPaid==0 => condonada)
  let paidNotSettled = debts.filter((d) => d.status === 'PAID' && (d.amountPaid || 0) > 0.01 && (d.amountPaid || 0) + 1 < (d.currentTotal || 0)).length;
  if (paidNotSettled) anomalies.push(`PAID debts genuinely underpaid (amountPaid>0 but < currentTotal): ${paidNotSettled}`);

  // 8) double obligation: a monthlyRecord that has a Debt but record still PENDING/PARTIAL & not cancelled
  const debtRecIds = new Set(debts.map((d) => d.monthlyRecordId).filter(Boolean));
  let doubleObl = 0;
  for (const r of recs) {
    if (debtRecIds.has(r.id) && !r.isCancelled && (r.status === 'PARTIAL' || r.status === 'PENDING') && (r.amountPaid || 0) === 0) {
      // record has a debt but is also shown as pending with no payment -> potential double count
      doubleObl++;
    }
  }
  // not necessarily a bug (debt replaces record), informational
  if (doubleObl) anomalies.push(`[info] records with a Debt still PENDING/PARTIAL (amountPaid=0): ${doubleObl}`);

  // 9) chronological violation: a later period fully paid/closed while an earlier period is OPEN debt
  //    (per contract chain, approx by contractId)
  const openDebtByContract = new Map();
  for (const d of debts) {
    if (d.status === 'OPEN' || d.status === 'PARTIAL') {
      const k = openDebtByContract.get(d.contractId) || Infinity;
      openDebtByContract.set(d.contractId, Math.min(k, PK(d.periodYear, d.periodMonth)));
    }
  }
  let chronoViol = 0, chronoSample = null;
  for (const r of recs) {
    if (r.status === 'COMPLETE') {
      const oldestOpen = openDebtByContract.get(r.contractId);
      if (oldestOpen != null && PK(r.periodYear, r.periodMonth) > oldestOpen) {
        chronoViol++; if (!chronoSample) chronoSample = { rec: r.id, paidPeriod: `${r.periodYear}-${r.periodMonth}`, oldestOpenDebtKey: oldestOpen };
      }
    }
  }
  // Reachable-but-by-design (commit 23cf7ec: untouched PENDING months don't block):
  // a later month can be paid while an older untouched month later becomes a debt. Report as INFO.
  if (chronoViol) anomalies.push(`[info] later month paid while an older OPEN debt exists (reachable per current chrono design): ${chronoViol} (e.g. ${JSON.stringify(chronoSample)})`);

  if (anomalies.length === 0) {
    rec('INVARIANT', label, 'PASS', 'no anomalies');
  } else {
    for (const a of anomalies) {
      const isInfo = a.startsWith('[info]');
      rec('INVARIANT', `${label}: ${a}`, isInfo ? 'INFO' : 'BUG', '');
    }
  }
  return anomalies;
}

// ---------- payment helpers ----------
async function fullRecordAmount(rec, paymentDate) {
  const base = round2((rec.rentAmount || 0) + (rec.servicesTotal || 0) + (rec.ivaAmount || 0) - (rec.previousBalance || 0));
  const due = round2(Math.max(base - (rec.amountPaid || 0), 0));
  let punit = 0;
  try { const p = await paySvc.calculatePunitoryPreview(rec.id, paymentDate); punit = p.amount || 0; } catch (e) {}
  return round2(due + punit);
}

async function oldestObligation(groupId, contractId) {
  // oldest open debt
  let debts = [];
  try { debts = await debtSvc.getOpenDebts(groupId, contractId); } catch (e) {}
  let oldestDebt = null;
  for (const d of debts) {
    if (!oldestDebt || PK(d.periodYear, d.periodMonth) < PK(oldestDebt.periodYear, oldestDebt.periodMonth)) oldestDebt = d;
  }
  // oldest unpaid record without a debt
  const recsNoDebt = await prisma.monthlyRecord.findMany({
    where: { contractId, status: { in: ['PENDING', 'PARTIAL'] }, isCancelled: false, debt: null },
    select: { id: true, periodMonth: true, periodYear: true, rentAmount: true, servicesTotal: true, ivaAmount: true, previousBalance: true, amountPaid: true, totalDue: true },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
    take: 1,
  });
  const oldestRec = recsNoDebt[0] || null;

  if (oldestDebt && oldestRec) {
    return PK(oldestDebt.periodYear, oldestDebt.periodMonth) <= PK(oldestRec.periodYear, oldestRec.periodMonth)
      ? { type: 'DEBT', obj: oldestDebt } : { type: 'RECORD', obj: oldestRec };
  }
  if (oldestDebt) return { type: 'DEBT', obj: oldestDebt };
  if (oldestRec) return { type: 'RECORD', obj: oldestRec };
  return null;
}

// ---------- main ----------
(async () => {
  console.log('=== 6-MONTH SIMULATION START ===');
  const groups = await prisma.group.findMany({ select: { id: true, name: true } });
  // baseline invariant scan (current prod state)
  await invariantScan('baseline (prod copy as-is)');

  // a service concept per group for carga masiva
  const conceptByGroup = new Map();
  for (const g of groups) {
    const ct = await prisma.conceptType.findFirst({ where: { groupId: g.id, isActive: true, category: { notIn: ['DESCUENTO', 'BONIFICACION'] } }, select: { id: true, name: true } });
    conceptByGroup.set(g.id, ct);
  }

  const MONTHS = [[2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11]];

  for (const [year, month] of MONTHS) {
    console.log(`\n----- SIMULATING ${year}-${String(month).padStart(2, '0')} -----`);
    global.__setNow(year, month, 10); // mid-month "today"

    for (const g of groups) {
      const gl = `${g.name} ${year}-${month}`;

      // 1) GENERATE
      const records = await step('generate', `getOrCreate ${gl}`, () => mrSvc.getOrCreateMonthlyRecords(g.id, month, year));
      // idempotency: second call should not change record count
      if (records) {
        const before = await prisma.monthlyRecord.count({ where: { groupId: g.id, periodMonth: month, periodYear: year } });
        await mrSvc.getOrCreateMonthlyRecords(g.id, month, year);
        const after = await prisma.monthlyRecord.count({ where: { groupId: g.id, periodMonth: month, periodYear: year } });
        if (before !== after) rec('generate', `idempotency ${gl}`, 'BUG', `count changed ${before}->${after} on regenerate`);
        else rec('generate', `idempotency ${gl}`, 'PASS');
      }

      if (!records || !records.length) continue;

      // 2) CARGA MASIVA (multi-contract bulk service for this month)
      const ct = conceptByGroup.get(g.id);
      if (ct) {
        const sampleContracts = records.slice(0, 12).map((r) => r.contractId);
        await step('carga-masiva', `bulkAssignMultiContract ${gl}`, async () => {
          await svcSvc.bulkAssignMultiContract(g.id, sampleContracts, ct.id, 1234.5, [{ month, year }], 'sim carga masiva');
          return `${sampleContracts.length} contracts`;
        });
        // regression guard: those records must keep comprobantesStatus if contract needs it
        const chk = await prisma.monthlyRecord.findMany({ where: { groupId: g.id, periodMonth: month, periodYear: year, contractId: { in: sampleContracts } }, select: { contractId: true, comprobantesStatus: true } });
        const ctr = await prisma.contract.findMany({ where: { id: { in: sampleContracts } }, select: { id: true, comprobantes: true } });
        const needsComp = new Set(ctr.filter((c) => Array.isArray(c.comprobantes) && c.comprobantes.length).map((c) => c.id));
        const broke = chk.filter((r) => needsComp.has(r.contractId) && (!Array.isArray(r.comprobantesStatus) || r.comprobantesStatus.length === 0));
        rec('carga-masiva', `comprobantesStatus preserved ${gl}`, broke.length ? 'BUG' : 'PASS', broke.length ? `${broke.length} records lost comprobantesStatus` : '');
      }

      // 3) PAYMENTS — pay oldest obligation per sampled contract, varied buckets
      const sample = records.slice(0, 40);
      let idx = 0;
      for (const r of sample) {
        idx++;
        const bucket = idx % 5;
        const obl = await oldestObligation(g.id, r.contractId);
        if (!obl) continue;
        // choose payment date by bucket (late buckets -> day 26)
        const late = bucket === 3;
        const day = late ? 26 : 8;
        const payDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (late) global.__setNow(year, month, 26); else global.__setNow(year, month, 8);

        try {
          if (obl.type === 'DEBT') {
            const amt = bucket === 1 ? round2((obl.obj.liveCurrentTotal || obl.obj.currentTotal || 0) * 0.5) : (obl.obj.liveCurrentTotal || obl.obj.currentTotal || 0);
            if (bucket === 2 || amt <= 0) continue; // skip bucket
            await debtSvc.payDebt(obl.obj.id, amt, payDate, 'EFECTIVO', 'sim');
            rec('pago-deuda', `pay debt ${g.name}`, 'PASS', `${obl.obj.periodLabel || ''} amt=${amt}`);
          } else {
            const full = await fullRecordAmount(obl.obj, payDate);
            if (bucket === 2 || full <= 0) continue; // skip bucket
            const amt = bucket === 1 ? round2(full * 0.5) : full;
            await paySvc.registerPayment(g.id, obl.obj.id, { paymentDate: payDate, amount: amt, paymentMethod: 'EFECTIVO' });
            rec('pago', `pay record ${g.name}`, 'PASS', `${obl.obj.periodYear}-${obl.obj.periodMonth} amt=${amt}${late ? ' (late)' : ''}`);
          }
        } catch (e) {
          if (e.code === 'DEBT_BLOCK' || /Debe pagar primero/i.test(e.message)) rec('pago', `chrono block (expected) ${g.name}`, 'INFO', e.message);
          else rec(obl.type === 'DEBT' ? 'pago-deuda' : 'pago', `pay error ${g.name}`, 'FAIL', e.message);
        }
        global.__setNow(year, month, 10);
      }

      // 3b) BAD CASE — paying a NEWER period while an older OPEN debt exists must be blocked.
      //     (This is the real chronological guard; untouched-pending months legitimately don't block.)
      await step('pago-badcase', `chronological block enforced ${gl}`, async () => {
        // contracts with an OPEN/PARTIAL debt
        const openDebts = await prisma.debt.findMany({
          where: { groupId: g.id, status: { in: ['OPEN', 'PARTIAL'] } },
          select: { contractId: true, periodMonth: true, periodYear: true },
          orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
        });
        const oldestDebtKey = new Map();
        for (const d of openDebts) {
          const k = PK(d.periodYear, d.periodMonth);
          if (!oldestDebtKey.has(d.contractId)) oldestDebtKey.set(d.contractId, k);
        }
        let tested = false, allowed = null;
        for (const [cid, dk] of oldestDebtKey) {
          // find a record for this contract STRICTLY NEWER than the oldest open debt, not fully paid
          const newer = await prisma.monthlyRecord.findFirst({
            where: { contractId: cid, status: { in: ['PENDING', 'PARTIAL'] }, isCancelled: false, debt: null },
            select: { id: true, periodMonth: true, periodYear: true },
            orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
          });
          if (!newer || PK(newer.periodYear, newer.periodMonth) <= dk) continue;
          try {
            await paySvc.registerPayment(g.id, newer.id, { paymentDate: `${newer.periodYear}-${String(newer.periodMonth).padStart(2, '0')}-08`, amount: 1 });
            allowed = `contract ${cid} paid ${newer.periodYear}-${newer.periodMonth} despite older OPEN debt @${dk}`;
            break;
          } catch (e) {
            if (e.code === 'DEBT_BLOCK' || /Debe pagar primero/i.test(e.message)) { tested = true; break; }
          }
        }
        if (allowed) throw new Error(`OUT-OF-ORDER PAYMENT ALLOWED: ${allowed}`);
        return tested ? 'blocked correctly' : 'no candidate (skipped)';
      });

      // 4) REPORTS — must not crash
      const reportFns = [
        ['getControlMensualData', [g.id, month, year]],
        ['getLiquidacionesAllContracts', [g.id, month, year]],
        ['getEstadoCuentasData', [g.id]],
        ['getResumenEjecutivoData', [g.id, month, year]],
        ['getVencimientosData', [g.id]],
      ];
      for (const [fn, fnArgs] of reportFns) {
        if (typeof reportSvc[fn] === 'function') {
          await step('reportes', `${fn} ${gl}`, async () => { await reportSvc[fn](...fnArgs); return 'ok'; });
        }
      }
    } // groups

    // 5) CIERRE DE MES (end of month) + debt generation
    global.__setNow(year, month, 28);
    for (const g of groups) {
      const gl = `${g.name} ${year}-${month}`;
      const preview = await step('cierre', `preview ${gl}`, () => closeSvc.previewCloseMonth(g.id, month, year));
      const willGen = preview && preview.summary ? preview.summary.willGenerateDebts : null;
      const debtsBefore = await prisma.debt.count({ where: { groupId: g.id, periodMonth: month, periodYear: year } });
      await step('cierre', `closeMonth ${gl}`, () => closeSvc.closeMonth(g.id, month, year));
      const debtsAfter = await prisma.debt.count({ where: { groupId: g.id, periodMonth: month, periodYear: year } });
      const created = debtsAfter - debtsBefore;
      if (willGen != null) {
        if (created === willGen) rec('cierre', `preview matches actual ${gl}`, 'PASS', `${created} debts`);
        else rec('cierre', `preview vs actual mismatch ${gl}`, 'BUG', `preview=${willGen} actual=${created}`);
      }
      // idempotency: closing again should create 0 new debts
      await closeSvc.closeMonth(g.id, month, year);
      const debtsAfter2 = await prisma.debt.count({ where: { groupId: g.id, periodMonth: month, periodYear: year } });
      if (debtsAfter2 !== debtsAfter) rec('cierre', `double-close created debts ${gl}`, 'BUG', `${debtsAfter}->${debtsAfter2}`);
      else rec('cierre', `double-close safe ${gl}`, 'PASS');
    }

    // 6) DEBT PAYMENTS on freshly generated debts (full/partial/late/forgive/cancel)
    global.__setNow(year, month, 28);
    for (const g of groups) {
      let open = [];
      try { open = await debtSvc.getOpenDebts(g.id); } catch (e) {}
      open = open.filter((d) => d.periodYear === year && d.periodMonth === month).slice(0, 12);
      let i = 0;
      for (const d of open) {
        i++;
        const b = i % 4;
        const payDate = `${year}-${String(month).padStart(2, '0')}-28`;
        try {
          if (b === 0) { // forgive
            await debtSvc.forgiveDebt(d.id, 'sim forgive');
            rec('pago-deuda', `forgive ${g.name}`, 'PASS', d.periodLabel || '');
          } else if (b === 1) { // partial
            const amt = round2((d.liveCurrentTotal || d.currentTotal) * 0.4);
            if (amt > 0) { await debtSvc.payDebt(d.id, amt, payDate, 'EFECTIVO', 'sim partial'); rec('pago-deuda', `partial ${g.name}`, 'PASS'); }
          } else if (b === 2) { // full then cancel
            const amt = (d.liveCurrentTotal || d.currentTotal);
            if (amt > 0) {
              const res = await debtSvc.payDebt(d.id, amt, payDate, 'EFECTIVO', 'sim full');
              const pid = res && (res.paymentId || (res.payment && res.payment.id));
              const lastPay = await prisma.debtPayment.findFirst({ where: { debtId: d.id }, orderBy: { createdAt: 'desc' } });
              if (lastPay) { await debtSvc.cancelDebtPayment(d.id, lastPay.id); rec('pago-deuda', `pay+cancel ${g.name}`, 'PASS'); }
            }
          } else { // full
            const amt = (d.liveCurrentTotal || d.currentTotal);
            if (amt > 0) { await debtSvc.payDebt(d.id, amt, payDate, 'EFECTIVO', 'sim full'); rec('pago-deuda', `full ${g.name}`, 'PASS'); }
          }
        } catch (e) {
          if (e.code === 'DEBT_BLOCK' || /Debe pagar primero/i.test(e.message)) rec('pago-deuda', `chrono block (expected) ${g.name}`, 'INFO', e.message);
          else rec('pago-deuda', `debt op error ${g.name}`, 'FAIL', `${e.message}`);
        }
      }
    }

    // 7) invariant scan after the month
    await invariantScan(`after ${year}-${String(month).padStart(2, '0')}`);
  } // months

  // 8) RENEWAL — attempt to renew an expired contract
  global.__setNow(2026, 11, 30);
  if (typeof contractsCtrl.renewContract === 'function') {
    const cand = await prisma.contract.findFirst({
      where: { active: true, renewedAt: null },
      select: { id: true, groupId: true, baseRent: true, durationMonths: true, startDate: true },
      orderBy: { startDate: 'asc' },
    });
    if (cand) {
      await step('renovacion', 'renewContract (expired)', async () => {
        let captured = null, statusCode = 200;
        const req = { params: { groupId: cand.groupId, id: cand.id }, body: { startDate: '2026-12-01', durationMonths: 24, baseRent: round2(cand.baseRent * 1.5), pagaIva: false, comprobantes: [] }, user: { id: null } };
        const res = { status: (c) => { statusCode = c; return res; }, json: (o) => { captured = o; return res; } };
        await contractsCtrl.renewContract(req, res, (err) => { if (err) throw err; });
        if (statusCode >= 400) return `validation rejected (expected if not expired): ${JSON.stringify(captured).slice(0, 120)}`;
        // verify chain
        const child = await prisma.contract.findFirst({ where: { renewedFromContractId: cand.id } });
        if (!child) return 'renew returned ok but no child contract found';
        return `renewed -> child ${child.id}, startMonth=${child.startMonth}`;
      });
    }
  }

  // ---------- FINAL REPORT ----------
  console.log('\n\n======== SIMULATION REPORT ========');
  console.log(`PASS=${counts.PASS}  FAIL=${counts.FAIL}  BUG=${counts.BUG}  INFO=${counts.INFO}`);
  const bugs = findings.filter((f) => f.status === 'BUG');
  const fails = findings.filter((f) => f.status === 'FAIL');
  if (bugs.length) {
    console.log(`\n--- BUGS / INCONSISTENCIES (${bugs.length}) ---`);
    bugs.forEach((b) => console.log(`  • [${b.cat}] ${b.name} ${b.detail}`));
  }
  if (fails.length) {
    console.log(`\n--- FAILURES / EXCEPTIONS (${fails.length}) ---`);
    const seen = new Set();
    fails.forEach((b) => { const k = b.cat + b.detail; if (!seen.has(k)) { seen.add(k); console.log(`  • [${b.cat}] ${b.name} -- ${b.detail}`); } });
  }
  const fs = require('fs');
  fs.writeFileSync('/tmp/sim_report.json', JSON.stringify({ counts, findings }, null, 2));
  console.log('\nFull report written to /tmp/sim_report.json');
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
