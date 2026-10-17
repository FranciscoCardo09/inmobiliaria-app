const test = require('node:test');
const assert = require('node:assert');
const c = require('../../src/services/consorcio/classifier');
const { CONCEPTS } = require('../../src/services/consorcio/conceptCodes');
const { pureRubros } = require('./helpers/julio');

const rubros = pureRubros();
const mv = (over = {}) => ({
  amountCents: -10000, conceptCode: '190', description: 'TRANSF.INTERB.DISTINTO TIT. 27777777778 VIGILANCIA PRIVADA',
  cuit: '27777777778', counterparty: 'VIGILANCIA PRIVADA', ...over,
});
const rule = (over = {}) => ({
  id: 'x', matchCuit: '27777777778', matchText: null, matchConcept: null, direction: null, matchAmountCents: null,
  rubroId: 'r3', itemLabel: 'Vigilancia', alwaysAsk: false, priority: 0, isActive: true, ...over,
});

test('cada código de concepto conocido se clasifica solo, en el sentido correcto', () => {
  for (const [code, info] of Object.entries(CONCEPTS)) {
    const credit = info.role === 'INGRESOS';
    const r = c.classifyMovement(mv({ conceptCode: code, amountCents: credit ? 100 : -100, cuit: null, counterparty: null, description: info.label }), [], rubros);
    assert.strictEqual(r.status, 'AUTO', code);
    assert.strictEqual(r.rubroId, credit ? 'r1' : 'r8', code);
    assert.strictEqual(r.itemLabel, credit ? 'Gastos Comunes {mesAnterior}' : 'Mantenimiento de cuenta (Impuestos y Comisiones)');
    assert.match(r.reason, new RegExp(`código ${code}`));
  }
});

test('código conocido pero en el sentido contrario → pendiente con explicación', () => {
  const credit = c.classifyMovement(mv({ conceptCode: '580', amountCents: -100 }), [], rubros);
  assert.strictEqual(credit.status, 'PENDIENTE');
  assert.match(credit.reason, /normalmente es un crédito/);
  const fee = c.classifyMovement(mv({ conceptCode: '148', amountCents: 100 }), [], rubros);
  assert.match(fee.reason, /normalmente es un débito/);
});

test('código conocido sin rubro marcado → pendiente que lo explica', () => {
  const sinRoles = rubros.map((r) => ({ ...r, role: null }));
  assert.match(c.classifyMovement(mv({ conceptCode: '580', amountCents: 100 }), [], sinRoles).reason, /rubro de ingresos/);
  assert.match(c.classifyMovement(mv({ conceptCode: '130', amountCents: -100 }), [], sinRoles).reason, /rubro de gastos bancarios/);
});

test('transferencia sin regla y código desconocido → pendiente', () => {
  const t = c.classifyMovement(mv(), [], rubros);
  assert.strictEqual(t.status, 'PENDIENTE');
  assert.match(t.reason, /Transferencia a terceros a VIGILANCIA PRIVADA sin regla/);
  const sinNombre = c.classifyMovement(mv({ conceptCode: '161', counterparty: null, description: 'TRANSF X' }), [], rubros);
  assert.match(sinNombre.reason, /a TRANSF X sin regla/);
  const u = c.classifyMovement(mv({ conceptCode: '999', description: 'COSA NUEVA' }), [], rubros);
  assert.match(u.reason, /Código de concepto 999 desconocido \("COSA NUEVA"\)/);
});

test('regla por CUIT, por texto, por concepto, por sentido y por monto', () => {
  assert.strictEqual(c.classifyMovement(mv(), [rule()], rubros).status, 'REGLA');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchCuit: null, matchText: 'vigilancia privada' })], rubros).status, 'REGLA');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchCuit: null, matchText: 'otra cosa' })], rubros).status, 'PENDIENTE');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchCuit: '20000000000' })], rubros).status, 'PENDIENTE');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchCuit: null, matchConcept: '190' })], rubros).status, 'REGLA');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchConcept: '161' })], rubros).status, 'PENDIENTE');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ direction: 'DEBITO' })], rubros).status, 'REGLA');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ direction: 'CREDITO' })], rubros).status, 'PENDIENTE');
  assert.strictEqual(c.classifyMovement(mv({ amountCents: 5 }), [rule({ direction: 'DEBITO' })], rubros).status, 'PENDIENTE');
  assert.strictEqual(c.classifyMovement(mv({ amountCents: 5 }), [rule({ direction: 'CREDITO' })], rubros).status, 'REGLA');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchAmountCents: 10000 })], rubros).status, 'REGLA');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchAmountCents: 10001 })], rubros).status, 'PENDIENTE');
});

test('la regla gana sobre el código automático (un crédito que no es expensa)', () => {
  const r = c.classifyMovement(mv({ conceptCode: '506', amountCents: 500 }), [rule({ rubroId: 'r4', itemLabel: 'Reintegro seguro' })], rubros);
  assert.strictEqual(r.status, 'REGLA');
  assert.strictEqual(r.rubroId, 'r4');
});

test('texto sin acentos ni mayúsculas', () => {
  const r = c.classifyMovement(mv({ description: 'PAGO A JARDINERÍA LÓPEZ', cuit: null }), [rule({ matchCuit: null, matchText: 'jardineria lopez' })], rubros);
  assert.strictEqual(r.status, 'REGLA');
});

test('reglas desactivadas o sin condición no aplican', () => {
  assert.strictEqual(c.classifyMovement(mv(), [rule({ isActive: false })], rubros).status, 'PENDIENTE');
  assert.strictEqual(c.classifyMovement(mv(), [rule({ matchCuit: null })], rubros).status, 'PENDIENTE');
});

test('prioridad: gana la mayor; empate con destinos distintos → conflicto', () => {
  const alta = rule({ id: 'a', priority: 5, rubroId: 'r5', itemLabel: 'Alta' });
  const baja = rule({ id: 'b', rubroId: 'r3' });
  const r = c.classifyMovement(mv(), [baja, alta], rubros);
  assert.strictEqual(r.ruleId, 'a');
  const conflicto = c.classifyMovement(mv(), [baja, rule({ id: 'c', rubroId: 'r4', itemLabel: 'Otro' })], rubros);
  assert.strictEqual(conflicto.status, 'PENDIENTE');
  assert.match(conflicto.reason, /Conflicto: 2 reglas/);
  assert.strictEqual(conflicto.suggestions.length, 2);
  // empate pero mismo destino → no es conflicto
  const mismo = c.classifyMovement(mv(), [baja, rule({ id: 'd', itemLabel: 'VIGILANCIA ' })], rubros);
  assert.strictEqual(mismo.status, 'REGLA');
  assert.strictEqual(mismo.ruleId, 'b');
});

test('"preguntar siempre" deja pendiente con las sugerencias', () => {
  const luz = rule({ id: 'luz', alwaysAsk: true, rubroId: 'r7', itemLabel: 'Luz común' });
  const muni = rule({ id: 'muni', alwaysAsk: true, rubroId: 'r10', itemLabel: 'Municipal' });
  const r = c.classifyMovement(mv(), [luz, muni], rubros);
  assert.strictEqual(r.status, 'PENDIENTE');
  assert.match(r.reason, /pueden ser distintas cosas/);
  assert.deepStrictEqual(r.suggestions.map((s) => s.ruleId), ['luz', 'muni']);
});

test('classifyAll conserva los datos del movimiento', () => {
  const [r] = c.classifyAll([{ ...mv(), id: 'm1' }], [rule()], rubros);
  assert.strictEqual(r.id, 'm1');
  assert.strictEqual(r.status, 'REGLA');
});

test('describeRule explica la regla en castellano', () => {
  const d = c.describeRule(rule({ matchText: 'VIGI', matchConcept: '190', direction: 'DEBITO', matchAmountCents: 54120000 }), rubros);
  assert.strictEqual(d, 'Si el CUIT es 27777777778 y la descripción contiene "VIGI" y el código de concepto es 190 y es un débito (sale plata) y el importe es $ 541.200,00 → va a 03 Servicio de Vigilancia «Vigilancia»');
  assert.match(c.describeRule(rule({ direction: 'CREDITO', alwaysAsk: true, isActive: false }), rubros), /es un crédito.*preguntar siempre \(desactivada\)/);
  assert.match(c.describeRule(rule({ rubroId: 'borrado' }), rubros), /\(rubro borrado\)/);
});

test('ruleFromMovement: por CUIT, si no por nombre; sin ninguno no se puede', () => {
  assert.deepStrictEqual(
    c.ruleFromMovement(mv(), { rubroId: 'r3', itemLabel: 'V' }),
    { matchCuit: '27777777778', matchText: null, matchConcept: null, direction: 'DEBITO', matchAmountCents: null, rubroId: 'r3', itemLabel: 'V', alwaysAsk: false, priority: 0, isActive: true },
  );
  const porNombre = c.ruleFromMovement(mv({ cuit: null, amountCents: 100 }), { rubroId: 'r1', itemLabel: 'X', alwaysAsk: true });
  assert.strictEqual(porNombre.matchText, 'VIGILANCIA PRIVADA');
  assert.strictEqual(porNombre.direction, 'CREDITO');
  assert.strictEqual(porNombre.alwaysAsk, true);
  assert.throws(() => c.ruleFromMovement(mv({ cuit: null, counterparty: null }), { rubroId: 'r1', itemLabel: 'X' }), (e) => e.code === 'CANNOT_REMEMBER');
});

test('planRemember "siempre": crea, reutiliza, cambia destino y desactiva las sugerencias', () => {
  const base = c.ruleFromMovement(mv(), { rubroId: 'r3', itemLabel: 'Vigilancia' });
  assert.deepStrictEqual(c.planRemember([], base), { create: [base], update: [] });

  const fija = { ...base, id: 'f', rubroId: 'r5', itemLabel: 'Otra' };
  const sugerencia = { ...base, id: 's', alwaysAsk: true, rubroId: 'r7', itemLabel: 'Luz', isActive: true };
  const apagada = { ...base, id: 'o', alwaysAsk: true, isActive: false, rubroId: 'r10', itemLabel: 'Z' };
  const otraContraparte = { ...base, id: 'n', matchCuit: '20000000000' };
  const plan = c.planRemember([fija, sugerencia, apagada, otraContraparte], base);
  assert.deepStrictEqual(plan.create, []);
  assert.deepStrictEqual(plan.update, [
    { id: 'f', data: { rubroId: 'r3', itemLabel: 'Vigilancia', alwaysAsk: false, isActive: true } },
    { id: 's', data: { isActive: false } },
  ]);

  // una sugerencia con el mismo destino pasa a ser la regla fija
  const mismaSug = { ...base, id: 'm', alwaysAsk: true, itemLabel: 'vigilancia' };
  assert.deepStrictEqual(c.planRemember([mismaSug], base).update, [
    { id: 'm', data: { rubroId: 'r3', itemLabel: 'Vigilancia', alwaysAsk: false, isActive: true } },
  ]);
});

test('planRemember "preguntar": suma la sugerencia y pasa las fijas a preguntar', () => {
  const nueva = c.ruleFromMovement(mv(), { rubroId: 'r7', itemLabel: 'Luz', alwaysAsk: true });
  const fija = { ...nueva, id: 'f', alwaysAsk: false, rubroId: 'r10', itemLabel: 'Municipal' };
  assert.deepStrictEqual(c.planRemember([fija], nueva), { create: [nueva], update: [{ id: 'f', data: { alwaysAsk: true } }] });

  const yaEsta = { ...nueva, id: 'y', isActive: false };
  assert.deepStrictEqual(c.planRemember([yaEsta], nueva), { create: [], update: [{ id: 'y', data: { alwaysAsk: true, isActive: true } }] });

  // la fija con el mismo destino: se combinan los cambios en una sola actualización
  const fijaMismo = { ...nueva, id: 'z', alwaysAsk: false };
  assert.deepStrictEqual(c.planRemember([fijaMismo], nueva).update, [{ id: 'z', data: { alwaysAsk: true, isActive: true } }]);
});

test('sameMatch compara condiciones vacías como iguales', () => {
  const a = { matchCuit: null, matchText: 'ABC', direction: undefined };
  const plan = c.planRemember([{ ...a, id: 'q', rubroId: 'r1', itemLabel: 'x', alwaysAsk: false, matchConcept: undefined, matchAmountCents: undefined }],
    { ...a, matchConcept: null, matchAmountCents: null, rubroId: 'r2', itemLabel: 'y', alwaysAsk: false });
  assert.strictEqual(plan.update[0].id, 'q');
  assert.strictEqual(c.normalize('  Árbol  ñandú '), 'ARBOL NANDU');
});
