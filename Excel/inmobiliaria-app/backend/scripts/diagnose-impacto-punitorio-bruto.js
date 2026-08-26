/**
 * DIAGNÓSTICO DE SÓLO LECTURA — impacto del fix del punitorio BRUTO (2026-08-26).
 *
 * Contesta: qué registros mueven su saldo cuando se deploye el fix, cuánto y en qué dirección.
 *
 * NO ESCRIBE NADA. Sólo `findMany` + funciones puras. No llama `getOrCreateMonthlyRecords`,
 * `recalculateMultipleRecords` ni `processDirtyRecords` (ver memoria
 * getorcreate-monthly-records-writes). `calculateDebtPunitory` se invoca con
 * `skipUpdate = true`: su único `debt.update` está detrás de ese flag.
 *
 * Uso (la URL de la línea de comandos gana: dotenv no sobreescribe variables ya seteadas):
 *   cd inmobiliaria-app/backend
 *   DATABASE_URL='postgresql://...neon.tech/...' node scripts/diagnose-impacto-punitorio-bruto.js
 *
 * Opciones:
 *   --all       listar todos los casos (por defecto muestra los 15 mayores por categoría)
 *   --group=X   filtrar por nombre de grupo (subcadena, case-insensitive)
 *
 * Replica en memoria lo que hace `_recalculateCore`, incluida la cadena de `previousBalance`
 * por contrato, para poder comparar "lo guardado hoy" contra "lo que va a quedar".
 */
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { computeGrossRecordPunitory, round2, getHolidaysForYear } = require('../src/utils/punitory');
const { calculateDebtPunitory } = require('../src/services/debtService');
const { getTodayLocalString } = require('../src/utils/dateUtils');

const ALL = process.argv.includes('--all');
const GROUP_FILTER = (process.argv.find((a) => a.startsWith('--group=')) || '').slice(8).toLowerCase();
const TOP = 15;

const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const signed = (n) => (n < 0 ? '-' : '+') + Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Copia exacta de `_punitoryOutsideConcepts` (monthlyRecordService.js, no exportado):
// el punitorio del período que NO está en los conceptos = impago en vivo de la Deuda + el
// que quedó cubierto por el saldo a favor.
const punitoryOutsideConcepts = (debt, livePun) => {
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

const CATEGORIAS = [
  ['A', 'Decía CANCELADO y pasa a DEBER — mora impaga que se estaba perdiendo (plata que se recupera)'],
  ['B', 'Tenía saldo a favor FANTASMA y se le va (dejaba de regalar plata)'],
  ['C', 'Estaba impago y pasa a CANCELADO — lo cubría el saldo a favor'],
  ['D', 'Le aumenta lo que debe (aparece la mora real completa)'],
  ['E', 'Le baja lo que debe'],
];

(async () => {
  const contracts = await prisma.contract.findMany({
    select: {
      id: true, punitoryStartDay: true, punitoryGraceDay: true, punitoryPercent: true,
      tenant: { select: { name: true } },
      contractTenants: { select: { tenant: { select: { name: true } } }, orderBy: { isPrimary: 'desc' } },
      property: { select: { address: true, owner: { select: { name: true } } } },
      group: { select: { name: true } },
      monthlyRecords: {
        orderBy: { monthNumber: 'asc' },
        include: {
          services: { include: { conceptType: { select: { category: true } } } },
          transactions: {
            orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
            include: { concepts: { select: { type: true, amount: true } } },
          },
          debt: true,
        },
      },
    },
  });

  const holidaysByYear = new Map();
  const holidays = async (y) => {
    if (!holidaysByYear.has(y)) holidaysByYear.set(y, await getHolidaysForYear(y));
    return holidaysByYear.get(y);
  };

  const cambios = [];
  let evaluados = 0;

  for (const c of contracts) {
    const grupo = c.group?.name || '?';
    if (GROUP_FILTER && !grupo.toLowerCase().includes(GROUP_FILTER)) continue;

    // La cadena de previousBalance arranca en el primer mes del contrato, igual que
    // `_recalculateCore` (el primer registro usa el persistido, los siguientes el rolling).
    let running = null;

    for (const rec of c.monthlyRecords) {
      evaluados++;

      let servicesTotal = 0;
      for (const s of rec.services) {
        if (s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION') servicesTotal -= Math.abs(s.amount);
        else servicesTotal += s.amount;
      }
      const amountPaid = rec.transactions.reduce((a, t) => a + t.amount, 0);
      const activePrev = running === null ? rec.previousBalance : running;
      const iva = rec.includeIva ? rec.rentAmount * 0.21 : 0;

      const openDebt = rec.debt && (rec.debt.status === 'OPEN' || rec.debt.status === 'PARTIAL') ? rec.debt : null;
      let outside;
      if (openDebt) {
        try {
          const live = await calculateDebtPunitory(openDebt, getTodayLocalString(), null, /* skipUpdate */ true);
          outside = punitoryOutsideConcepts(openDebt, live);
        } catch { outside = openDebt.accumulatedPunitory || 0; }
      } else if (rec.debt) {
        outside = punitoryOutsideConcepts(rec.debt, null);
      }

      const bruto = computeGrossRecordPunitory(
        { ...rec, servicesTotal, amountPaid, previousBalance: activePrev },
        c, await holidays(rec.periodYear),
        { punitoryOutsideConcepts: outside, isPostExpiry: rec.isPostExpiry }
      ).amount;

      const gross = rec.rentAmount + servicesTotal + bruto + iva;
      const bal = round2(amountPaid - (gross - activePrev));
      const effBal = round2(bal + (rec.balanceForgiven || 0));
      const creditCubre = activePrev > 0 && activePrev >= gross - 1;
      const forgiven = (rec.balanceForgiven || 0) > 0;
      let st = 'PENDING';
      if (openDebt) st = amountPaid > 0 ? 'PARTIAL' : 'PENDING';
      else if (effBal >= -1 && (amountPaid > 0 || forgiven || creditCubre)) st = 'COMPLETE';
      else if (amountPaid > 0) st = 'PARTIAL';

      running = Math.max(effBal, 0);

      const delta = round2(bal - rec.balance);
      if (Math.abs(delta) <= 1 && st === rec.status) continue;

      let cat;
      if (rec.status === 'COMPLETE' && st !== 'COMPLETE') cat = 'A';
      else if (rec.balance > 1 && bal <= 1) cat = 'B';
      else if (rec.status !== 'COMPLETE' && st === 'COMPLETE') cat = 'C';
      else cat = delta < 0 ? 'D' : 'E';

      cambios.push({
        cat, grupo,
        nombre: c.contractTenants?.[0]?.tenant?.name || c.tenant?.name || c.property?.owner?.name || '(sin nombre)',
        dir: c.property?.address || '?',
        mes: `${MESES[rec.periodMonth]}-${rec.periodYear}`,
        balAntes: rec.balance, balDespues: bal, delta,
        stAntes: rec.status, stDespues: st,
        deuda: rec.debt?.status || null,
      });
    }
  }

  console.log(`\nRegistros evaluados: ${evaluados}   |   que se mueven: ${cambios.length}`);

  // Resumen por grupo, para saber a qué administración le pega.
  const porGrupo = new Map();
  for (const x of cambios) {
    const g = porGrupo.get(x.grupo) || { n: 0, suma: 0 };
    g.n++; g.suma = round2(g.suma + x.delta);
    porGrupo.set(x.grupo, g);
  }
  if (porGrupo.size > 1) {
    console.log('\nPor grupo:');
    for (const [g, v] of [...porGrupo.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${g.slice(0, 40).padEnd(41)} ${String(v.n).padStart(4)} caso(s)   neto ${signed(v.suma)}`);
    }
  }

  for (const [cat, titulo] of CATEGORIAS) {
    const arr = cambios.filter((x) => x.cat === cat).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    if (arr.length === 0) continue;
    const suma = round2(arr.reduce((s, x) => s + x.delta, 0));
    console.log(`\n${'='.repeat(112)}`);
    console.log(`${cat}) ${titulo}`);
    console.log(`   ${arr.length} caso(s) — impacto neto ${signed(suma)}`);
    console.log('='.repeat(112));
    for (const x of (ALL ? arr : arr.slice(0, TOP))) {
      console.log(
        `${x.mes.padEnd(9)} ${x.nombre.slice(0, 28).padEnd(29)} ${x.dir.slice(0, 30).padEnd(31)} ` +
        `${plain(x.balAntes).padStart(14)} -> ${plain(x.balDespues).padStart(14)}  ${signed(x.delta).padStart(14)}  ` +
        `${x.stAntes}->${x.stDespues}${x.deuda ? ` [deuda ${x.deuda}]` : ''}`
      );
    }
    if (!ALL && arr.length > TOP) console.log(`   … y ${arr.length - TOP} caso(s) más (correr con --all)`);
  }

  console.log('\nNota: "antes" es lo que hay guardado hoy; "después" es lo que va a quedar cuando');
  console.log('ese mes se recalcule (pago, edición de servicio, cierre del mes siguiente, o');
  console.log('reinicio del backend). Este script NO escribió nada.\n');

  await prisma.$disconnect();
})();
