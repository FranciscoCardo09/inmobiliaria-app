'use strict';

/**
 * `postExpiryChargeFix`: el mes extra post-vencimiento cobra SÓLO servicios.
 * Caso real: Martinez Natalia Noemi (Alem 960), septiembre 2026 — un registro creado
 * con alquiler antes de ser mes extra seguía cobrando $361.000. La cobertura de punta
 * a punta (GET, servicios, cobro, crédito, cierre) está en
 * test/integration/postExpiryRent.test.js.
 *
 * Run: cd inmobiliaria-app/backend && node --test tests/postExpiryChargeFix.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('./helpers/fakePrisma');

const { postExpiryChargeFix } = proxyquire('../src/services/monthlyRecordService', {
  '../lib/prisma': makeFakePrisma(),
  './contractSweepService': { sweepSupersededContracts: async () => {} },
});

const base = { isPostExpiry: true, status: 'PENDING', rentAmount: 0, ivaAmount: 0, includeIva: false };

test('mes extra con alquiler → se lleva a $0 (alquiler, IVA y flag de IVA)', () => {
  assert.deepStrictEqual(
    postExpiryChargeFix({ ...base, rentAmount: 361000 }),
    { rentAmount: 0, ivaAmount: 0, includeIva: false },
  );
});

test('mes extra con sólo IVA o sólo el flag de IVA → también se corrige', () => {
  assert.ok(postExpiryChargeFix({ ...base, ivaAmount: 75810 }));
  assert.ok(postExpiryChargeFix({ ...base, includeIva: true }));
});

test('mes extra PARTIAL también se corrige (sólo COMPLETE queda congelado)', () => {
  assert.ok(postExpiryChargeFix({ ...base, status: 'PARTIAL', rentAmount: 361000 }));
});

test('mes extra ya en $0 → nada que corregir', () => {
  assert.strictEqual(postExpiryChargeFix(base), null);
});

test('mes extra COMPLETE con alquiler → no se toca (A-06)', () => {
  assert.strictEqual(postExpiryChargeFix({ ...base, status: 'COMPLETE', rentAmount: 361000 }), null);
});

test('mes normal (no extra) con alquiler → no se toca', () => {
  assert.strictEqual(postExpiryChargeFix({ ...base, isPostExpiry: false, rentAmount: 361000 }), null);
});

test('registro nulo → null', () => {
  assert.strictEqual(postExpiryChargeFix(null), null);
});
