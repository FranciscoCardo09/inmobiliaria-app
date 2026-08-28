const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const realPunitory = require('../src/utils/punitory');
const { makeFakePrisma } = require('./helpers/fakePrisma');

// El presupuesto de servicios de un pago se calculaba sobre el neto DESPUES del descuento
// (`remainingServicesOwed = max(servicesTotal - creditsOnServices, 0)`, con `servicesTotal`
// ya neteado). Consecuencias, las dos de plata:
//
//   a) descuento MENOR que los servicios: el presupuesto alcanzaba para menos servicios de
//      los que hay, asi que el ultimo servicio real quedaba SIN concepto propio y el
//      descuento terminaba aplicado dos veces (una achicando el presupuesto, otra como
//      linea negativa). Los conceptos no sumaban lo cobrado.
//   b) descuento MAYOR que los servicios: el presupuesto daba 0, el bloque entero se
//      salteaba, y TODO el pago quedaba etiquetado ALQUILER — los impuestos reales
//      viajaban escondidos ahi adentro e inflaban la base de honorarios en pagos
//      parciales. El descuento ni siquiera aparecia en el recibo.
//
// Regla nueva: el presupuesto de servicios es el BRUTO, y el descuento se imputa contra el
// alquiler (misma regla que honorarios: DESCUENTO reduce la base del alquiler), con
// sobrante hacia IVA y servicios para que el total adeudado no cambie.

function makeService(prisma) {
  return proxyquire('../src/services/paymentTransactionService', {
    '../lib/prisma': prisma,
    '../utils/punitory': { ...realPunitory, getHolidaysForYear: async () => [] },
    './monthlyRecordService': {
      recalculateMonthlyRecord: async () => ({ status: 'PARTIAL' }),
      recalculateMultipleRecords: async () => 0,
    },
    './debtService': { canPayCurrentMonth: async () => ({ canPay: true }) },
  });
}

const svcRow = (name, amount, category = 'OTROS') => ({
  amount, conceptType: { id: `ct-${name}`, name, label: name, category },
});

async function makeRecord(prisma, { services = [], rentAmount = 100000, includeIva = false } = {}) {
  let servicesTotal = 0;
  for (const s of services) {
    const isDisc = s.conceptType.category === 'DESCUENTO' || s.conceptType.category === 'BONIFICACION';
    servicesTotal += isDisc ? -Math.abs(s.amount) : s.amount;
  }
  await prisma.monthlyRecord.create({
    data: {
      id: 'mr-1', groupId: 'g1', contractId: 'c1',
      periodMonth: 7, periodYear: 2026, monthNumber: 7,
      status: 'PENDING', rentAmount, servicesTotal, includeIva, amountPaid: 0,
      previousBalance: 0, punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
      services,
      contract: { id: 'c1', punitoryStartDay: 10, punitoryGraceDay: 10, punitoryPercent: 0.006, rescindedAt: null },
    },
  });
}

// Cobra el 5 del mes: dentro del periodo de gracia, sin punitorios que ensucien el reparto.
async function cobrar(svc, amount, paymentDate = '2026-07-05', prisma = null) {
  const { transaction } = await svc.registerPayment('g1', 'mr-1', {
    paymentDate, amount, paymentMethod: 'EFECTIVO',
  });
  const concepts = transaction.concepts?.create || transaction.concepts || [];
  // El fake guarda el nested write tal cual (`{ create: [...] }`); Prisma real devuelve un
  // array de filas. `registerPaymentCore` lee los conceptos de la ULTIMA transaccion para
  // saber cuanto punitorio ya se pago, asi que sin esta normalizacion un segundo pago
  // revienta dentro del service. Limitacion del harness, no del codigo de produccion.
  if (prisma) {
    for (const tx of await prisma.paymentTransaction.findMany({})) {
      if (tx.concepts && !Array.isArray(tx.concepts)) {
        await prisma.paymentTransaction.update({
          where: { id: tx.id }, data: { concepts: tx.concepts.create || [] },
        });
      }
    }
  }
  return concepts;
}

const byType = (concepts, type) => concepts.filter((c) => c.type === type).reduce((s, c) => s + c.amount, 0);
const positivos = (concepts) => concepts.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0);

// ── a) descuento MENOR que los servicios ────────────────────────────────────

test('conceptos - con un descuento chico, cada servicio real conserva su monto completo', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { services: [
    svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('ABL', 12503), svcRow('DESCUENTO', 15000, 'DESCUENTO'),
  ]});

  const c = await cobrar(svc, 80000);

  assert.strictEqual(byType(c, 'IMPUESTO_MUNICIPAL'), 37497, 'el impuesto va entero, no truncado al neto');
  assert.strictEqual(byType(c, 'ABL'), 12503, 'el segundo servicio no puede desaparecer del recibo');
  assert.strictEqual(byType(c, 'DESCUENTO'), -15000, 'el descuento se muestra una sola vez, en negativo');
  assert.strictEqual(byType(c, 'ALQUILER'), 30000, 'al alquiler va lo que sobra: 80.000 - 50.000');
});

test('conceptos - los conceptos positivos suman exactamente lo cobrado', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { services: [
    svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('ABL', 12503), svcRow('DESCUENTO', 15000, 'DESCUENTO'),
  ]});

  const c = await cobrar(svc, 80000);

  assert.strictEqual(positivos(c), 80000, 'el descuento no puede descontarse dos veces');
});

// ── b) descuento MAYOR que los servicios (caso Godoy) ───────────────────────

test('conceptos - con un descuento mayor que los servicios, los impuestos NO se esconden en el alquiler', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { rentAmount: 680000, services: [
    svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('DESCUENTO', 85833, 'DESCUENTO'),
  ]});

  const c = await cobrar(svc, 300000);

  assert.strictEqual(byType(c, 'IMPUESTO_MUNICIPAL'), 37497, 'el impuesto tiene su propio concepto');
  assert.strictEqual(byType(c, 'ALQUILER'), 262503, 'la base de honorarios es 262.503, no 300.000');
  assert.strictEqual(byType(c, 'DESCUENTO'), -85833, 'el descuento aparece en el recibo');
  assert.strictEqual(positivos(c), 300000);
});

// ── invariantes: lo que ya funcionaba tiene que seguir igual ────────────────

test('conceptos - SIN descuento el reparto no cambia', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { services: [svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('ABL', 12503)] });

  const c = await cobrar(svc, 80000);

  assert.strictEqual(byType(c, 'IMPUESTO_MUNICIPAL'), 37497);
  assert.strictEqual(byType(c, 'ABL'), 12503);
  assert.strictEqual(byType(c, 'ALQUILER'), 30000);
  assert.strictEqual(positivos(c), 80000);
});

test('conceptos - si el descuento cubre TODO lo adeudado, el pago es sobrepago', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  // alquiler 50.000 + servicios 10.000 - descuento 100.000 => no se debe nada
  await makeRecord(prisma, { rentAmount: 50000, services: [
    svcRow('ABL', 10000), svcRow('DESCUENTO', 100000, 'DESCUENTO'),
  ]});

  const c = await cobrar(svc, 10000);

  assert.strictEqual(byType(c, 'SOBREPAGO'), 10000, 'no se debe nada: todo el pago es a favor');
  assert.strictEqual(byType(c, 'ALQUILER'), 0);
});

// ── el efecto real en plata: los conceptos nuevos llegan bien a honorarios ──

const { buildLiquidacionFromRecord } = require('../src/services/reportDataService');

test('honorarios - un pago parcial con descuento deja de inflar la base del alquiler', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  // Caso Godoy: alquiler 680.000, impuesto 37.497, DESCUENTO 85.833. Paga 300.000.
  await makeRecord(prisma, { rentAmount: 680000, services: [
    svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('DESCUENTO', 85833, 'DESCUENTO'),
  ]});
  const concepts = await cobrar(svc, 300000);

  // Se arma el mes tal como lo veria el reporte, con los conceptos que acaba de grabar
  // el motor de pagos, y se le pide la Liquidacion.
  const record = {
    id: 'mr-1', monthNumber: 5, periodMonth: 7, periodYear: 2026, rentAmount: 680000,
    punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
    includeIva: false, ivaAmount: 0, previousBalance: 0,
    amountPaid: 300000, balance: -331664, status: 'PARTIAL',
    isPaid: false, isCancelled: false, fullPaymentDate: null,
    services: [
      { id: 's1', amount: 37497, conceptType: { category: 'IMPUESTO', label: 'Impuesto Municipal', name: 'IMPUESTO_MUNICIPAL' } },
      { id: 's2', amount: 85833, conceptType: { category: 'DESCUENTO', label: 'Descuento', name: 'DESCUENTO' } },
    ],
    transactions: [{
      paymentDate: new Date(2026, 6, 5, 12, 0, 0), amount: 300000, punitoryForgiven: false,
      concepts,
    }],
    contract: {
      id: 'c-1', contractType: 'INQUILINO', tenant: null,
      contractTenants: [{ isPrimary: true, tenant: { name: 'Godoy', dni: '1', email: null, phone: null } }],
      property: { address: 'Los Pinos 4031', floor: null, apartment: null,
        owner: { name: 'Duenio', dni: '2', email: null, phone: null, transferBeneficiary: null }, transferBeneficiary: null },
      rentHistory: [],
    },
  };
  const empresa = { nombre: 'Test', subtitulo:'', direccion:'', ciudad:'', telefono:'', email:'', cuit:'', currency:'ARS', banco:{} };
  const r = await buildLiquidacionFromRecord(record, empresa, 7, 2026, { honorariosPercent: 10, holidays: [] });

  assert.strictEqual(r.subtotalAlquileresCobrado, 262503, 'base de honorarios = alquiler realmente cobrado');
  assert.strictEqual(r.honorariosCobrado, 26250.3, '10% de 262.503, no de 300.000');
});

// ── invariante de barrido: el descuento cambia las ETIQUETAS, no cuanta plata ──

test('invariante - lo imputado a cargos es siempre min(pago, total adeudado), con y sin descuento', async () => {
  const casos = [];
  for (const rent of [100000, 680000]) {
    for (const disc of [0, 15000, 50000, 85833, 200000]) {
      for (const pago of [10000, 80000, 300000]) {
        for (const iva of [false, true]) casos.push({ rent, disc, pago, iva });
      }
    }
  }

  for (const { rent, disc, pago, iva } of casos) {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);
    const services = [svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('ABL', 12503)];
    if (disc > 0) services.push(svcRow('DESCUENTO', disc, 'DESCUENTO'));
    await makeRecord(prisma, { rentAmount: rent, includeIva: iva, services });

    const c = await cobrar(svc, pago);
    const cargos = ['IMPUESTO_MUNICIPAL', 'ABL', 'ALQUILER', 'IVA'].reduce((s, t) => s + byType(c, t), 0);
    const sobrepago = byType(c, 'SOBREPAGO');
    const punitorios = byType(c, 'PUNITORIOS');

    const totalAdeudado = Math.max(rent + (50000 - disc) + (iva ? rent * 0.21 : 0), 0);
    const esperado = Math.round(Math.min(pago, totalAdeudado) * 100) / 100;
    const ctx = `rent=${rent} disc=${disc} pago=${pago} iva=${iva}`;

    assert.strictEqual(Math.round(cargos * 100) / 100, esperado, `imputado a cargos (${ctx})`);
    assert.strictEqual(Math.round((cargos + sobrepago + punitorios) * 100) / 100, pago,
      `cargos + sobrepago + punitorios == lo cobrado (${ctx})`);
  }
});

test('honorarios - con BONIFICACION el gross-up sigue devolviendo la base al alquiler completo', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  // Mismo mes de Godoy pero con el ajuste como BONIFICACION (que NO resta base de
  // honorarios): el gross-up de reportDataService escala el alquiler realmente cobrado
  // por bruto/neto. Antes del fix la base daba 366.466,85 porque `paidAlquiler` se
  // llevaba tambien los impuestos.
  await makeRecord(prisma, { rentAmount: 680000, services: [
    svcRow('MUNICIPALIDAD', 8740), svcRow('RENTA', 28757), svcRow('COCINA', 123333, 'BONIFICACION'),
  ]});
  const concepts = await cobrar(svc, 300000);

  const record = {
    id: 'mr-1', monthNumber: 5, periodMonth: 7, periodYear: 2026, rentAmount: 680000,
    punitoryAmount: 0, punitoryDays: 0, punitoryForgiven: false,
    includeIva: false, ivaAmount: 0, previousBalance: 0,
    amountPaid: 300000, balance: -294164, status: 'PARTIAL',
    isPaid: false, isCancelled: false, fullPaymentDate: null,
    services: [
      { id: 's1', amount: 8740, conceptType: { category: 'IMPUESTO', label: 'Municipal', name: 'MUNICIPALIDAD' } },
      { id: 's2', amount: 28757, conceptType: { category: 'IMPUESTO', label: 'DGR', name: 'RENTA' } },
      { id: 's3', amount: 123333, conceptType: { category: 'BONIFICACION', label: 'Cocina', name: 'COCINA' } },
    ],
    transactions: [{ paymentDate: new Date(2026, 6, 5, 12, 0, 0), amount: 300000, punitoryForgiven: false, concepts }],
    contract: {
      id: 'c-1', contractType: 'INQUILINO', tenant: null,
      contractTenants: [{ isPrimary: true, tenant: { name: 'Godoy', dni: '1', email: null, phone: null } }],
      property: { address: 'Los Pinos 4031', floor: null, apartment: null,
        owner: { name: 'Duenio', dni: '2', email: null, phone: null, transferBeneficiary: null }, transferBeneficiary: null },
      rentHistory: [],
    },
  };
  const empresa = { nombre:'Test', subtitulo:'', direccion:'', ciudad:'', telefono:'', email:'', cuit:'', currency:'ARS', banco:{} };
  const r = await buildLiquidacionFromRecord(record, empresa, 7, 2026, { honorariosPercent: 10, holidays: [] });

  // 262.503 realmente imputados a alquiler, escalados 680.000/556.667.
  const esperado = Math.round((262503 * 680000 / (680000 - 123333)) * 100) / 100;
  assert.strictEqual(r.subtotalAlquileresCobrado, esperado, 'gross-up sobre el alquiler realmente cobrado');
  assert.ok(r.subtotalAlquileresCobrado < 366466.85, 'y por debajo de la base inflada de antes del fix');
});

test('conceptos - dos pagos en el mismo mes: ningun servicio se cobra dos veces ni se pierde', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { services: [
    svcRow('IMPUESTO_MUNICIPAL', 37497), svcRow('ABL', 12503), svcRow('DESCUENTO', 15000, 'DESCUENTO'),
  ]});

  const c1 = await cobrar(svc, 30000, '2026-07-05', prisma);
  // El segundo pago tiene que ver los 30.000 ya cobrados: el fake no recalcula amountPaid.
  await prisma.monthlyRecord.update({ where: { id: 'mr-1' }, data: { amountPaid: 30000 } });
  const c2 = await cobrar(svc, 50000, '2026-07-06', prisma);

  const total = (t) => byType(c1, t) + byType(c2, t);
  assert.strictEqual(total('IMPUESTO_MUNICIPAL'), 37497, 'el impuesto se cobra entero, repartido entre los dos pagos');
  assert.strictEqual(total('ABL'), 12503, 'el segundo servicio se cobra una vez');
  assert.strictEqual(total('ALQUILER'), 30000, '80.000 cobrados - 50.000 de servicios');
  assert.strictEqual(positivos(c1) + positivos(c2), 80000, 'entre los dos recibos se imputan los 80.000');
});

// ── la regla de honorarios, confirmada por el usuario (2026-08-28):
//    base = alquiler cobrado (ya neto de descuento) + punitorios cobrados.
//    El orden de imputacion del pago NO cambia: servicios primero, alquiler despues.

async function liquidacionCon({ rentAmount, services, amountPaid, concepts, punitoryAmount = 0 }) {
  const record = {
    id: 'mr-1', monthNumber: 5, periodMonth: 7, periodYear: 2026, rentAmount,
    punitoryAmount, punitoryDays: punitoryAmount > 0 ? 20 : 0, punitoryForgiven: false,
    includeIva: false, ivaAmount: 0, previousBalance: 0,
    amountPaid, balance: 0, status: 'PARTIAL', isPaid: false, isCancelled: false, fullPaymentDate: null,
    services,
    transactions: [{ paymentDate: new Date(2026, 6, 5, 12, 0, 0), amount: amountPaid, punitoryForgiven: false, concepts }],
    contract: {
      id: 'c-1', contractType: 'INQUILINO', tenant: null,
      contractTenants: [{ isPrimary: true, tenant: { name: 'X', dni: '1', email: null, phone: null } }],
      property: { address: 'Test', floor: null, apartment: null,
        owner: { name: 'D', dni: '2', email: null, phone: null, transferBeneficiary: null }, transferBeneficiary: null },
      rentHistory: [],
    },
  };
  const empresa = { nombre:'T', subtitulo:'', direccion:'', ciudad:'', telefono:'', email:'', cuit:'', currency:'ARS', banco:{} };
  return buildLiquidacionFromRecord(record, empresa, 7, 2026, { honorariosPercent: 10, holidays: [] });
}

const svcDesc = [
  { id: 's1', amount: 50000, conceptType: { category: 'IMPUESTO', label: 'Servicios', name: 'SERVICIOS' } },
  { id: 's2', amount: 60000, conceptType: { category: 'DESCUENTO', label: 'Descuento', name: 'DESCUENTO' } },
];

test('honorarios - mes pagado entero: base = alquiler 100.000 - descuento 60.000', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { rentAmount: 100000, services: [
    svcRow('SERVICIOS', 50000), svcRow('DESCUENTO', 60000, 'DESCUENTO'),
  ]});
  const concepts = await cobrar(svc, 90000); // 100.000 + 50.000 - 60.000

  const r = await liquidacionCon({ rentAmount: 100000, services: svcDesc, amountPaid: 90000, concepts });
  assert.strictEqual(r.subtotalAlquileresCobrado, 40000, 'alquiler neto de descuento');
  assert.strictEqual(r.honorariosCobrado, 4000, '10% de 40.000');
});

test('honorarios - los punitorios cobrados SUMAN a la base', async () => {
  // Mismo mes, pero con 12.000 de punitorios ya imputados en el pago.
  const concepts = [
    { type: 'SERVICIOS', amount: 50000, description: 'Servicios' },
    { type: 'DESCUENTO', amount: -60000, description: 'Descuento' },
    { type: 'ALQUILER', amount: 40000, description: 'Alquiler' },
    { type: 'PUNITORIOS', amount: 12000, description: 'Punitorios por mora' },
  ];
  const r = await liquidacionCon({
    rentAmount: 100000, services: svcDesc, amountPaid: 102000, concepts, punitoryAmount: 12000,
  });
  assert.strictEqual(r.subtotalAlquileresCobrado, 52000, 'base = 40.000 de alquiler + 12.000 de punitorios');
  assert.strictEqual(r.honorariosCobrado, 5200, '10% de 52.000');
});

test('honorarios - SIN descuento la base no se mueve (lo que ya andaba bien)', async () => {
  const prisma = makeFakePrisma();
  const svc = makeService(prisma);
  await makeRecord(prisma, { rentAmount: 100000, services: [svcRow('SERVICIOS', 50000)] });
  const concepts = await cobrar(svc, 80000); // servicios 50.000 + alquiler 30.000

  const r = await liquidacionCon({
    rentAmount: 100000,
    services: [{ id: 's1', amount: 50000, conceptType: { category: 'IMPUESTO', label: 'Servicios', name: 'SERVICIOS' } }],
    amountPaid: 80000, concepts,
  });
  assert.strictEqual(r.subtotalAlquileresCobrado, 30000, 'alquiler realmente cobrado');
  assert.strictEqual(r.honorariosCobrado, 3000);
});
