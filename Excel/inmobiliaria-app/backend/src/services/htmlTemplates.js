// HTML Templates - Editable HTML for copy/paste into Word
const { MONTH_NAMES } = require('./reportDataService');

const fmt = (amount, currency = 'ARS') => {
  if (amount == null) return '-';
  const p = currency === 'ARS' ? '$ ' : currency + ' ';
  return p + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ============================================
// LIQUIDACION HTML
// ============================================

const generateLiquidacionHTML = (data) => {
  const emp = data.empresa;
  const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');

  const conceptRows = data.conceptos.map((c, i) => `
    <tr style="background:${i % 2 === 1 ? '#F5F5F5' : '#FFFFFF'}">
      <td style="padding:6px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:11pt;color:#000">${escHtml(c.concepto)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:11pt;color:#333;text-align:right">${fmt(c.importe, data.currency)}</td>
    </tr>`).join('');

  let paymentsSection = '';
  if (data.transacciones && data.transacciones.length > 0) {
    const payRows = data.transacciones.map((t, i) => {
      const metodo = t.metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo';
      return `
      <tr style="background:${i % 2 === 1 ? '#F5F5F5' : '#FFF'}">
        <td style="padding:5px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:10pt">${fmtDate(t.fecha)}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:10pt">${metodo}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:10pt;text-align:right">${fmt(t.monto, data.currency)}</td>
      </tr>`;
    }).join('');

    let balanceRow = '';
    if (data.balance !== 0) {
      const balLabel = data.balance > 0 ? 'Saldo a Favor' : 'Saldo Pendiente';
      balanceRow = `<p style="font-family:Arial;font-size:11pt;color:#333"><strong>${balLabel}:</strong> ${fmt(Math.abs(data.balance), data.currency)}</p>`;
    }

    paymentsSection = `
    <div style="margin-top:20px">
      <hr style="border:none;border-top:1px solid #000;margin-bottom:10px">
      <h3 style="font-family:Arial;font-size:12pt;color:#000;letter-spacing:1px;margin:0 0 10px 0">PAGOS REGISTRADOS</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#333">
          <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:left">FECHA</th>
          <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:left">MÉTODO</th>
          <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:right">MONTO</th>
        </tr>
        ${payRows}
      </table>
      <p style="font-family:Arial;font-size:11pt;color:#000;margin-top:8px"><strong>Total Pagado:</strong> ${fmt(data.amountPaid, data.currency)}</p>
      ${balanceRow}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Liquidación - ${escHtml(data.inquilino.nombre)} - ${escHtml(data.periodo.label)}</title>
</head>
<body style="margin:20mm;font-family:Arial,sans-serif;color:#000;max-width:700px">

  <!-- HEADER -->
  <div style="border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:20px">
    <h1 style="font-family:Arial;font-size:14pt;color:#000;margin:0">${escHtml(emp.nombre || 'Inmobiliaria')}</h1>
    <p style="font-family:Arial;font-size:8pt;color:#666;margin:4px 0 0 0">${escHtml([emp.email, emp.telefono, emp.direccion, emp.ciudad].filter(Boolean).join(' | '))}</p>
    ${emp.cuit ? `<p style="font-family:Arial;font-size:8pt;color:#666;margin:2px 0 0 0">CUIT: ${escHtml(emp.cuit)}</p>` : ''}
  </div>

  <!-- TITLE -->
  <h2 style="font-family:Arial;font-size:13pt;color:#000;letter-spacing:1.5px;margin:0 0 4px 0">LIQUIDACIÓN</h2>
  <p style="font-family:Arial;font-size:9pt;color:#666;margin:0 0 15px 0">${escHtml(data.periodo.label)}${data.periodo.labelVencido ? ' &middot; Mes vencido: ' + escHtml(data.periodo.labelVencido) : ''}</p>
  <hr style="border:none;border-top:1px solid #000;margin-bottom:15px">

  <!-- INFO -->
  <p style="font-family:Arial;font-size:9pt;color:#666;margin:4px 0"><strong style="color:#000">Inquilino:</strong> ${escHtml(data.inquilino.nombre)}</p>
  <p style="font-family:Arial;font-size:9pt;color:#666;margin:4px 0"><strong style="color:#000">Propiedad:</strong> ${escHtml(addr)}</p>
  <p style="font-family:Arial;font-size:9pt;color:#666;margin:4px 0 15px 0"><strong style="color:#000">Propietario:</strong> ${escHtml(data.propietario.nombre)}</p>

  <!-- TABLE -->
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#333">
      <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:left;letter-spacing:0.5px">CONCEPTO</th>
      <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:right;letter-spacing:0.5px">IMPORTE</th>
    </tr>
    ${conceptRows}
    <tr style="background:#000">
      <td style="padding:8px 10px;font-family:Arial;font-size:13pt;color:#FFF;font-weight:bold">TOTAL A PAGAR</td>
      <td style="padding:8px 10px;font-family:Arial;font-size:13pt;color:#FFF;font-weight:bold;text-align:right">${fmt(data.total, data.currency)}</td>
    </tr>
  </table>

  ${data.totalEnLetras ? `<p style="font-family:Arial;font-size:8pt;color:#333;font-style:italic;margin-top:8px">Son: ${escHtml(data.totalEnLetras)}</p>` : ''}

  ${data.honorarios ? `
  <div style="margin-top:12px;padding:10px;background:#FAFAFA;border:1px solid #E0E0E0">
    <p style="font-family:Arial;font-size:10pt;color:#333;margin:4px 0"><strong>Honorarios (${data.honorarios.porcentaje}%):</strong> <span style="float:right">${fmt(data.honorarios.monto, data.currency)}</span></p>
    <p style="font-family:Arial;font-size:11pt;color:#000;margin:4px 0"><strong>Neto a transferir:</strong> <span style="float:right"><strong>${fmt(data.honorarios.netoTransferir, data.currency)}</strong></span></p>
  </div>` : ''}

  ${paymentsSection}

  <!-- FOOTER -->
  <div style="margin-top:30px;border-top:1px solid #E0E0E0;padding-top:8px">
    <p style="font-family:Arial;font-size:7pt;color:#999">Generado por ${escHtml(emp.nombre || 'Inmobiliaria')}${emp.cuit ? ` | CUIT ${escHtml(emp.cuit)}` : ''}</p>
  </div>

</body>
</html>`;
};

// ============================================
// LIQUIDACION ALL HTML
// ============================================

const generateLiquidacionAllHTML = (dataArray) => {
  if (dataArray.length === 0) return '<html><body><p>Sin datos</p></body></html>';

  const emp = dataArray[0].empresa;
  const currency = dataArray[0].currency;
  const periodo = dataArray[0].periodo;
  let grandTotal = 0;
  for (const d of dataArray) grandTotal += d.total;

  const propertyBlocks = dataArray.map((data) => {
    const conceptosFiltered = data.conceptos.filter(c => !(c.concepto.includes('Punitorios') && c.importe === 0));
    const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');

    const rows = conceptosFiltered.map(c => {
      const label = c.concepto.includes('Punitorios (0') ? 'Punitorios' : c.concepto;
      return `<tr><td style="padding:3px 20px;font-family:Arial;font-size:9pt;color:#666">${escHtml(label)}</td><td style="padding:3px 10px;font-family:Arial;font-size:9pt;color:#333;text-align:right">${fmt(c.importe, currency)}</td></tr>`;
    }).join('');

    return `
    <div style="margin-bottom:12px;padding:10px;background:#FAFAFA;border:1px solid #E0E0E0">
      <div style="display:flex;justify-content:space-between">
        <div>
          <strong style="font-family:Arial;font-size:10pt;color:#000">${escHtml(addr)}</strong><br>
          <span style="font-family:Arial;font-size:9pt;color:#666">${escHtml(data.inquilino.nombre)}</span>
        </div>
        <strong style="font-family:Arial;font-size:11pt;color:#000">${fmt(data.total, currency)}</strong>
      </div>
      <table style="width:100%;margin-top:6px">${rows}</table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Liquidación General - ${escHtml(periodo.label)}</title></head>
<body style="margin:20mm;font-family:Arial,sans-serif;color:#000;max-width:700px">
  <div style="border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:20px">
    <h1 style="font-family:Arial;font-size:14pt;color:#000;margin:0">${escHtml(emp.nombre || 'Inmobiliaria')}</h1>
    <p style="font-family:Arial;font-size:8pt;color:#666;margin:4px 0">${escHtml([emp.email, emp.telefono, emp.direccion].filter(Boolean).join(' | '))}</p>
  </div>
  <h2 style="font-family:Arial;font-size:13pt;color:#000;letter-spacing:1.5px;margin:0 0 4px">LIQUIDACIÓN GENERAL</h2>
  <p style="font-family:Arial;font-size:9pt;color:#666;margin:0 0 15px">${escHtml(periodo.label)} &middot; ${dataArray.length} propiedades</p>
  <hr style="border:none;border-top:1px solid #000;margin-bottom:15px">
  ${propertyBlocks}
  <div style="background:#000;color:#FFF;padding:10px;margin-top:10px">
    <strong style="font-family:Arial;font-size:13pt">TOTAL</strong>
    <strong style="font-family:Arial;font-size:13pt;float:right">${fmt(grandTotal, currency)}</strong>
  </div>
  ${(() => {
    const firstHon = dataArray.find(d => d.honorarios);
    if (!firstHon) return '';
    const totalHon = dataArray.reduce((s, d) => s + (d.honorarios?.monto || 0), 0);
    const totalNeto = dataArray.reduce((s, d) => s + (d.honorarios?.netoTransferir || d.total), 0);
    return `
  <div style="margin-top:12px;padding:10px;background:#FAFAFA;border:1px solid #E0E0E0">
    <p style="font-family:Arial;font-size:10pt;color:#333;margin:4px 0"><strong>Honorarios (${firstHon.honorarios.porcentaje}%):</strong> <span style="float:right">${fmt(totalHon, currency)}</span></p>
    <p style="font-family:Arial;font-size:11pt;color:#000;margin:4px 0"><strong>Neto a transferir:</strong> <span style="float:right"><strong>${fmt(totalNeto, currency)}</strong></span></p>
  </div>`;
  })()}
  <div style="margin-top:30px;border-top:1px solid #E0E0E0;padding-top:8px">
    <p style="font-family:Arial;font-size:7pt;color:#999">Generado por ${escHtml(emp.nombre || 'Inmobiliaria')}${emp.cuit ? ` | CUIT ${escHtml(emp.cuit)}` : ''}</p>
  </div>
</body></html>`;
};

// ============================================
// PAGO EFECTIVO HTML (Recibo)
// ============================================

const generatePagoEfectivoHTML = (data) => {
  const emp = data.empresa;

  const conceptRows = data.conceptos.map((c, i) => `
    <tr style="background:${i % 2 === 1 ? '#F5F5F5' : '#FFFFFF'}">
      <td style="padding:6px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:11pt;color:#000">${escHtml(c.concepto)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #E0E0E0;font-family:Arial;font-size:11pt;color:#333;text-align:right">${fmt(c.importe, data.currency)}</td>
    </tr>`).join('');

  const fiscalParts = [
    emp.cuit ? `CUIT: ${escHtml(emp.cuit)}` : null,
    emp.ingBrutos ? `ING. BRUTOS: ${escHtml(emp.ingBrutos)}` : null,
    emp.fechaInicioAct ? `Inicio Act.: ${escHtml(emp.fechaInicioAct)}` : null,
  ].filter(Boolean).join(' &nbsp;&nbsp; ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo - ${escHtml(data.inquilino.nombre)} - ${escHtml(data.periodo.label)}</title>
</head>
<body style="margin:20mm;font-family:Arial,sans-serif;color:#000;max-width:600px">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
    <div>
      <h1 style="font-family:Arial;font-size:14pt;color:#000;margin:0">${escHtml(emp.nombre || 'Inmobiliaria')}</h1>
      <p style="font-family:Arial;font-size:8pt;color:#666;margin:2px 0">${escHtml([emp.direccion, emp.telefono, emp.email].filter(Boolean).join(' | '))}</p>
    </div>
    <div style="text-align:center;border:1px solid #000;padding:6px 14px;border-radius:4px">
      <p style="font-family:Arial;font-size:8pt;color:#666;margin:0">N° ${escHtml(data.receiptNumber)}</p>
      <p style="font-family:Arial;font-size:14pt;font-weight:bold;color:#000;margin:4px 0">RECIBO</p>
      <p style="font-family:Arial;font-size:8pt;color:#666;margin:0">${fmtDate(data.fecha)}</p>
    </div>
  </div>

  ${fiscalParts ? `<p style="font-family:Arial;font-size:7pt;color:#999;margin:0 0 6px 0">${fiscalParts}</p>` : ''}
  ${emp.ivaCondicion ? `
  <div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:4px 0;text-align:center;margin-bottom:10px">
    <strong style="font-family:Arial;font-size:9pt;color:#000">${escHtml(emp.ivaCondicion)}</strong>
  </div>` : ''}

  <!-- CLIENT DATA -->
  <p style="font-family:Arial;font-size:10pt;margin:4px 0"><strong>Señor/es:</strong> ${escHtml(data.inquilino.nombre)}</p>
  <p style="font-family:Arial;font-size:10pt;margin:4px 0"><strong>Domicilio:</strong> ${escHtml(data.propiedad.direccion)}</p>
  <p style="font-family:Arial;font-size:10pt;margin:4px 0"><strong>Período:</strong> ${escHtml(data.periodo.label)}</p>
  ${data.propietario?.nombre ? `<p style="font-family:Arial;font-size:10pt;margin:4px 0 12px 0"><strong>Por cuenta y orden de:</strong> ${escHtml(data.propietario.nombre)}</p>` : '<div style="margin-bottom:12px"></div>'}

  <!-- TABLE -->
  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#333">
      <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:left">CONCEPTO</th>
      <th style="padding:6px 10px;font-family:Arial;font-size:9pt;color:#FFF;text-align:right">IMPORTE</th>
    </tr>
    ${conceptRows}
    <tr style="background:#000">
      <td style="padding:8px 10px;font-family:Arial;font-size:13pt;color:#FFF;font-weight:bold">TOTAL</td>
      <td style="padding:8px 10px;font-family:Arial;font-size:13pt;color:#FFF;font-weight:bold;text-align:right">${fmt(data.total, data.currency)}</td>
    </tr>
  </table>

  ${data.totalEnLetras ? `<p style="font-family:Arial;font-size:8pt;color:#333;font-style:italic;margin-top:8px">Son: ${escHtml(data.totalEnLetras)}</p>` : ''}

  <!-- FOOTER -->
  <div style="margin-top:20px;border-top:1px solid #E0E0E0;padding-top:8px">
    <p style="font-family:Arial;font-size:7pt;color:#999">Generado por ${escHtml(emp.nombre || 'Inmobiliaria')}${emp.cuit ? ` | CUIT ${escHtml(emp.cuit)}` : ''}</p>
  </div>

</body>
</html>`;
};

// ============================================
// PAGO EFECTIVO ALL HTML (Multiple Recibos)
// ============================================

const generatePagoEfectivoAllHTML = (dataArray) => {
  if (dataArray.length === 0) return '<html><body><p>Sin datos</p></body></html>';

  const blocks = dataArray.map((data) => generatePagoEfectivoHTML(data)
    .replace(/<!DOCTYPE html>[\s\S]*?<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*<\/html>/, '')
  );

  const emp = dataArray[0].empresa;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibos de Pago - Consolidado</title>
  <style>
    @media print { .recibo-block { page-break-after: always; } .recibo-block:last-child { page-break-after: auto; } }
  </style>
</head>
<body style="margin:20mm;font-family:Arial,sans-serif;color:#000;max-width:600px">
  ${blocks.map(b => `<div class="recibo-block">${b}<hr style="border:none;border-top:2px solid #000;margin:30px 0"></div>`).join('\n')}
</body>
</html>`;
};

module.exports = {
  generateLiquidacionHTML,
  generateLiquidacionAllHTML,
  generatePagoEfectivoHTML,
  generatePagoEfectivoAllHTML,
};
