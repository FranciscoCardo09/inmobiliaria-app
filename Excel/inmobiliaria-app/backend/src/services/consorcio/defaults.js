// Rubros con los que arranca un consorcio nuevo (los del informe de
// "Portal del Hierro, Torre I", julio 2026). Se pueden editar después.
//   kind: INGRESO suma al Total Caja, EGRESO resta.
//   role: qué clasifica solo el sistema en ese rubro.
//     INGRESOS          → cobranzas (QR, Pago Mis Cuentas, Rapipago, PagoFácil…)
//     GASTOS_BANCARIOS  → comisiones, IVA e impuesto Ley 25413
//     RESERVA           → donde se muestra la "Reserva Caja" (saldo del mes anterior)
const DEFAULT_RUBROS = [
  { number: 1, name: 'Ingresos del periodo', kind: 'INGRESO', role: 'INGRESOS', defaultItemLabel: 'Gastos Comunes {mesAnterior}' },
  { number: 2, name: 'Servicio de Limpieza', kind: 'EGRESO', role: null, defaultItemLabel: null },
  { number: 3, name: 'Servicio de Vigilancia', kind: 'EGRESO', role: null, defaultItemLabel: null },
  { number: 4, name: 'Seguros', kind: 'EGRESO', role: null, defaultItemLabel: null },
  { number: 5, name: 'Reparaciones, Instalaciones y Mant.', kind: 'EGRESO', role: null, defaultItemLabel: null },
  { number: 6, name: 'Gastos de Administración', kind: 'EGRESO', role: null, defaultItemLabel: null },
  { number: 7, name: 'Gastos Varios', kind: 'EGRESO', role: null, defaultItemLabel: null },
  { number: 8, name: 'Gastos Bancarios', kind: 'EGRESO', role: 'GASTOS_BANCARIOS', defaultItemLabel: 'Mantenimiento de cuenta (Impuestos y Comisiones)' },
  { number: 9, name: 'Fondo Común', kind: 'EGRESO', role: 'RESERVA', defaultItemLabel: null },
  { number: 10, name: 'Impuestos', kind: 'EGRESO', role: null, defaultItemLabel: null },
];

const ROLES = ['INGRESOS', 'GASTOS_BANCARIOS', 'RESERVA'];
const KINDS = ['INGRESO', 'EGRESO'];

module.exports = { DEFAULT_RUBROS, ROLES, KINDS };
