// DOCX Templates - Professional minimalist Word documents
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType,
  PageBreak, Header, Footer,
} = require('docx');
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

// Colors
const BLACK = '000000';
const DARK = '333333';
const MEDIUM = '666666';
const LIGHT_BG = 'F5F5F5';
const WHITE = 'FFFFFF';

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
};

const NO_BORDER = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

// ============================================
// LIQUIDACION DOCX
// ============================================

const generateLiquidacionDOCX = async (data) => {
  const emp = data.empresa;
  const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');
  const now = new Date();

  const children = [];

  // Company header
  children.push(
    new Paragraph({
      children: [new TextRun({ text: (emp.nombre || 'Inmobiliaria').toUpperCase(), bold: true, size: 28, font: 'Arial', color: BLACK })],
      spacing: { after: 40 },
    })
  );

  const contactParts = [emp.email, emp.telefono, emp.direccion, emp.ciudad].filter(Boolean);
  if (contactParts.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contactParts.join(' | '), size: 16, font: 'Arial', color: MEDIUM })],
        spacing: { after: 40 },
      })
    );
  }
  if (emp.cuit) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `CUIT: ${emp.cuit}`, size: 16, font: 'Arial', color: MEDIUM })],
        spacing: { after: 80 },
      })
    );
  }

  // Separator
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BLACK } },
    spacing: { after: 200 },
  }));

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'LIQUIDACIÓN', bold: true, size: 26, font: 'Arial', color: BLACK, characterSpacing: 40 }),
        new TextRun({ text: `   ${data.periodo.label}`, size: 20, font: 'Arial', color: MEDIUM }),
      ],
      spacing: { after: 80 },
    })
  );

  if (data.periodo.labelVencido) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Mes vencido: ${data.periodo.labelVencido}`, size: 18, font: 'Arial', color: MEDIUM })],
        spacing: { after: 80 },
      })
    );
  }

  // Separator
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } },
    spacing: { after: 200 },
  }));

  // Info fields
  const infoFields = [
    ['Inquilino', data.inquilino.nombre],
    ['Propiedad', addr],
    ['Propietario', data.propietario.nombre],
  ];

  for (const [label, value] of infoFields) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, size: 18, font: 'Arial', color: MEDIUM }),
          new TextRun({ text: value || '-', bold: true, size: 18, font: 'Arial', color: BLACK }),
        ],
        spacing: { after: 60 },
      })
    );
  }

  children.push(new Paragraph({ spacing: { after: 120 } }));

  // Concepts table
  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'CONCEPTO', bold: true, size: 16, font: 'Arial', color: WHITE })], alignment: AlignmentType.LEFT })],
        shading: { type: ShadingType.SOLID, color: DARK },
        borders: THIN_BORDER,
        width: { size: 70, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'IMPORTE', bold: true, size: 16, font: 'Arial', color: WHITE })], alignment: AlignmentType.RIGHT })],
        shading: { type: ShadingType.SOLID, color: DARK },
        borders: THIN_BORDER,
        width: { size: 30, type: WidthType.PERCENTAGE },
      }),
    ],
  });

  const dataRows = data.conceptos.map((c, i) => {
    const bg = i % 2 === 1 ? { type: ShadingType.SOLID, color: LIGHT_BG } : undefined;
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: c.concepto, size: 18, font: 'Arial', color: BLACK })], alignment: AlignmentType.LEFT })],
          shading: bg,
          borders: THIN_BORDER,
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: fmt(c.importe, data.currency), size: 18, font: 'Arial', color: DARK })], alignment: AlignmentType.RIGHT })],
          shading: bg,
          borders: THIN_BORDER,
        }),
      ],
    });
  });

  // Total row
  const totalRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: 'TOTAL A PAGAR', bold: true, size: 22, font: 'Arial', color: WHITE })], alignment: AlignmentType.LEFT })],
        shading: { type: ShadingType.SOLID, color: BLACK },
        borders: THIN_BORDER,
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: fmt(data.total, data.currency), bold: true, size: 22, font: 'Arial', color: WHITE })], alignment: AlignmentType.RIGHT })],
        shading: { type: ShadingType.SOLID, color: BLACK },
        borders: THIN_BORDER,
      }),
    ],
  });

  children.push(
    new Table({
      rows: [headerRow, ...dataRows, totalRow],
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  );

  // Amount in words
  if (data.totalEnLetras) {
    children.push(new Paragraph({ spacing: { before: 120 } }));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Son: ${data.totalEnLetras}`, size: 16, font: 'Arial', color: DARK, italics: true })],
        spacing: { after: 120 },
      })
    );
  }

  // Payments section
  if (data.transacciones && data.transacciones.length > 0) {
    children.push(new Paragraph({ spacing: { after: 120 } }));
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BLACK } },
      spacing: { after: 80 },
    }));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'PAGOS REGISTRADOS', bold: true, size: 20, font: 'Arial', color: BLACK, characterSpacing: 20 })],
        spacing: { after: 120 },
      })
    );

    const payHeader = new TableRow({
      children: ['FECHA', 'MÉTODO', 'MONTO'].map((h, i) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 14, font: 'Arial', color: WHITE })], alignment: i === 2 ? AlignmentType.RIGHT : AlignmentType.LEFT })],
        shading: { type: ShadingType.SOLID, color: DARK },
        borders: THIN_BORDER,
      })),
    });

    const payRows = data.transacciones.map((t, i) => {
      const metodo = t.metodo === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo';
      const bg = i % 2 === 1 ? { type: ShadingType.SOLID, color: LIGHT_BG } : undefined;
      return new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: fmtDate(t.fecha), size: 16, font: 'Arial' })] })], shading: bg, borders: THIN_BORDER }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: metodo, size: 16, font: 'Arial' })] })], shading: bg, borders: THIN_BORDER }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: fmt(t.monto, data.currency), size: 16, font: 'Arial' })], alignment: AlignmentType.RIGHT })], shading: bg, borders: THIN_BORDER }),
        ],
      });
    });

    children.push(
      new Table({
        rows: [payHeader, ...payRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );

    children.push(new Paragraph({ spacing: { before: 80 } }));
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Total Pagado: ', bold: true, size: 18, font: 'Arial', color: BLACK }),
          new TextRun({ text: fmt(data.amountPaid, data.currency), bold: true, size: 18, font: 'Arial', color: BLACK }),
        ],
      })
    );

    if (data.balance !== 0) {
      const balLabel = data.balance > 0 ? 'Saldo a Favor: ' : 'Saldo Pendiente: ';
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: balLabel, bold: true, size: 18, font: 'Arial', color: DARK }),
            new TextRun({ text: fmt(Math.abs(data.balance), data.currency), bold: true, size: 18, font: 'Arial', color: BLACK }),
          ],
        })
      );
    }
  }

  // Footer note
  children.push(new Paragraph({ spacing: { before: 300 } }));
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } },
    spacing: { before: 40, after: 40 },
  }));
  children.push(
    new Paragraph({
      children: [new TextRun({
        text: `Generado por ${emp.nombre || 'Inmobiliaria'}${emp.cuit ? ` | CUIT ${emp.cuit}` : ''}`,
        size: 14, font: 'Arial', color: MEDIUM,
      })],
    })
  );

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 20mm = ~1134 twips
          size: { width: 11906, height: 16838 }, // A4
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
};

// ============================================
// LIQUIDACION ALL DOCX
// ============================================

const generateLiquidacionAllDOCX = async (dataArray) => {
  const { numeroATexto } = require('../utils/helpers');
  if (dataArray.length === 0) return Buffer.from('');

  const emp = dataArray[0].empresa;
  const currency = dataArray[0].currency;
  const periodo = dataArray[0].periodo;

  let grandTotal = 0;
  for (const d of dataArray) grandTotal += d.total;

  const children = [];

  // Company header
  children.push(
    new Paragraph({
      children: [new TextRun({ text: (emp.nombre || 'Inmobiliaria').toUpperCase(), bold: true, size: 28, font: 'Arial', color: BLACK })],
      spacing: { after: 40 },
    })
  );

  const contactParts = [emp.email, emp.telefono, emp.direccion].filter(Boolean);
  if (contactParts.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: contactParts.join(' | '), size: 16, font: 'Arial', color: MEDIUM })],
      spacing: { after: 80 },
    }));
  }

  // Separator + Title
  children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BLACK } }, spacing: { after: 200 } }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'LIQUIDACIÓN GENERAL', bold: true, size: 26, font: 'Arial', color: BLACK, characterSpacing: 40 }),
      new TextRun({ text: `   ${periodo.label}`, size: 20, font: 'Arial', color: MEDIUM }),
    ],
    spacing: { after: 120 },
  }));

  // Summary
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `Propiedades: ${dataArray.length}`, size: 18, font: 'Arial', color: DARK }),
      new TextRun({ text: `     Total: ${fmt(grandTotal, currency)}`, bold: true, size: 18, font: 'Arial', color: BLACK }),
    ],
    spacing: { after: 160 },
  }));

  children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } }, spacing: { after: 120 } }));

  // Detail per property
  for (const data of dataArray) {
    const conceptosFiltered = data.conceptos.filter(c => !(c.concepto.includes('Punitorios') && c.importe === 0));
    const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ');

    children.push(new Paragraph({
      children: [
        new TextRun({ text: addr, bold: true, size: 18, font: 'Arial', color: BLACK }),
        new TextRun({ text: ` — ${data.inquilino.nombre}`, size: 18, font: 'Arial', color: MEDIUM }),
      ],
      spacing: { before: 80, after: 40 },
    }));

    for (const c of conceptosFiltered) {
      const label = c.concepto.includes('Punitorios (0') ? 'Punitorios' : c.concepto;
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `    ${label}`, size: 16, font: 'Arial', color: MEDIUM }),
          new TextRun({ text: `\t${fmt(c.importe, currency)}`, size: 16, font: 'Arial', color: DARK }),
        ],
        tabStops: [{ type: 'right', position: 9000 }],
      }));
    }

    children.push(new Paragraph({
      children: [
        new TextRun({ text: '    Subtotal', bold: true, size: 18, font: 'Arial', color: BLACK }),
        new TextRun({ text: `\t${fmt(data.total, currency)}`, bold: true, size: 18, font: 'Arial', color: BLACK }),
      ],
      tabStops: [{ type: 'right', position: 9000 }],
      spacing: { after: 60 },
    }));

    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } }, spacing: { after: 80 } }));
  }

  // Grand Total
  children.push(new Paragraph({ spacing: { before: 80 } }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'TOTAL', bold: true, size: 26, font: 'Arial', color: BLACK }),
      new TextRun({ text: `\t${fmt(grandTotal, currency)}`, bold: true, size: 26, font: 'Arial', color: BLACK }),
    ],
    tabStops: [{ type: 'right', position: 9000 }],
    shading: { type: ShadingType.SOLID, color: LIGHT_BG },
    spacing: { after: 80 },
  }));

  const totalLetras = numeroATexto(grandTotal);
  children.push(new Paragraph({
    children: [new TextRun({ text: `Son: ${totalLetras}`, size: 16, font: 'Arial', color: DARK, italics: true })],
    spacing: { after: 200 },
  }));

  // Footer
  children.push(new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } }, spacing: { before: 40 } }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Generado por ${emp.nombre || 'Inmobiliaria'}${emp.cuit ? ` | CUIT ${emp.cuit}` : ''}`, size: 14, font: 'Arial', color: MEDIUM })],
  }));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          size: { width: 11906, height: 16838 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
};

module.exports = {
  generateLiquidacionDOCX,
  generateLiquidacionAllDOCX,
};
