// Montos del módulo Consorcios: SIEMPRE centavos enteros. El extracto trae
// "$ 4.861.831,33" / "-$ 13.237,00" y el informe muestra "$ 4.282.134,91.-".
// Nunca se suma en float: un centavo de diferencia rompe la conciliación.
const { ConsorcioError } = require('./errors');

const AMOUNT_RE = /^(-)?\s*\$\s*(\d{1,3}(?:\.\d{3})*),(\d{2})$/;

function isAmountText(text) {
  return AMOUNT_RE.test(String(text).trim());
}

function parseAmount(text) {
  const m = AMOUNT_RE.exec(String(text).trim());
  if (!m) throw new ConsorcioError('BAD_AMOUNT', `Importe ilegible: "${text}"`);
  const cents = Number(m[2].replace(/\./g, '')) * 100 + Number(m[3]);
  return m[1] ? -cents : cents;
}

function assertCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new ConsorcioError('BAD_AMOUNT', `Monto inválido: ${cents} (se esperan centavos enteros)`);
  }
}

// 482113491 → "4.821.134,91"
function formatNumber(cents) {
  assertCents(cents);
  const abs = Math.abs(cents);
  const pesos = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${pesos},${dec}`;
}

// Formato del informe: "$ 4.282.134,91.-"
function formatReportAmount(cents) {
  return `$ ${formatNumber(cents)}.-`;
}

// Formato de pantalla: "$ 4.282.134,91"
function formatAmount(cents) {
  return `$ ${formatNumber(cents)}`;
}

// Persistencia: las columnas guardan centavos enteros (Float para no
// desbordar Int32 con saldos de varios millones).
function toCents(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  assertCents(n);
  return n;
}

module.exports = { isAmountText, parseAmount, formatNumber, formatReportAmount, formatAmount, toCents, assertCents };
