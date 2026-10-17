// API HTTP real (Express + rutas + controller + validadores + permisos por rol),
// con Prisma en memoria y la autenticación JWT reemplazada por un header.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('../helpers/fakePrisma');
const { statementBase64, CBU } = require('./helpers/setup');
const J = require('./helpers/julio');

const G = 'g1';
const ROLES = { admin: 'ADMIN', oper: 'OPERATOR', viewer: 'VIEWER' };

let server;
let base;
let fake;

test.before(async () => {
  fake = makeFakePrisma();
  const service = proxyquire('../../src/services/consorcio/consorcioService', { '../../lib/prisma': fake });
  const controller = proxyquire('../../src/controllers/consorcioController', { '../services/consorcio/consorcioService': service });
  const groupAuth = proxyquire('../../src/middleware/groupAuth', {
    '../lib/prisma': {
      userGroup: {
        findUnique: async ({ where }) => {
          const { userId, groupId } = where.userId_groupId;
          return ROLES[userId] && groupId === G ? { role: ROLES[userId], group: { id: G, isActive: true } } : null;
        },
      },
    },
  });
  const auth = {
    authenticate: (req, res, next) => {
      if (!req.headers['x-user']) return res.status(401).json({ success: false });
      req.user = { id: req.headers['x-user'] };
      return next();
    },
  };
  const routes = proxyquire('../../src/routes/consorcios.routes', {
    '../controllers/consorcioController': controller,
    '../middleware/auth': auth,
    '../middleware/groupAuth': groupAuth,
  });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/groups/:groupId/consorcios', routes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ success: false, message: 'Error interno' }));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/groups/${G}/consorcios`;
});

test.after(() => server.close());

async function call(user, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

test('autenticación y pertenencia al grupo', async () => {
  assert.strictEqual((await call(null, 'GET', '/')).status, 401);
  assert.strictEqual((await call('intruso', 'GET', '/')).status, 403);
});

test('permisos por rol', async () => {
  assert.strictEqual((await call('viewer', 'GET', '/')).status, 200);
  assert.strictEqual((await call('viewer', 'POST', '/', { name: 'X', cbu: '1'.repeat(22) })).status, 403);
  const created = await call('oper', 'POST', '/', { name: 'Para borrar', cbu: '2'.repeat(22) });
  assert.strictEqual(created.status, 201);
  assert.strictEqual((await call('oper', 'DELETE', `/${created.data.data.id}`)).status, 403);
  assert.strictEqual((await call('admin', 'DELETE', `/${created.data.data.id}`)).status, 200);
});

test('validaciones con mensajes claros', async () => {
  const bad = await call('oper', 'POST', '/', { name: ' ', cbu: '123' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.message, /El nombre es obligatorio\. El CBU tiene 22 dígitos/);
  assert.deepStrictEqual(bad.data.errors.map((e) => e.field), ['name', 'cbu']);
});

test('errores de dominio con código estable; errores inesperados → 500', async () => {
  const nf = await call('viewer', 'GET', '/no-existe');
  assert.strictEqual(nf.status, 404);
  assert.strictEqual(nf.data.code, 'NOT_FOUND');
  assert.strictEqual(nf.data.success, false);

  const orig = fake.consorcio.findMany;
  fake.consorcio.findMany = async () => { throw new Error('se cayó la base'); };
  const boom = await call('viewer', 'GET', '/');
  fake.consorcio.findMany = orig;
  assert.strictEqual(boom.status, 500);
  assert.strictEqual(boom.data.message, 'Error interno');
});

test('flujo completo por HTTP', async () => {
  // consorcio + rubros + reglas
  const c = (await call('oper', 'POST', '/', { name: 'Portal del Hierro , Torre I', cbu: CBU, initialReserveCents: J.RESERVE_CENTS })).data.data;
  assert.strictEqual((await call('oper', 'PUT', `/${c.id}`, { bankAccountName: 'EDIFICIO DE PRUEBA 123' })).data.data.bankAccountName, 'EDIFICIO DE PRUEBA 123');
  let full = (await call('viewer', 'GET', `/${c.id}`)).data.data;
  const rubro = (n) => full.rubros.find((r) => r.number === n).id;

  assert.strictEqual((await call('oper', 'POST', `/${c.id}/rubros`, { number: 11, name: 'Obras', kind: 'X' })).status, 400);
  const r11 = (await call('oper', 'POST', `/${c.id}/rubros`, { number: 11, name: 'Obras', kind: 'EGRESO', defaultItemLabel: 'Obras {mes}' })).data.data;
  assert.strictEqual((await call('oper', 'POST', `/${c.id}/rubros`, { number: 12, name: 'Mal', kind: 'EGRESO', defaultItemLabel: 'X {nada}' })).status, 400);
  assert.strictEqual((await call('oper', 'PUT', `/${c.id}/rubros/${r11.id}`, { name: 'Obras grandes' })).data.data.name, 'Obras grandes');
  assert.strictEqual((await call('oper', 'DELETE', `/${c.id}/rubros/${r11.id}`)).status, 403);
  assert.strictEqual((await call('admin', 'DELETE', `/${c.id}/rubros/${r11.id}`)).status, 200);

  const sinCondicion = await call('oper', 'POST', `/${c.id}/reglas`, { rubroId: rubro(2), itemLabel: 'L' });
  assert.strictEqual(sinCondicion.status, 400);
  assert.match(sinCondicion.data.message, /al menos una condición/);
  assert.strictEqual((await call('oper', 'POST', `/${c.id}/reglas`, { matchConcept: '161', rubroId: rubro(2), itemLabel: '__reserva__' })).status, 400);
  const porTexto = (await call('oper', 'POST', `/${c.id}/reglas`, { matchText: 'LIMPIEZA SERVICIOS', direction: 'DEBITO', rubroId: rubro(2), itemLabel: J.L.limpieza })).data.data;
  const porConcepto = (await call('oper', 'POST', `/${c.id}/reglas`, { matchConcept: '999', rubroId: rubro(7), itemLabel: 'X' })).data.data;
  assert.strictEqual((await call('oper', 'PUT', `/${c.id}/reglas/${porTexto.id}`, { priority: 2 })).data.data.priority, 2);
  assert.strictEqual((await call('oper', 'DELETE', `/${c.id}/reglas/${porConcepto.id}`)).status, 200);
  full = (await call('viewer', 'GET', `/${c.id}`)).data.data;
  assert.match(full.reglas[0].description, /la descripción contiene "LIMPIEZA SERVICIOS"/);

  // subir extracto
  assert.strictEqual((await call('oper', 'POST', `/${c.id}/rendiciones`, {})).status, 400);
  const up = await call('oper', 'POST', `/${c.id}/rendiciones`, { fileBase64: await statementBase64(), fileName: 'julio.pdf' });
  assert.strictEqual(up.status, 201);
  const rid = up.data.data.rendicionId;
  const dup = await call('oper', 'POST', `/${c.id}/rendiciones`, { fileBase64: await statementBase64() });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.data.code, 'DUPLICATE_FILE');
  assert.strictEqual(dup.data.details.rendicionId, rid);
  assert.strictEqual((await call('viewer', 'GET', `/${c.id}/rendiciones`)).data.data.length, 1);

  let r = (await call('viewer', 'GET', `/rendiciones/${rid}`)).data.data;
  assert.strictEqual(r.movimientos.find((m) => m.cuit === J.CUIT.limpieza).status, 'REGLA');

  // descargar con pendientes → 409 con los bloqueos
  const blocked = await call('viewer', 'GET', `/rendiciones/${rid}/descargar/pdf`);
  assert.strictEqual(blocked.status, 409);
  assert.strictEqual(blocked.data.code, 'REPORT_BLOCKED');

  // clasificar
  assert.strictEqual((await call('viewer', 'PATCH', `/rendiciones/${rid}/movimientos`, { items: [] })).status, 403);
  assert.strictEqual((await call('oper', 'PATCH', `/rendiciones/${rid}/movimientos`, { items: [] })).status, 400);
  const pend = r.movimientos.filter((m) => m.status === 'PENDIENTE');
  const items = pend.map((m) => ({ movementId: m.id, action: 'ASIGNAR', rubroId: rubro(7), itemLabel: 'Varios {mesAnterior}' }));
  items[0] = { movementId: pend[0].id, action: 'EXCLUIR', note: 'no va' };
  r = (await call('oper', 'PATCH', `/rendiciones/${rid}/movimientos`, { items })).data.data;
  assert.strictEqual(r.report.blockers.length, 0);
  // 81 automáticos + la limpieza (por regla); lo manual y lo excluido no se toca
  assert.strictEqual((await call('oper', 'POST', `/rendiciones/${rid}/reaplicar-reglas`)).data.data.changed, 82);

  // ajustes, reserva y orden
  assert.strictEqual((await call('oper', 'POST', `/rendiciones/${rid}/ajustes`, { kind: 'AJUSTE', rubroId: rubro(8), itemLabel: J.L.bancarios, amountCents: -1, note: 'x' })).status, 400);
  assert.strictEqual((await call('oper', 'POST', `/rendiciones/${rid}/ajustes`, { kind: 'AJUSTE', rubroId: rubro(8), itemLabel: J.L.bancarios, amountCents: 1.5, note: 'x' })).status, 400);
  const aj = (await call('oper', 'POST', `/rendiciones/${rid}/ajustes`, { kind: 'AJUSTE', rubroId: rubro(8), itemLabel: J.L.bancarios, amountCents: 13763987, note: 'junio' })).data.data.ajustes[0];
  assert.strictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/ajustes/${aj.id}`, { note: 'gastos de junio' })).data.data.ajustes[0].note, 'gastos de junio');
  const man = (await call('oper', 'POST', `/rendiciones/${rid}/ajustes`, { kind: 'MANUAL', rubroId: rubro(7), itemLabel: 'Caja chica', amountCents: 100, note: 'n' })).data.data.ajustes[1];
  assert.strictEqual((await call('oper', 'DELETE', `/rendiciones/${rid}/ajustes/${man.id}`)).data.data.ajustes.length, 1);

  assert.strictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/reserva`, { mode: 'MANUAL', cents: 5 })).status, 400);
  assert.strictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/reserva`, { mode: 'OTRO' })).status, 400);
  assert.strictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/reserva`, { mode: 'MANUAL', cents: J.RESERVE_CENTS, note: 'junio a mano' })).data.data.report.totals.reserveSource, 'MANUAL');
  assert.strictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/reserva`, { mode: 'AUTO' })).data.data.report.totals.reserveSource, 'INICIAL');
  assert.strictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/orden`, { keys: 'x' })).status, 400);
  assert.deepStrictEqual((await call('oper', 'PUT', `/rendiciones/${rid}/orden`, { keys: ['a::b'] })).data.data.rendicion.lineOrder, ['a::b']);

  // descargar
  const docx = await call('viewer', 'GET', `/rendiciones/${rid}/descargar/docx`);
  assert.strictEqual(docx.status, 200);
  assert.match(docx.headers.get('content-disposition'), /attachment; filename="Rendicion_Portal_del_Hierro_Torre_I_2026-07\.docx"/);
  assert.strictEqual(Number(docx.headers.get('content-length')), docx.data.length);
  const pdf = await call('viewer', 'GET', `/rendiciones/${rid}/descargar/pdf`);
  assert.strictEqual(pdf.headers.get('content-type'), 'application/pdf');
  assert.strictEqual((await call('viewer', 'GET', `/rendiciones/${rid}/descargar/xls`)).status, 400);

  // cerrar / reabrir / borrar
  assert.strictEqual((await call('oper', 'POST', `/rendiciones/${rid}/cerrar`)).data.data.rendicion.status, 'CERRADA');
  assert.strictEqual((await call('oper', 'POST', `/rendiciones/${rid}/reabrir`)).status, 403);
  assert.strictEqual((await call('admin', 'POST', `/rendiciones/${rid}/reabrir`)).data.data.rendicion.status, 'BORRADOR');
  assert.strictEqual((await call('oper', 'DELETE', `/rendiciones/${rid}`)).status, 403);
  assert.strictEqual((await call('admin', 'DELETE', `/rendiciones/${rid}`)).status, 200);
  assert.strictEqual((await call('viewer', 'GET', `/rendiciones/${rid}`)).status, 404);
});
