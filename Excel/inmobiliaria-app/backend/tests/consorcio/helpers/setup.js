// Servicio de Consorcios con un Prisma en memoria + PDFs sintéticos.
const proxyquire = require('proxyquire').noCallThru();
const { makeFakePrisma } = require('../../helpers/fakePrisma');
const { layoutStatement, renderStatementPdf } = require('./statementPdf');
const julio = require('../fixtures/julio2026.json');

const CBU = julio.header.cbu;

function makeService() {
  const fake = makeFakePrisma();
  const service = proxyquire('../../../src/services/consorcio/consorcioService', { '../../lib/prisma': fake });
  return { fake, service };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// Extracto de julio con cambios opcionales sobre el spec.
async function statementBase64(mutate = (s) => s, opts) {
  const spec = mutate(clone(julio)) || clone(julio);
  const buf = await renderStatementPdf(layoutStatement(spec), opts);
  return buf.toString('base64');
}

// Un mes cualquiera con pocos movimientos (para encadenar meses).
async function monthBase64(year, month, movements, { openingCents = 455828889 } = {}) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const spec = {
    header: { ...clone(julio.header), from: `1/${month}/${year}`, to: `${last}/${month}/${year}` },
    opening: { date: `01/${mm}/${year}`, cents: openingCents },
    movements: movements.map((m) => ({ ...m, date: m.date || `05/${mm}/${year}` })),
  };
  return (await renderStatementPdf(layoutStatement(spec))).toString('base64');
}

module.exports = { makeService, statementBase64, monthBase64, CBU, clone };
