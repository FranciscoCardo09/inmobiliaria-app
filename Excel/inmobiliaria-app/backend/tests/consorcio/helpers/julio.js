// Datos de julio 2026 (anonimizados) para reproducir el informe hecho a mano
// "Detalle Julio - 2026.docx": reglas, clasificaciones manuales y ajustes.
const { DEFAULT_RUBROS } = require('../../../src/services/consorcio/defaults');

const CUIT = {
  materiales: '20111111112',
  excluida: '27222222223',
  espejo: '27333333334',
  limpieza: '23444444445',
  ascensor: '30555555556',
  seguros: '30666666667',
  titular: '27000000001',
  vigilancia: '27777777778',
  pagos: '30888888889',
  electricista: '20999999990',
};

const L = {
  limpieza: 'Limpieza espacios comunes y jardinería ({mesAnterior})',
  vigilancia: '" Torres Gabriel "',
  accidente: 'Accidente personal seguridad y limpieza.',
  integral: 'Integral de Comercio',
  ascensor: 'Service Ascensor',
  materiales: 'Materiales Varios – Fact 34720-1707-37455-10652-Fotocopias',
  honorarios: 'Honorarios Administración ( {mesAnterior} )',
  luz: 'Luz común (periodo Bim 02 –1 de 2 - 2026)',
  espejo: 'Espejo Parabólico Fact N° 190',
  envio: 'Envio Espejo',
  mo: 'M.O. Colocación luces ext y espejo parabólico',
  municipal: 'Impuesto Municipal (periodo {periodoAnterior}) 50%',
  provincial: 'Impuesto Provincial – D.G.R. (Periodo {periodoAnterior}) 50%',
  aguas: 'Aguas Cordobesas (periodo {periodoAnterior}) 50%',
  bancarios: 'Mantenimiento de cuenta (Impuestos y Comisiones)',
};

function pureRubros() {
  return DEFAULT_RUBROS.map((r) => ({ ...r, id: `r${r.number}` }));
}

// Reglas que el usuario va a haber "recordado" (por número de rubro).
const RULES = [
  { cuit: CUIT.limpieza, rubro: 2, label: L.limpieza },
  { cuit: CUIT.vigilancia, rubro: 3, label: L.vigilancia },
  { cuit: CUIT.ascensor, rubro: 5, label: L.ascensor },
  { cuit: CUIT.materiales, rubro: 5, label: L.materiales },
  { cuit: CUIT.espejo, rubro: 9, label: L.espejo },
  { cuit: CUIT.electricista, rubro: 9, label: L.mo },
  { cuit: CUIT.seguros, rubro: 4, label: L.accidente, amount: 839190 },
  { cuit: CUIT.seguros, rubro: 4, label: L.integral, amount: 6425700 },
];

function pureRules(rubroId = (n) => `r${n}`) {
  return RULES.map((r, i) => ({
    id: `rule${i}`, matchCuit: r.cuit, matchText: null, matchConcept: null, direction: 'DEBITO',
    matchAmountCents: r.amount ?? null, rubroId: rubroId(r.rubro), itemLabel: r.label, alwaysAsk: false, priority: 0, isActive: true,
  }));
}

// Lo que el usuario elige a mano (lo ambiguo): por importe (débito, en centavos positivos).
const MANUAL = {
  44502570: [7, L.luz],
  20698000: [10, L.municipal],
  29682800: [10, L.provincial],
  5733200: [10, L.aguas],
  50000000: [6, L.honorarios],
  2500000: [9, L.envio],
  1000000: [5, L.materiales],
};
const EXCLUDED_NOTE = 'Devolución a un propietario: no es gasto del consorcio';

const ADJUSTMENTS = [
  { kind: 'AJUSTE', rubro: 4, itemLabel: L.accidente, amountCents: 839200, note: 'Redondeo al importe de la póliza' },
  { kind: 'AJUSTE', rubro: 10, itemLabel: L.provincial, amountCents: 29682824, note: 'Importe de la boleta D.G.R.' },
  { kind: 'AJUSTE', rubro: 8, itemLabel: L.bancarios, amountCents: 13763987, note: 'Incluye gastos bancarios de junio' },
];

const RESERVE_CENTS = 457207857;

// Las filas exactas del Word de julio.
const EXPECTED_ROWS = [
  ['title', 'Portal del Hierro , Torre I'],
  ['subtitle', 'Rendición de cuentas mes de Julio de 2026'],
  ['heading', '01- Ingresos del periodo'],
  ['item', '- Gastos Comunes Junio - 26', '$ 4.282.134,91.-'],
  ['heading', '02- Servicio de Limpieza'],
  ['item', '- Limpieza espacios comunes y jardinería (Junio - 26)', '$ 900.000,00.-'],
  ['heading', '03- Servicio de Vigilancia'],
  ['item', '- " Torres Gabriel "', '$ 1.082.400,00.-'],
  ['heading', '04- Seguros'],
  ['item', '- Accidente personal seguridad y limpieza.', '$ 8.392,00.-'],
  ['item', '- Integral de Comercio', '$ 64.257,00.-'],
  ['heading', '05- Reparaciones, Instalaciones y Mant.'],
  ['item', '- Service Ascensor', '$ 261.887,00.-'],
  ['item', '- Materiales Varios – Fact 34720-1707-37455-10652-Fotocopias', '$ 65.937,69.-'],
  ['heading', '06- Gastos de Administración'],
  ['item', '- Honorarios Administración ( Junio - 26 )', '$ 500.000,00.-'],
  ['heading', '07- Gastos Varios'],
  ['item', '- Luz común (periodo Bim 02 –1 de 2 - 2026)', '$ 445.025,70.-'],
  ['heading', '08- Gastos Bancarios'],
  ['item', '- Mantenimiento de cuenta (Impuestos y Comisiones)', '$ 137.639,87.-'],
  ['heading', '09- Fondo Común'],
  ['item', '- Reserva Caja', '$ 4.572.078,57.-'],
  ['item', '- Espejo Parabólico Fact N° 190', '$ 169.400,00.-'],
  ['item', '- Envio Espejo', '$ 25.000,00.-'],
  ['item', '- M.O. Colocación luces ext y espejo parabólico', '$ 100.000,00.-'],
  ['heading', '10- Impuestos'],
  ['item', '- Impuesto Municipal (periodo 06/2026) 50%', '$ 206.980,00.-'],
  ['item', '- Impuesto Provincial – D.G.R. (Periodo 06/2026) 50%', '$ 296.828,24.-'],
  ['item', '- Aguas Cordobesas (periodo 06/2026) 50%', '$ 57.332,00.-'],
  ['total', '11- TOTAL CAJA', '$ 4.533.133,98.-'],
];

module.exports = { CUIT, L, RULES, MANUAL, EXCLUDED_NOTE, ADJUSTMENTS, RESERVE_CENTS, EXPECTED_ROWS, pureRubros, pureRules };
