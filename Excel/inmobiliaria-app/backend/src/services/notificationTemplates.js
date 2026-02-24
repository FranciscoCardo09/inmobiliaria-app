// Notification Templates - Pure functions returning { subject, html, whatsappText }

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(amount);
};

const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// --- TEMPLATE FUNCTIONS ---

const nextMonthTemplate = (tenant, record, groupName) => {
  const period = `${monthNames[record.periodMonth]} ${record.periodYear}`;
  const concepts = (record.services || []).map(s =>
    `${s.conceptType?.name || s.name}: ${formatCurrency(s.amount)}`
  ).join('\n');

  const subject = `Liquidación ${period} - ${groupName}`;

  const whatsappText = [
    `*Liquidación ${period} - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `${period.toUpperCase()} vence DÍA 10:`,
    `Alquiler: ${formatCurrency(record.rentAmount)}`,
    concepts ? concepts : '',
    `*TOTAL: ${formatCurrency(record.totalDue)}*`,
    ``,
    `Pague antes del día 10.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>Liquidación ${period}</h2>
    <p>Hola ${tenant.name},</p>
    <p><strong>${period.toUpperCase()}</strong> vence DÍA 10:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Alquiler</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(record.rentAmount)}</td></tr>
      ${(record.services || []).map(s => `
        <tr><td style="padding:8px;border-bottom:1px solid #eee">${s.conceptType?.name || s.name}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(s.amount)}</td></tr>
      `).join('')}
      <tr style="font-weight:bold"><td style="padding:8px">TOTAL</td>
          <td style="padding:8px;text-align:right">${formatCurrency(record.totalDue)}</td></tr>
    </table>
    <p>Pague antes del día 10.</p>
  `;

  return { subject, html, whatsappText };
};

const debtTotalTemplate = (tenant, debt, groupName) => {
  const subject = `DEUDA ${debt.periodLabel} - ${groupName}`;
  const dailyPunitory = debt.unpaidRentAmount * (debt.punitoryPercent || 0.02);

  const whatsappText = [
    `*⚠️ DEUDA ${debt.periodLabel} - ${groupName}*`,
    ``,
    `${tenant.name},`,
    `NO pagó ${debt.periodLabel}: ${formatCurrency(debt.unpaidRentAmount)}`,
    `Punitorios DESDE día ${debt.punitoryStartDate ? new Date(debt.punitoryStartDate).getDate() : '4'}`,
    `${formatCurrency(dailyPunitory)} POR DÍA`,
    ``,
    `Regularice a la brevedad.`,
  ].join('\n');

  const html = `
    <h2>⚠️ Deuda ${debt.periodLabel}</h2>
    <p>${tenant.name},</p>
    <p>NO registramos pago de <strong>${debt.periodLabel}</strong>:</p>
    <p style="font-size:24px;font-weight:bold;color:#dc2626">${formatCurrency(debt.unpaidRentAmount)}</p>
    <p>Punitorios: <strong>${formatCurrency(dailyPunitory)} por día</strong></p>
    <p>Regularice a la brevedad.</p>
  `;

  return { subject, html, whatsappText };
};

const debtPartialTemplate = (tenant, debt, groupName) => {
  const remaining = debt.unpaidRentAmount - (debt.amountPaid || 0);
  const dailyPunitory = remaining * (debt.punitoryPercent || 0.02);
  const subject = `SALDO PENDIENTE ${debt.periodLabel} - ${groupName}`;

  const whatsappText = [
    `*⚠️ SALDO PENDIENTE ${debt.periodLabel} - ${groupName}*`,
    ``,
    `${tenant.name},`,
    `Saldo ${debt.periodLabel}: ${formatCurrency(remaining)}`,
    debt.lastPaymentDate ? `Último pago: ${new Date(debt.lastPaymentDate).toLocaleDateString('es-AR')}` : '',
    `Punitorios: ${formatCurrency(dailyPunitory)} POR DÍA`,
    ``,
    `Regularice a la brevedad.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>⚠️ Saldo pendiente ${debt.periodLabel}</h2>
    <p>${tenant.name},</p>
    <p>Saldo de <strong>${debt.periodLabel}</strong>:</p>
    <p style="font-size:24px;font-weight:bold;color:#f59e0b">${formatCurrency(remaining)}</p>
    ${debt.lastPaymentDate ? `<p>Último pago: ${new Date(debt.lastPaymentDate).toLocaleDateString('es-AR')}</p>` : ''}
    <p>Punitorios: <strong>${formatCurrency(dailyPunitory)} por día</strong></p>
    <p>Regularice a la brevedad.</p>
  `;

  return { subject, html, whatsappText };
};

const latePaymentTemplate = (tenant, record, contract, groupName) => {
  const period = `${monthNames[record.periodMonth]} ${record.periodYear}`;
  const dailyPunitory = record.rentAmount * (contract.punitoryPercent || 0.02);
  const subject = `URGENTE - Pago ${period} ATRASADO - ${groupName}`;

  const whatsappText = [
    `*🚨 URGENTE - Pago ${period} ATRASADO*`,
    ``,
    `${tenant.name},`,
    `NO pagó antes del día 10.`,
    `Punitorios DESDE día ${contract.punitoryStartDay || 4}: ${formatCurrency(dailyPunitory)}/día`,
    ``,
    `Pague HOY.`,
  ].join('\n');

  const html = `
    <h2 style="color:#dc2626">🚨 URGENTE - Pago ${period} ATRASADO</h2>
    <p>${tenant.name},</p>
    <p>NO registramos su pago antes del día 10.</p>
    <p>Punitorios desde día ${contract.punitoryStartDay || 4}: <strong>${formatCurrency(dailyPunitory)}/día</strong></p>
    <p style="font-weight:bold">Pague HOY.</p>
  `;

  return { subject, html, whatsappText };
};

const adjustmentTemplate = (tenant, contract, oldRent, newRent, indexName, groupName) => {
  const pctChange = ((newRent - oldRent) / oldRent * 100).toFixed(1);
  const subject = `Ajuste de alquiler - ${groupName}`;

  const whatsappText = [
    `*Ajuste de alquiler - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `Su alquiler fue ajustado por índice ${indexName}:`,
    `Anterior: ${formatCurrency(oldRent)}`,
    `Nuevo: ${formatCurrency(newRent)} (+${pctChange}%)`,
    ``,
    `Vigente desde el próximo período.`,
  ].join('\n');

  const html = `
    <h2>Ajuste de alquiler</h2>
    <p>Hola ${tenant.name},</p>
    <p>Su alquiler fue ajustado por índice <strong>${indexName}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Anterior</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(oldRent)}</td></tr>
      <tr style="font-weight:bold"><td style="padding:8px">Nuevo (+${pctChange}%)</td>
          <td style="padding:8px;text-align:right">${formatCurrency(newRent)}</td></tr>
    </table>
    <p>Vigente desde el próximo período.</p>
  `;

  return { subject, html, whatsappText };
};

const contractExpiringTemplate = (tenant, contract, property, remainingDays, groupName) => {
  const endDate = new Date(contract.startDate);
  endDate.setMonth(endDate.getMonth() + contract.durationMonths);
  const subject = `Contrato próximo a vencer - ${groupName}`;

  const whatsappText = [
    `*Contrato próximo a vencer - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `Su contrato en ${property.address} vence el ${endDate.toLocaleDateString('es-AR')}.`,
    `Quedan ${remainingDays} días.`,
    ``,
    `Comuníquese para coordinar la renovación.`,
  ].join('\n');

  const html = `
    <h2>Contrato próximo a vencer</h2>
    <p>Hola ${tenant.name},</p>
    <p>Su contrato en <strong>${property.address}</strong> vence el <strong>${endDate.toLocaleDateString('es-AR')}</strong>.</p>
    <p>Quedan <strong>${remainingDays} días</strong>.</p>
    <p>Comuníquese para coordinar la renovación.</p>
  `;

  return { subject, html, whatsappText };
};

const cashReceiptTemplate = (tenant, transaction, groupName) => {
  const subject = `Recibo de pago #${transaction.receiptNumber || ''} - ${groupName}`;

  const whatsappText = [
    `*Recibo de pago - ${groupName}*`,
    ``,
    `Hola ${tenant.name},`,
    `Registramos su pago:`,
    `Monto: ${formatCurrency(transaction.amount)}`,
    `Fecha: ${new Date(transaction.paymentDate).toLocaleDateString('es-AR')}`,
    transaction.receiptNumber ? `Recibo #${transaction.receiptNumber}` : '',
    ``,
    `Gracias.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>Recibo de pago</h2>
    <p>Hola ${tenant.name},</p>
    <p>Registramos su pago:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Monto</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(transaction.amount)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee">Fecha</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${new Date(transaction.paymentDate).toLocaleDateString('es-AR')}</td></tr>
      ${transaction.receiptNumber ? `<tr><td style="padding:8px">Recibo</td><td style="padding:8px;text-align:right">#${transaction.receiptNumber}</td></tr>` : ''}
    </table>
    <p>Gracias.</p>
  `;

  return { subject, html, whatsappText };
};

const ownerReportTemplate = (owner, liquidation, groupName) => {
  const period = liquidation.period || 'del período';
  const subject = `Liquidación ${period} - ${groupName}`;

  const whatsappText = [
    `*Liquidación ${period} - ${groupName}*`,
    ``,
    `Hola ${owner.name},`,
    `Le informamos el detalle de su liquidación:`,
    liquidation.totalIncome ? `Ingresos: ${formatCurrency(liquidation.totalIncome)}` : '',
    liquidation.commission ? `Comisión: ${formatCurrency(liquidation.commission)}` : '',
    liquidation.netAmount ? `*Neto depositado: ${formatCurrency(liquidation.netAmount)}*` : '',
    ``,
    `PDF adjunto en el email.`,
  ].filter(Boolean).join('\n');

  const html = `
    <h2>Liquidación ${period}</h2>
    <p>Hola ${owner.name},</p>
    <p>Le informamos el detalle de su liquidación:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${liquidation.totalIncome ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Ingresos</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(liquidation.totalIncome)}</td></tr>` : ''}
      ${liquidation.commission ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Comisión</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(liquidation.commission)}</td></tr>` : ''}
      ${liquidation.netAmount ? `<tr style="font-weight:bold"><td style="padding:8px">Neto depositado</td><td style="padding:8px;text-align:right">${formatCurrency(liquidation.netAmount)}</td></tr>` : ''}
    </table>
    <p>Adjuntamos el PDF con el detalle completo.</p>
  `;

  return { subject, html, whatsappText };
};

module.exports = {
  nextMonthTemplate,
  debtTotalTemplate,
  debtPartialTemplate,
  latePaymentTemplate,
  adjustmentTemplate,
  contractExpiringTemplate,
  cashReceiptTemplate,
  ownerReportTemplate,
  formatCurrency,
  monthNames,
};
