// Validación de la entrada de un pago (monto, fecha, medio). Fuente única para los tres
// endpoints que cargan plata: pago de mes, pago de deuda y pago de varios meses juntos.
//
// Auditoría 2026-10-20: el backend aceptaba "1.500,50" como $1,50 (parseFloat corta en la
// coma), fechas imposibles ("2026-13-45" → 14/02/2027), fechas futuras (un pago fechado en
// 2031 generó 1.418 días de mora) y cualquier medio de pago. Sólo la pantalla lo evitaba.
const { getTodayLocalString } = require('./dateUtils');

const MAX_AMOUNT = 10_000_000_000; // $10.000 millones: cualquier cosa más grande es un error de tipeo
const MIN_DATE = '2020-01-01';
const PAYMENT_METHODS = ['EFECTIVO', 'TRANSFERENCIA'];

class PaymentInputError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PAYMENT_INPUT';
  }
}

/**
 * Monto en pesos. Acepta número o texto; en texto, el formato argentino ("1.500,50") y el
 * decimal con punto ("1500.50"). Devuelve el número redondeado a centavos.
 */
function parsePaymentAmount(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim().replace(/\s|\$/g, '');
    if (!/^[0-9.,]+$/.test(s)) throw new PaymentInputError('Monto inválido');
    if (s.includes(',')) {
      // Formato argentino: los puntos son de miles y la coma es el decimal.
      if ((s.match(/,/g) || []).length > 1) throw new PaymentInputError('Monto inválido');
      n = Number(s.replace(/\./g, '').replace(',', '.'));
    } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
      // "1.500" o "1.500.000": puntos de miles sin decimales.
      n = Number(s.replace(/\./g, ''));
    } else {
      n = Number(s);
    }
  } else {
    throw new PaymentInputError('Monto inválido');
  }
  if (!Number.isFinite(n)) throw new PaymentInputError('Monto inválido');
  n = Math.round(n * 100) / 100;
  if (n <= 0) throw new PaymentInputError('El monto debe ser mayor a 0');
  if (n > MAX_AMOUNT) throw new PaymentInputError('Monto demasiado grande: revisá que esté bien escrito');
  return n;
}

/**
 * Fecha de pago como 'YYYY-MM-DD'. Tiene que existir en el calendario, no puede ser futura
 * (día ART) ni anterior a 2020. Sin valor → hoy.
 */
function parsePaymentDate(value, today = getTodayLocalString()) {
  if (value === undefined || value === null || value === '') return today;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(String(value).trim());
  if (!m) throw new PaymentInputError('Fecha de pago inválida');
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    throw new PaymentInputError('Fecha de pago inválida');
  }
  const str = `${y}-${mo}-${d}`;
  if (str > today) throw new PaymentInputError('La fecha de pago no puede ser futura');
  if (str < MIN_DATE) throw new PaymentInputError('Fecha de pago inválida');
  return str;
}

/** Medio de pago. Sin valor → EFECTIVO; 'TRANSFER' (valor viejo) → TRANSFERENCIA. */
function parsePaymentMethod(value) {
  if (value === undefined || value === null || value === '') return 'EFECTIVO';
  const v = String(value).trim().toUpperCase();
  if (v === 'TRANSFER') return 'TRANSFERENCIA';
  if (!PAYMENT_METHODS.includes(v)) throw new PaymentInputError('Medio de pago inválido');
  return v;
}

module.exports = {
  PaymentInputError,
  parsePaymentAmount,
  parsePaymentDate,
  parsePaymentMethod,
  PAYMENT_METHODS,
};
