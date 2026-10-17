// Códigos de concepto del extracto (Banco Roela / SIRO) que se pueden
// clasificar sin preguntar. Todo lo que no esté acá (transferencias 161/172/190
// o un código nuevo) necesita una regla o una decisión manual.
const CONCEPTS = {
  // Créditos: cobranza de expensas
  580: { role: 'INGRESOS', label: 'Cobro QR con transferencia' },
  515: { role: 'INGRESOS', label: 'Pago Mis Cuentas' },
  530: { role: 'INGRESOS', label: 'Rapipago' },
  536: { role: 'INGRESOS', label: 'PagoFácil' },
  506: { role: 'INGRESOS', label: 'Transferencia recibida (BAK)' },
  // Débitos: gastos bancarios
  127: { role: 'GASTOS_BANCARIOS', label: 'Mantenimiento de cuenta' },
  130: { role: 'GASTOS_BANCARIOS', label: 'I.V.A.' },
  148: { role: 'GASTOS_BANCARIOS', label: 'Impuesto Ley 25413' },
  288: { role: 'GASTOS_BANCARIOS', label: 'Comisión SIRO QR' },
  194: { role: 'GASTOS_BANCARIOS', label: 'Comisión SIRO Pago Mis Cuentas' },
  214: { role: 'GASTOS_BANCARIOS', label: 'Comisión SIRO Rapipago' },
  222: { role: 'GASTOS_BANCARIOS', label: 'Comisión SIRO PagoFácil' },
};

const TRANSFER_CODES = { 161: 'Transferencia', 172: 'Transferencia a cuenta propia', 190: 'Transferencia a terceros' };

module.exports = { CONCEPTS, TRANSFER_CODES };
