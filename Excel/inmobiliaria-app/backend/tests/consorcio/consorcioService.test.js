const test = require('node:test');
const assert = require('node:assert');
const { makeService, statementBase64, monthBase64, CBU } = require('./helpers/setup');
const { CUIT } = require('./helpers/julio');

const G = 'grupo-1';
const OTRO = 'grupo-2';

async function expectError(promise, code, status) {
  await assert.rejects(promise, (e) => {
    assert.strictEqual(e.code, code, e.message);
    if (status) assert.strictEqual(e.status, status);
    return true;
  });
}

let JULIO;
test.before(async () => {
  JULIO = await statementBase64();
});

async function withConsorcio(extra = {}) {
  const ctx = makeService();
  const consorcio = await ctx.service.createConsorcio(G, { name: 'Portal del Hierro , Torre I', cbu: CBU, ...extra });
  const rubros = await ctx.fake.consorcioRubro.findMany({ where: { consorcioId: consorcio.id } });
  const rubro = (n) => rubros.find((r) => r.number === n);
  return { ...ctx, consorcio, rubro };
}

async function withJulio(extra) {
  const ctx = await withConsorcio(extra);
  const up = await ctx.service.uploadStatement(G, ctx.consorcio.id, { fileBase64: JULIO, fileName: 'Extracto Julio - 26.pdf' });
  const movs = await ctx.fake.rendicionMovimiento.findMany({ where: { rendicionId: up.rendicionId } });
  return { ...ctx, rid: up.rendicionId, up, movs };
}

// ─────────── Consorcios ───────────

test('crear consorcio carga los 10 rubros por defecto; el CBU no se repite en el grupo', async () => {
  const { service, consorcio } = await withConsorcio({ bankAccountName: 'EDIFICIO X', initialReserveCents: 100, reserveLabel: 'Reserva' });
  const full = await service.getConsorcio(G, consorcio.id);
  assert.strictEqual(full.rubros.length, 10);
  assert.strictEqual(full.rubros[0].name, 'Ingresos del periodo');
  assert.strictEqual(full.bankAccountName, 'EDIFICIO X');
  assert.strictEqual(full.reserveLabel, 'Reserva');
  await expectError(service.createConsorcio(G, { name: 'Otro', cbu: CBU }), 'CBU_IN_USE', 409);
  // en otro grupo sí puede
  await service.createConsorcio(OTRO, { name: 'Otro', cbu: CBU });
  assert.strictEqual((await service.listConsorcios(G)).length, 1);
  const sinExtras = await service.createConsorcio(G, { name: 'B', cbu: '1'.repeat(22) });
  assert.strictEqual(sinExtras.reserveLabel, 'Reserva Caja');
  assert.strictEqual(sinExtras.initialReserveCents, null);
});

test('get/update/delete de un consorcio de otro grupo → NOT_FOUND', async () => {
  const { service, consorcio } = await withConsorcio();
  await expectError(service.getConsorcio(OTRO, consorcio.id), 'NOT_FOUND', 404);
  await expectError(service.updateConsorcio(OTRO, consorcio.id, { name: 'x' }), 'NOT_FOUND', 404);
  await expectError(service.deleteConsorcio(OTRO, consorcio.id), 'NOT_FOUND', 404);
  await expectError(service.listRendiciones(OTRO, consorcio.id), 'NOT_FOUND', 404);
  await expectError(service.uploadStatement(OTRO, consorcio.id, { fileBase64: JULIO }), 'NOT_FOUND', 404);
});

test('update: cambia datos y valida que el CBU nuevo no esté usado', async () => {
  const { service, consorcio } = await withConsorcio();
  const otro = await service.createConsorcio(G, { name: 'B', cbu: '1'.repeat(22) });
  await expectError(service.updateConsorcio(G, otro.id, { cbu: CBU }), 'CBU_IN_USE', 409);
  assert.strictEqual((await service.updateConsorcio(G, consorcio.id, { cbu: CBU, name: 'Nuevo' })).name, 'Nuevo');
  assert.strictEqual((await service.updateConsorcio(G, consorcio.id, { isActive: false })).isActive, false);
});

test('delete: no se puede con rendiciones; sin ellas borra rubros y reglas', async () => {
  const ctx = await withJulio();
  await expectError(ctx.service.deleteConsorcio(G, ctx.consorcio.id), 'HAS_RENDICIONES', 409);
  const limpio = await withConsorcio();
  await limpio.service.createRegla(G, limpio.consorcio.id, { matchCuit: CUIT.limpieza, rubroId: limpio.rubro(2).id, itemLabel: 'L' });
  await limpio.service.deleteConsorcio(G, limpio.consorcio.id);
  assert.strictEqual(limpio.fake.consorcio._rows.length, 0);
  assert.strictEqual(limpio.fake.consorcioRubro._rows.length, 0);
  assert.strictEqual(limpio.fake.consorcioRegla._rows.length, 0);
});

// ─────────── Rubros ───────────

test('rubros: número y rol únicos; editar; borrar sólo si no se usa', async () => {
  const { service, consorcio, rubro, fake } = await withJulio();
  await expectError(service.createRubro(G, consorcio.id, { number: 3, name: 'X', kind: 'EGRESO' }), 'RUBRO_NUMBER_IN_USE', 409);
  await expectError(service.createRubro(G, consorcio.id, { number: 11, name: 'X', kind: 'EGRESO', role: 'RESERVA' }), 'ROLE_IN_USE', 409);
  const nuevo = await service.createRubro(G, consorcio.id, { number: 11, name: 'Obras', kind: 'EGRESO' });
  assert.strictEqual((await service.updateRubro(G, consorcio.id, nuevo.id, { number: 11, name: 'Obras grandes' })).name, 'Obras grandes');
  await expectError(service.updateRubro(G, consorcio.id, 'no-existe', { name: 'x' }), 'UNKNOWN_RUBRO', 400);
  await expectError(service.updateRubro(G, consorcio.id, nuevo.id, { role: 'INGRESOS' }), 'ROLE_IN_USE', 409);

  // en uso por movimientos (Ingresos: los créditos automáticos)
  await expectError(service.deleteRubro(G, consorcio.id, rubro(1).id), 'RUBRO_IN_USE', 409);
  // en uso por una regla
  await service.createRegla(G, consorcio.id, { matchCuit: CUIT.limpieza, rubroId: nuevo.id, itemLabel: 'X' });
  await expectError(service.deleteRubro(G, consorcio.id, nuevo.id), 'RUBRO_IN_USE', 409);
  // en uso por un ajuste
  const r12 = await service.createRubro(G, consorcio.id, { number: 12, name: 'Extra', kind: 'EGRESO' });
  const rend = fake.rendicion._rows[0];
  await service.createAjuste(G, rend.id, { kind: 'MANUAL', rubroId: r12.id, itemLabel: 'X', amountCents: 1, note: 'n' });
  await expectError(service.deleteRubro(G, consorcio.id, r12.id), 'RUBRO_IN_USE', 409);
  // libre
  const r13 = await service.createRubro(G, consorcio.id, { number: 13, name: 'Libre', kind: 'EGRESO' });
  await service.deleteRubro(G, consorcio.id, r13.id);
  assert.ok(!fake.consorcioRubro._rows.some((r) => r.id === r13.id));
});

// ─────────── Reglas ───────────

test('reglas: crear con rubro del consorcio; editar; no dejarla sin condición; borrar', async () => {
  const { service, consorcio, rubro } = await withConsorcio();
  await expectError(service.createRegla(G, consorcio.id, { matchCuit: CUIT.limpieza, rubroId: 'otro', itemLabel: 'L' }), 'UNKNOWN_RUBRO', 400);
  const regla = await service.createRegla(G, consorcio.id, { matchCuit: CUIT.limpieza, rubroId: rubro(2).id, itemLabel: 'Limpieza' });
  const full = await service.getConsorcio(G, consorcio.id);
  assert.match(full.reglas[0].description, /Si el CUIT es 23444444445 → va a 02 Servicio de Limpieza «Limpieza»/);

  const upd = await service.updateRegla(G, consorcio.id, regla.id, { rubroId: rubro(3).id, matchText: 'LIMPIEZA' });
  assert.strictEqual(upd.rubroId, rubro(3).id);
  assert.strictEqual((await service.updateRegla(G, consorcio.id, regla.id, { priority: 3 })).priority, 3);
  await expectError(service.updateRegla(G, consorcio.id, regla.id, { matchCuit: null, matchText: null }), 'RULE_WITHOUT_CONDITION', 400);
  await expectError(service.updateRegla(G, consorcio.id, 'nope', { priority: 1 }), 'NOT_FOUND', 404);
  await service.deleteRegla(G, consorcio.id, regla.id);
  await expectError(service.deleteRegla(G, consorcio.id, regla.id), 'NOT_FOUND', 404);
});

// ─────────── Subir extracto ───────────

test('subir julio: 101 movimientos, cobranzas y gastos bancarios automáticos, transferencias pendientes', async () => {
  const { movs, up, service, rid, consorcio } = await withJulio();
  assert.deepStrictEqual(up, { rendicionId: rid, replaced: false, keptManual: 0 });
  assert.strictEqual(movs.length, 101);
  const auto = movs.filter((m) => m.status === 'AUTO');
  const pend = movs.filter((m) => m.status === 'PENDIENTE');
  assert.strictEqual(auto.length, 81);
  assert.strictEqual(pend.length, 20);
  assert.ok(pend.every((m) => ['161', '172', '190'].includes(m.conceptCode)));

  const r = await service.getRendicion(G, rid);
  assert.strictEqual(r.rendicion.year, 2026);
  assert.strictEqual(r.rendicion.month, 7);
  assert.strictEqual(r.rendicion.fileName, 'Extracto Julio - 26.pdf');
  assert.strictEqual(r.report.canGenerate, false);
  assert.deepStrictEqual(r.report.blockers.map((b) => b.code), ['PENDING_MOVEMENTS', 'MISSING_RESERVE']);
  const list = await service.listRendiciones(G, consorcio.id);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'BORRADOR');
});

test('subir: archivo grande, que no es PDF, de otra cuenta, o que no es de un mes completo', async () => {
  const { service, consorcio, fake } = await withConsorcio();
  const big = Buffer.alloc(service.MAX_PDF_BYTES + 1).toString('base64');
  await expectError(service.uploadStatement(G, consorcio.id, { fileBase64: big }), 'FILE_TOO_LARGE', 400);
  await expectError(service.uploadStatement(G, consorcio.id, { fileBase64: Buffer.from('hola').toString('base64') }), 'NOT_PDF', 400);

  await service.updateConsorcio(G, consorcio.id, { cbu: '9'.repeat(22) });
  await assert.rejects(service.uploadStatement(G, consorcio.id, { fileBase64: JULIO }),
    (e) => e.code === 'CBU_MISMATCH' && /EDIFICIO DE PRUEBA 123/.test(e.message));
  const sinNombre = await statementBase64((s) => { s.header.accountName = ''; return s; });
  await assert.rejects(service.uploadStatement(G, consorcio.id, { fileBase64: sinNombre }),
    (e) => e.code === 'CBU_MISMATCH' && /CBU 2470005610000009999990, pero/.test(e.message));
  await service.updateConsorcio(G, consorcio.id, { cbu: CBU });

  const periods = [['2/7/2026', '31/7/2026'], ['1/7/2026', '30/7/2026'], ['1/7/2026', '31/8/2026'], ['1/7/2026', '31/7/2027']];
  for (const [from, to] of periods) {
    const b64 = await statementBase64((s) => {
      s.header.from = from;
      s.header.to = to;
      s.movements = s.movements.filter((m) => m.date !== '01/07/2026' && m.date !== '31/07/2026');
      return s;
    });
    await expectError(service.uploadStatement(G, consorcio.id, { fileBase64: b64 }), 'PERIOD_NOT_MONTH', 400);
  }
  assert.strictEqual(fake.rendicion._rows.length, 0);
});

test('subir: acepta el prefijo data:application/pdf', async () => {
  const { service, consorcio } = await withConsorcio();
  const up = await service.uploadStatement(G, consorcio.id, { fileBase64: `data:application/pdf;base64,${JULIO}` });
  assert.ok(up.rendicionId);
});

test('subir el mismo extracto otra vez → DUPLICATE_FILE (aunque sea otra descarga del mismo PDF)', async () => {
  const { service, consorcio, rid } = await withJulio();
  await assert.rejects(service.uploadStatement(G, consorcio.id, { fileBase64: JULIO, replace: true }),
    (e) => e.code === 'DUPLICATE_FILE' && e.details.rendicionId === rid && /Julio 2026/.test(e.message));
  const otraDescarga = await statementBase64();
  assert.notStrictEqual(otraDescarga, JULIO); // bytes distintos (fecha de creación del PDF)
  await expectError(service.uploadStatement(G, consorcio.id, { fileBase64: otraDescarga }), 'DUPLICATE_FILE', 409);
});

test('otro extracto del mismo mes: pide confirmar; al reemplazar conserva lo manual', async () => {
  const { service, consorcio, rid, movs, rubro } = await withJulio();
  const excluida = movs.find((m) => m.cuit === CUIT.excluida);
  const vig = movs.filter((m) => m.cuit === CUIT.vigilancia);
  await service.classifyMovements(G, rid, [
    { movementId: excluida.id, action: 'EXCLUIR', note: 'No es del consorcio' },
    { movementId: vig[0].id, action: 'ASIGNAR', rubroId: rubro(3).id, itemLabel: 'Vigilancia' },
  ]);
  await service.createAjuste(G, rid, { kind: 'MANUAL', rubroId: rubro(7).id, itemLabel: 'Caja chica', amountCents: 100, note: 'n' });

  // corregido por el banco: cambia el último movimiento (y por lo tanto el saldo)
  const corregido = await statementBase64((s) => { s.movements[s.movements.length - 1].cents -= 100; return s; });
  await assert.rejects(service.uploadStatement(G, consorcio.id, { fileBase64: corregido }),
    (e) => e.code === 'REQUIRES_REPLACE' && e.details.rendicionId === rid);
  const up = await service.uploadStatement(G, consorcio.id, { fileBase64: corregido, replace: true, fileName: 'corregido.pdf' });
  assert.deepStrictEqual(up, { rendicionId: rid, replaced: true, keptManual: 2 });

  const r = await service.getRendicion(G, rid);
  assert.strictEqual(r.movimientos.length, 101);
  assert.strictEqual(r.movimientos.find((m) => m.cuit === CUIT.excluida).status, 'EXCLUIDO');
  assert.strictEqual(r.movimientos.filter((m) => m.status === 'MANUAL').length, 1);
  assert.strictEqual(r.ajustes.length, 1);
  assert.strictEqual(r.rendicion.fileName, 'corregido.pdf');
  // el movimiento que cambió (Vigilancia 31/07) perdió la huella: vuelve a pendiente
  assert.strictEqual(r.movimientos.find((m) => m.cuit === CUIT.vigilancia && m.status !== 'MANUAL').status, 'PENDIENTE');
});

// ─────────── Clasificar ───────────

test('clasificar: validaciones antes de escribir nada', async () => {
  const { service, rid, movs, rubro } = await withJulio();
  const vig = movs.find((m) => m.cuit === CUIT.vigilancia);
  const fee = movs.find((m) => m.conceptCode === '148');
  await expectError(service.classifyMovements(G, rid, [{ movementId: 'nope', action: 'AUTO' }]), 'UNKNOWN_MOVEMENT', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: vig.id, action: 'BORRAR' }]), 'BAD_ACTION', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: vig.id, action: 'ASIGNAR', rubroId: 'x', itemLabel: 'V' }]), 'UNKNOWN_RUBRO', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: vig.id, action: 'ASIGNAR', rubroId: rubro(3).id, itemLabel: '  ' }]), 'MISSING_ITEM_LABEL', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: vig.id, action: 'ASIGNAR', rubroId: rubro(3).id }]), 'MISSING_ITEM_LABEL', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: fee.id, action: 'ASIGNAR', rubroId: rubro(8).id, itemLabel: 'X', remember: 'SIEMPRE' }]), 'CANNOT_REMEMBER', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: vig.id, action: 'EXCLUIR' }]), 'EXCLUDED_WITHOUT_NOTE', 400);
  await expectError(service.classifyMovements(G, rid, [{ movementId: vig.id, action: 'EXCLUIR', note: ' ' }]), 'EXCLUDED_WITHOUT_NOTE', 400);
  // una sola inválida frena todo el lote
  await expectError(service.classifyMovements(G, rid, [
    { movementId: vig.id, action: 'ASIGNAR', rubroId: rubro(3).id, itemLabel: 'V' },
    { movementId: 'nope', action: 'AUTO' },
  ]), 'UNKNOWN_MOVEMENT');
  const after = await service.getRendicion(G, rid);
  assert.strictEqual(after.movimientos.find((m) => m.id === vig.id).status, 'PENDIENTE');
  await expectError(service.classifyMovements(OTRO, rid, []), 'NOT_FOUND', 404);
});

test('clasificar a mano con "Recordar siempre" crea la regla y resuelve los demás del mismo CUIT', async () => {
  const { service, rid, movs, rubro, fake } = await withJulio();
  const [v1, v2] = movs.filter((m) => m.cuit === CUIT.vigilancia);
  const r = await service.classifyMovements(G, rid, [{ movementId: v1.id, action: 'ASIGNAR', rubroId: rubro(3).id, itemLabel: ' Torres ', note: 'quincena', remember: 'SIEMPRE' }]);
  const m1 = r.movimientos.find((m) => m.id === v1.id);
  const m2 = r.movimientos.find((m) => m.id === v2.id);
  assert.strictEqual(m1.status, 'MANUAL');
  assert.strictEqual(m1.itemLabel, 'Torres');
  assert.strictEqual(m1.note, 'quincena');
  assert.match(m1.reason, /Elegido a mano → 03 Servicio de Vigilancia «Torres»/);
  assert.strictEqual(m2.status, 'REGLA');
  assert.match(m2.reason, /Por regla: Si el CUIT es 27777777778 y es un débito/);
  assert.strictEqual(fake.consorcioRegla._rows.length, 1);
  // otra vez "siempre" con otro destino: actualiza la misma regla
  await service.classifyMovements(G, rid, [{ movementId: v1.id, action: 'ASIGNAR', rubroId: rubro(2).id, itemLabel: 'Otro', remember: 'SIEMPRE' }]);
  assert.strictEqual(fake.consorcioRegla._rows.length, 1);
  assert.strictEqual(fake.consorcioRegla._rows[0].itemLabel, 'Otro');
});

test('"Recordar preguntando" deja los pagos del mismo CUIT pendientes con sugerencias', async () => {
  const { service, rid, movs, rubro } = await withJulio();
  const pagos = movs.filter((m) => m.cuit === CUIT.pagos);
  assert.strictEqual(pagos.length, 4);
  const r = await service.classifyMovements(G, rid, [
    { movementId: pagos[0].id, action: 'ASIGNAR', rubroId: rubro(10).id, itemLabel: 'Municipal', remember: 'PREGUNTAR' },
    { movementId: pagos[3].id, action: 'ASIGNAR', rubroId: rubro(7).id, itemLabel: 'Luz común', remember: 'PREGUNTAR' },
  ]);
  const others = r.movimientos.filter((m) => m.cuit === CUIT.pagos && m.status === 'PENDIENTE');
  assert.strictEqual(others.length, 2);
  assert.deepStrictEqual(others[0].suggestions.map((s) => s.itemLabel), ['Municipal', 'Luz común']);
});

test('excluir y volver a automático', async () => {
  const { service, rid, movs } = await withJulio();
  const cred = movs.find((m) => m.status === 'AUTO' && m.amountCents > 0);
  let r = await service.classifyMovements(G, rid, [{ movementId: cred.id, action: 'EXCLUIR', note: ' Reintegro ' }]);
  const ex = r.movimientos.find((m) => m.id === cred.id);
  assert.strictEqual(ex.status, 'EXCLUIDO');
  assert.strictEqual(ex.note, 'Reintegro');
  assert.strictEqual(r.report.excluded.length, 1);
  r = await service.classifyMovements(G, rid, [{ movementId: cred.id, action: 'AUTO' }]);
  assert.strictEqual(r.movimientos.find((m) => m.id === cred.id).status, 'AUTO');
});

test('reaplicar reglas después de crear una regla nueva', async () => {
  const { service, rid, consorcio, rubro } = await withJulio();
  await service.createRegla(G, consorcio.id, { matchCuit: CUIT.ascensor, rubroId: rubro(5).id, itemLabel: 'Service Ascensor' });
  const r = await service.reapplyRules(G, rid);
  assert.strictEqual(r.changed, 101); // todo lo no manual se recalcula
  assert.strictEqual(r.movimientos.find((m) => m.cuit === CUIT.ascensor).status, 'REGLA');
  await expectError(service.reapplyRules(OTRO, rid), 'NOT_FOUND', 404);
});

// ─────────── Ajustes, reserva, orden ───────────

test('ajustes: crear, editar, borrar; ajeno o inexistente', async () => {
  const { service, rid, rubro } = await withJulio();
  let r = await service.createAjuste(G, rid, { kind: 'AJUSTE', rubroId: rubro(8).id, itemLabel: ' Mantenimiento de cuenta (Impuestos y Comisiones) ', amountCents: 13763987, note: ' junio ' });
  const aj = r.ajustes[0];
  assert.strictEqual(aj.itemLabel, 'Mantenimiento de cuenta (Impuestos y Comisiones)');
  assert.strictEqual(aj.note, 'junio');
  const bancarios = r.report.sections.find((s) => s.rubro.number === 8).lines[0];
  assert.strictEqual(bancarios.computedCents, 12408706);
  assert.strictEqual(bancarios.finalCents, 13763987);

  r = await service.updateAjuste(G, rid, aj.id, { amountCents: 13000000 });
  assert.strictEqual(r.ajustes[0].amountCents, 13000000);
  await expectError(service.updateAjuste(G, rid, aj.id, { rubroId: 'x' }), 'UNKNOWN_RUBRO', 400);
  r = await service.updateAjuste(G, rid, aj.id, { rubroId: rubro(8).id });
  await expectError(service.updateAjuste(G, rid, 'nope', {}), 'NOT_FOUND', 404);
  await expectError(service.createAjuste(G, rid, { kind: 'MANUAL', rubroId: 'x', itemLabel: 'a', amountCents: 1, note: 'n' }), 'UNKNOWN_RUBRO', 400);
  r = await service.deleteAjuste(G, rid, aj.id);
  assert.strictEqual(r.ajustes.length, 0);
  await expectError(service.deleteAjuste(G, rid, aj.id), 'NOT_FOUND', 404);
});

test('reserva manual / automática y orden de líneas', async () => {
  const { service, rid, rubro } = await withJulio();
  let r = await service.setReserve(G, rid, { mode: 'MANUAL', cents: 457207857, note: 'Total del informe de junio' });
  assert.strictEqual(r.report.totals.reserveCents, 457207857);
  assert.strictEqual(r.report.totals.reserveSource, 'MANUAL');
  r = await service.setReserve(G, rid, { mode: 'AUTO' });
  assert.strictEqual(r.report.totals.reserveCents, null);
  const key = `${rubro(5).id}::service ascensor`;
  r = await service.setLineOrder(G, rid, [key]);
  assert.deepStrictEqual(r.rendicion.lineOrder, [key]);
});

// ─────────── Reserva Caja entre meses ───────────

test('reserva: inicial del consorcio, falta, mes anterior abierto, hueco, mes anterior cerrado', async () => {
  const ctx = await withConsorcio();
  const { service, consorcio } = ctx;
  const julio = await service.uploadStatement(G, consorcio.id, { fileBase64: JULIO });
  let r = await service.getRendicion(G, julio.rendicionId);
  assert.match(r.report.blockers.find((b) => b.code === 'MISSING_RESERVE').message, /primera rendición/);

  await service.updateConsorcio(G, consorcio.id, { initialReserveCents: 1000 });
  r = await service.getRendicion(G, julio.rendicionId);
  assert.deepStrictEqual([r.report.totals.reserveCents, r.report.totals.reserveSource], [1000, 'INICIAL']);

  const ago = await service.uploadStatement(G, consorcio.id, { fileBase64: await monthBase64(2026, 8, [{ voucher: '1', concept: '580', desc: 'CREDITO QR', cents: 100 }]) });
  r = await service.getRendicion(G, ago.rendicionId);
  assert.match(r.report.blockers.find((b) => b.code === 'MISSING_RESERVE').message, /Julio 2026 todavía no está cerrada/);

  const oct = await service.uploadStatement(G, consorcio.id, { fileBase64: await monthBase64(2026, 10, [{ voucher: '1', concept: '580', desc: 'CREDITO QR', cents: 100 }]) });
  r = await service.getRendicion(G, oct.rendicionId);
  assert.match(r.report.blockers.find((b) => b.code === 'MISSING_RESERVE').message, /Falta la rendición de Septiembre 2026/);

  // agosto: cuando julio cierra, la reserva es su Total Caja
  const jr = await service.getRendicion(G, julio.rendicionId);
  await service.classifyMovements(G, julio.rendicionId, jr.movimientos.filter((m) => m.status === 'PENDIENTE')
    .map((m) => ({ movementId: m.id, action: 'EXCLUIR', note: 'prueba' })));
  const closed = await service.closeRendicion(G, julio.rendicionId, 'user-1');
  r = await service.getRendicion(G, ago.rendicionId);
  assert.strictEqual(r.report.totals.reserveCents, closed.rendicion.totalCajaCents);
  assert.strictEqual(r.report.totals.reserveSource, 'ANTERIOR');
});

// ─────────── Cerrar / reabrir / borrar ───────────

async function readyToClose() {
  const ctx = await withJulio({ initialReserveCents: 457207857 });
  const pend = ctx.movs.filter((m) => m.status === 'PENDIENTE');
  await ctx.service.classifyMovements(G, ctx.rid, pend.map((m) => ({ movementId: m.id, action: 'ASIGNAR', rubroId: ctx.rubro(7).id, itemLabel: 'Varios' })));
  return ctx;
}

test('cerrar: bloqueado con pendientes; al cerrar congela el informe y no se puede tocar', async () => {
  const blocked = await withJulio({ initialReserveCents: 1 });
  await assert.rejects(blocked.service.closeRendicion(G, blocked.rid, 'u'),
    (e) => e.code === 'REPORT_BLOCKED' && e.details.blockers[0].code === 'PENDING_MOVEMENTS');

  const { service, rid, rubro, consorcio, fake } = await readyToClose();
  const r = await service.closeRendicion(G, rid, 'user-1');
  assert.strictEqual(r.rendicion.status, 'CERRADA');
  assert.strictEqual(r.rendicion.closedById, 'user-1');
  assert.ok(r.rendicion.closedAt instanceof Date);
  assert.strictEqual(r.rendicion.totalCajaCents, r.report.totals.totalCajaCents);
  assert.strictEqual(r.rendicion.reserveSource, 'INICIAL');

  // cambiar un rubro después del cierre no cambia el informe cerrado
  await service.updateRubro(G, consorcio.id, rubro(7).id, { name: 'Renombrado' });
  const again = await service.getRendicion(G, rid);
  assert.ok(again.report.sections.some((s) => s.rubro.name === 'Gastos Varios'));

  const mv = fake.rendicionMovimiento._rows[0];
  await expectError(service.closeRendicion(G, rid, 'u'), 'RENDICION_CERRADA', 409);
  await expectError(service.classifyMovements(G, rid, [{ movementId: mv.id, action: 'AUTO' }]), 'RENDICION_CERRADA', 409);
  await expectError(service.reapplyRules(G, rid), 'RENDICION_CERRADA', 409);
  await expectError(service.createAjuste(G, rid, {}), 'RENDICION_CERRADA', 409);
  await expectError(service.updateAjuste(G, rid, 'x', {}), 'RENDICION_CERRADA', 409);
  await expectError(service.deleteAjuste(G, rid, 'x'), 'RENDICION_CERRADA', 409);
  await expectError(service.setReserve(G, rid, { mode: 'AUTO' }), 'RENDICION_CERRADA', 409);
  await expectError(service.setLineOrder(G, rid, []), 'RENDICION_CERRADA', 409);
  await expectError(service.deleteRendicion(G, rid), 'RENDICION_CERRADA', 409);
  const otro = await statementBase64((s) => { s.movements[0].cents += 1; return s; });
  await expectError(service.uploadStatement(G, consorcio.id, { fileBase64: otro, replace: true }), 'RENDICION_CERRADA', 409);
});

test('cerrado sin informe congelado (dato viejo) se recalcula con la reserva guardada', async () => {
  const { service, rid, fake } = await readyToClose();
  await service.closeRendicion(G, rid, 'u');
  fake.rendicion._rows[0].snapshot = null;
  const r = await service.getRendicion(G, rid);
  assert.strictEqual(r.report.totals.reserveCents, 457207857);
});

test('reabrir: sólo si está cerrada y el mes siguiente no lo está; conserva la reserva manual', async () => {
  const { service, rid, consorcio } = await readyToClose();
  await expectError(service.reopenRendicion(G, rid), 'NOT_CLOSED', 409);
  await service.setReserve(G, rid, { mode: 'MANUAL', cents: 5, note: 'n' });
  await service.closeRendicion(G, rid, 'u');

  const ago = await service.uploadStatement(G, consorcio.id, { fileBase64: await monthBase64(2026, 8, []) });
  await service.closeRendicion(G, ago.rendicionId, 'u');
  await assert.rejects(service.reopenRendicion(G, rid), (e) => e.code === 'NEXT_CLOSED' && /Agosto 2026/.test(e.message));
  await service.reopenRendicion(G, ago.rendicionId);

  const r = await service.reopenRendicion(G, rid);
  assert.strictEqual(r.rendicion.status, 'BORRADOR');
  assert.strictEqual(r.rendicion.snapshot, null);
  assert.strictEqual(r.rendicion.reserveCents, 5);
  assert.strictEqual(r.report.totals.reserveSource, 'MANUAL');
});

test('reabrir diciembre mira enero del año siguiente; reserva no manual se limpia', async () => {
  const { service, consorcio } = await withConsorcio({ initialReserveCents: 10 });
  const dic = await service.uploadStatement(G, consorcio.id, { fileBase64: await monthBase64(2026, 12, []) });
  await service.closeRendicion(G, dic.rendicionId, 'u');
  const ene = await service.uploadStatement(G, consorcio.id, { fileBase64: await monthBase64(2027, 1, []) });
  const e = await service.getRendicion(G, ene.rendicionId);
  assert.strictEqual(e.report.totals.reserveCents, 10);
  await service.closeRendicion(G, ene.rendicionId, 'u');
  await expectError(service.reopenRendicion(G, dic.rendicionId), 'NEXT_CLOSED');
  await service.reopenRendicion(G, ene.rendicionId);
  const r = await service.reopenRendicion(G, dic.rendicionId);
  assert.strictEqual(r.rendicion.reserveCents, null);
  assert.strictEqual(r.report.totals.reserveSource, 'INICIAL');
});

test('borrar una rendición en borrador borra movimientos y ajustes', async () => {
  const { service, rid, rubro, fake } = await withJulio();
  await service.createAjuste(G, rid, { kind: 'MANUAL', rubroId: rubro(7).id, itemLabel: 'X', amountCents: 1, note: 'n' });
  await service.deleteRendicion(G, rid);
  assert.strictEqual(fake.rendicion._rows.length, 0);
  assert.strictEqual(fake.rendicionMovimiento._rows.length, 0);
  assert.strictEqual(fake.rendicionAjuste._rows.length, 0);
  await expectError(service.getRendicion(G, rid), 'NOT_FOUND', 404);
});

// ─────────── Documentos ───────────

test('generar Word y PDF (con y sin logo del grupo); con pendientes no se puede', async () => {
  const blocked = await withJulio();
  await expectError(blocked.service.generateDocument(G, blocked.rid, 'pdf'), 'REPORT_BLOCKED', 409);

  const { service, rid, fake } = await readyToClose();
  const docx = await service.generateDocument(G, rid, 'docx');
  assert.strictEqual(docx.fileName, 'Rendicion_Portal_del_Hierro_Torre_I_2026-07.docx');
  assert.match(docx.contentType, /wordprocessingml/);
  assert.strictEqual(docx.buffer.subarray(0, 2).toString(), 'PK');
  fake.group._rows.push({ id: G, logo: 'data:image/png;base64,AAAA' });
  const pdf = await service.generateDocument(G, rid, 'pdf');
  assert.strictEqual(pdf.contentType, 'application/pdf');
  assert.strictEqual(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
});
