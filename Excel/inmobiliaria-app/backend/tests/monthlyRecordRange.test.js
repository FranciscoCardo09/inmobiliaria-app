const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const fakePrisma = makeFakePrisma();
const {
  isContractInRangeForMonth,
  canCreateRecordForContract,
  getMonthNumber,
} = proxyquire('../src/services/monthlyRecordService', {
  '../lib/prisma': fakePrisma,
  './debtService': { calculateDebtPunitory: async () => ({ amount: 0, days: 0, remainingDebt: 0 }), preloadDebtDependencies: async () => ({ contractMap: new Map(), holidayMap: new Map(), monthlyRecordMap: new Map() }) },
});

test('isContractInRangeForMonth - true when monthNumber inside [startMonth..endMonth]', () => {
  const contract = { startMonth: 1, durationMonths: 24, active: true };
  assert.strictEqual(isContractInRangeForMonth(contract, 1), true);
  assert.strictEqual(isContractInRangeForMonth(contract, 12), true);
  assert.strictEqual(isContractInRangeForMonth(contract, 24), true);
});

test('isContractInRangeForMonth - false when outside range', () => {
  const contract = { startMonth: 1, durationMonths: 24, active: true };
  assert.strictEqual(isContractInRangeForMonth(contract, 0), false);
  assert.strictEqual(isContractInRangeForMonth(contract, 25), false);
  assert.strictEqual(isContractInRangeForMonth(contract, -5), false);
});

test('isContractInRangeForMonth - no longer gates on active=false (renewed contracts pass)', () => {
  // This is the central fix: a renewed (inactive) contract still owns its
  // historical periods. The range check is now ONLY about the month number.
  const contract = { startMonth: 1, durationMonths: 24, active: false, renewedAt: new Date() };
  assert.strictEqual(isContractInRangeForMonth(contract, 5), true);
});

test('isContractInRangeForMonth - rescinded contract caps at rescission month', () => {
  // Local-tz dates so getMonth()/getFullYear() align with the period numbers we expect.
  const contract = {
    startMonth: 1,
    durationMonths: 24,
    active: true,
    startDate: new Date(2024, 0, 1), // Jan 1, 2024 local
    rescindedAt: new Date(2024, 5, 15), // June 15, 2024 local (month 6 of contract)
  };
  assert.strictEqual(isContractInRangeForMonth(contract, 6), true);
  assert.strictEqual(isContractInRangeForMonth(contract, 7), false, 'past rescission month');
});

test('canCreateRecordForContract - only true for active contracts', () => {
  assert.strictEqual(canCreateRecordForContract({ active: true }), true);
  assert.strictEqual(canCreateRecordForContract({ active: false, renewedAt: new Date() }), false);
  assert.strictEqual(canCreateRecordForContract({ active: false, renewedAt: null }), false);
});

// ─────────────────────────────────────────────────────────────
// Renovación anticipada: qué contrato "gana" cada mes en Control Mensual
//
// Replica la selección de getOrCreateMonthlyRecords (getMonthNumber +
// isContractInRangeForMonth + canCreateRecordForContract) sobre el par de
// contratos que deja una renovación anticipada: el viejo sigue active=true
// hasta su vencimiento y el nuevo arranca el mes siguiente.
// ─────────────────────────────────────────────────────────────

// Contrato viejo: enero 2026, 6 meses => último mes = junio 2026.
const OLD = {
  id: 'old',
  startDate: new Date(2026, 0, 1),
  startMonth: 1,
  durationMonths: 6,
  active: true,            // renovación anticipada: NO se desactiva
  renewedAt: new Date(2026, 4, 10), // renovado en mayo, con 2 meses por delante
  rescindedAt: null,
};
// Contrato nuevo: arranca julio 2026 (mes siguiente al vencimiento del viejo).
const NEW = {
  id: 'new',
  startDate: new Date(2026, 6, 1),
  startMonth: 1,
  durationMonths: 24,
  active: true,
  renewedAt: null,
  rescindedAt: null,
  renewedFromContractId: 'old',
};

// Devuelve los contratos que Control Mensual mostraría en ese mes calendario,
// junto con si puede crear el registro mensual.
function selectForPeriod(month, year) {
  return [OLD, NEW]
    .map((contract) => ({ contract, monthNumber: getMonthNumber(contract, month, year) }))
    .filter(({ contract, monthNumber }) => isContractInRangeForMonth(contract, monthNumber))
    .map(({ contract, monthNumber }) => ({
      id: contract.id,
      monthNumber,
      canCreate: canCreateRecordForContract(contract),
    }));
}

test('renovación anticipada - los meses restantes del contrato viejo siguen operativos', () => {
  // Mayo (mes de la renovación) y junio (último mes) siguen siendo del viejo,
  // y con canCreate=true: si fuera false, la fila desaparecería de Control
  // Mensual (no se crea el MonthlyRecord) y no se podría cobrar ni cerrar el mes.
  for (const [month, monthNumber] of [[5, 5], [6, 6]]) {
    const selected = selectForPeriod(month, 2026);
    assert.deepStrictEqual(
      selected,
      [{ id: 'old', monthNumber, canCreate: true }],
      `en ${month}/2026 debe operar solo el contrato viejo`
    );
  }
});

test('renovación anticipada - desde su fecha de inicio manda el contrato nuevo', () => {
  const julio = selectForPeriod(7, 2026);
  assert.deepStrictEqual(
    julio,
    [{ id: 'new', monthNumber: 1, canCreate: true }],
    'julio es el mes 1 del contrato nuevo, y el viejo ya no aparece'
  );

  const agosto = selectForPeriod(8, 2026);
  assert.deepStrictEqual(agosto, [{ id: 'new', monthNumber: 2, canCreate: true }]);
});

test('renovación anticipada - nunca hay dos contratos para la misma propiedad en un mes', () => {
  for (let m = 1; m <= 12; m++) {
    assert.ok(
      selectForPeriod(m, 2026).length <= 1,
      `${m}/2026 devolvió más de un contrato para la misma propiedad`
    );
  }
});

test('renovación anticipada - el contrato viejo no genera su mes extra post-vencimiento', () => {
  // getOrCreateMonthlyRecords agrega un mes extra ($0 de alquiler, solo los
  // servicios del último mes) en endMonth+1, pero NO para contratos renovados.
  // Acá ese mes es julio, que ya es el mes 1 del contrato nuevo: sin este guard
  // habría dos filas de la misma propiedad en julio.
  const isPostExpiryMonth = (contract, month, year) => {
    const monthNumber = getMonthNumber(contract, month, year);
    const endMonth = contract.startMonth + contract.durationMonths - 1;
    return (
      monthNumber === endMonth + 1 &&
      contract.active &&
      !contract.renewedAt &&
      !contract.rescindedAt
    );
  };

  assert.strictEqual(isPostExpiryMonth(OLD, 7, 2026), false, 'renovado => sin mes extra');
  // Control: el mismo contrato sin renovar sí lo genera.
  assert.strictEqual(isPostExpiryMonth({ ...OLD, renewedAt: null }, 7, 2026), true);
});

test('renovación anticipada - el contrato nuevo no aparece antes de su fecha de inicio', () => {
  // Meses previos al inicio del nuevo: monthNumber < startMonth => fuera de rango.
  for (const m of [1, 4, 6]) {
    assert.ok(
      !selectForPeriod(m, 2026).some((s) => s.id === 'new'),
      `el contrato nuevo no debe aparecer en ${m}/2026`
    );
  }
});
