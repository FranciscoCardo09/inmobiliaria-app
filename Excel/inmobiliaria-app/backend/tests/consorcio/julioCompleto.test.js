// Flujo completo, como lo hace el usuario: crear el consorcio, subir el extracto
// de julio, clasificar lo que el sistema no puede saber, cargar los ajustes y
// bajar el Word. El Word tiene que ser IGUAL al informe hecho a mano.
// Después agosto: la Reserva Caja sale sola y las reglas resuelven casi todo.
const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { makeService, statementBase64, monthBase64, CBU } = require('./helpers/setup');
const J = require('./helpers/julio');

const G = 'grupo-1';

async function wordParagraphs(buffer) {
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] === undefined ? '\t' : m[1])).join(''))
    .filter(Boolean)
    .map((t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

test('julio 2026 de punta a punta y agosto encadenado', async () => {
  const { service } = makeService();
  const consorcio = await service.createConsorcio(G, {
    name: 'Portal del Hierro , Torre I', cbu: CBU, bankAccountName: 'EDIFICIO DE PRUEBA 123', initialReserveCents: J.RESERVE_CENTS,
  });
  const { rubros } = await service.getConsorcio(G, consorcio.id);
  const rubro = (n) => rubros.find((r) => r.number === n).id;

  // 1) subir el extracto
  const { rendicionId: rid } = await service.uploadStatement(G, consorcio.id, { fileBase64: await statementBase64(), fileName: 'Extracto Julio - 26.pdf' });
  let r = await service.getRendicion(G, rid);
  const pend = () => r.movimientos.filter((m) => m.status === 'PENDIENTE');
  assert.strictEqual(pend().length, 20);

  // 2) clasificar: lo fijo con "Recordar siempre", lo ambiguo a mano, lo ajeno excluido
  const items = [];
  const seen = new Set();
  for (const m of pend()) {
    if (m.cuit === J.CUIT.excluida) {
      items.push({ movementId: m.id, action: 'EXCLUIR', note: J.EXCLUDED_NOTE });
      continue;
    }
    const fixed = J.RULES.find((x) => x.cuit === m.cuit && (x.amount == null || x.amount === -m.amountCents));
    if (fixed) {
      const first = !seen.has(m.cuit + fixed.label);
      seen.add(m.cuit + fixed.label);
      // los seguros tienen dos destinos según el importe: se recuerdan "preguntando"
      const remember = m.cuit === J.CUIT.seguros ? 'PREGUNTAR' : (first ? 'SIEMPRE' : null);
      items.push({ movementId: m.id, action: 'ASIGNAR', rubroId: rubro(fixed.rubro), itemLabel: fixed.label, remember });
      continue;
    }
    const [n, label] = J.MANUAL[-m.amountCents];
    const remember = m.cuit === J.CUIT.pagos || m.cuit === J.CUIT.titular ? 'PREGUNTAR' : null;
    items.push({ movementId: m.id, action: 'ASIGNAR', rubroId: rubro(n), itemLabel: label, remember });
  }
  r = await service.classifyMovements(G, rid, items);
  assert.strictEqual(pend().length, 0);

  // 3) ajustes con nota y orden de las líneas
  for (const a of J.ADJUSTMENTS) {
    r = await service.createAjuste(G, rid, { kind: a.kind, rubroId: rubro(a.rubro), itemLabel: a.itemLabel, amountCents: a.amountCents, note: a.note });
  }
  const s5 = r.report.sections.find((s) => s.rubro.number === 5);
  r = await service.setLineOrder(G, rid, [s5.lines.find((l) => l.template === J.L.ascensor).key]);
  assert.deepStrictEqual(r.report.blockers, []);
  assert.strictEqual(r.report.totals.totalCajaCents, 453313398);

  // 4) el Word es el informe de julio
  const word = await service.generateDocument(G, rid, 'docx');
  const expected = J.EXPECTED_ROWS.map(([, text, amount]) => (amount ? `${text}\t${amount}` : text));
  assert.deepStrictEqual(await wordParagraphs(word.buffer), expected);

  // 5) cerrar julio
  r = await service.closeRendicion(G, rid, 'user-1');
  assert.strictEqual(r.rendicion.totalCajaCents, 453313398);

  // 6) agosto: mismas contrapartes; la reserva es el Total Caja de julio
  const ago = await service.uploadStatement(G, consorcio.id, {
    fileBase64: await monthBase64(2026, 8, [
      { voucher: '1', concept: '580', desc: 'CREDITO POR COBRO QR CON TRANSF. DIST. TIT.', cents: 30000000 },
      { voucher: '2', concept: '148', desc: 'IMPUESTO LEY 25413', cents: -180000 },
      { voucher: '3', concept: '161', desc: [`TRANSF.INTERB.DISTINTO TIT. ${J.CUIT.limpieza} LIMPIEZA`, 'SERVICIOS INTEGRALES'], cents: -95000000 },
      { voucher: '4', concept: '190', desc: [`TRANSF.INTERB.DISTINTO TIT. ${J.CUIT.vigilancia}`, 'VIGILANCIA PRIVADA'], cents: -54120000 },
      { voucher: '5', concept: '190', desc: [`TRANSF.INTERB.DISTINTO TIT. ${J.CUIT.pagos}`, 'PAGOS Y COBRANZAS SA'], cents: -46000000 },
      { voucher: '6', concept: '190', desc: [`TRANSF.INTERB.DISTINTO TIT. 20123456789`, 'PROVEEDOR NUEVO'], cents: -1000000 },
    ], { openingCents: 455828889 }),
  });
  const a = await service.getRendicion(G, ago.rendicionId);
  assert.strictEqual(a.report.totals.reserveCents, 453313398);
  assert.strictEqual(a.report.totals.reserveSource, 'ANTERIOR');
  const byCuit = (cuit) => a.movimientos.find((m) => m.cuit === cuit);
  assert.strictEqual(byCuit(J.CUIT.limpieza).status, 'REGLA');
  assert.strictEqual(byCuit(J.CUIT.vigilancia).status, 'REGLA');
  // lo ambiguo vuelve a preguntar, con las opciones que se usaron en julio
  const pagos = byCuit(J.CUIT.pagos);
  assert.strictEqual(pagos.status, 'PENDIENTE');
  assert.deepStrictEqual(pagos.suggestions.map((s) => s.itemLabel).sort(),
    [J.L.aguas, J.L.luz, J.L.municipal, J.L.provincial].sort());
  // lo nuevo, pendiente sin sugerencias
  assert.deepStrictEqual(byCuit('20123456789').suggestions, []);
  // el texto con variables ya dice el mes anterior correcto
  const limpieza = a.report.sections.find((s) => s.rubro.number === 2).lines[0];
  assert.strictEqual(limpieza.label, 'Limpieza espacios comunes y jardinería (Julio - 26)');
  // el orden de líneas de julio se copió
  assert.deepStrictEqual(a.rendicion.lineOrder, r.rendicion.lineOrder);
});
