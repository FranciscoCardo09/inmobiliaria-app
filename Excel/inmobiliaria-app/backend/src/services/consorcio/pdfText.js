// Extrae el texto de un PDF con su posición, agrupado en renglones.
// Usa pdfjs-dist (sin binarios del sistema: en Render no hay poppler).
//
// Salida: [{ number, lines: [{ y, tokens: [{ text, x, width }] }] }]
//   - renglones ordenados de arriba hacia abajo (y desc, como pdfjs)
//   - tokens ordenados de izquierda a derecha; los fragmentos pegados (sin
//     hueco visible) se fusionan en un solo token.
const { ConsorcioError } = require('./errors');

const SAME_LINE_TOLERANCE = 2; // pt: items con |Δy| menor son el mismo renglón
const JOIN_GAP = 1.5; // pt: fragmentos más cercanos que esto se concatenan

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

// items: [{ str, x, y, width }] de una página → renglones
function groupLines(items) {
  const visible = items
    .filter((it) => it.str.trim() !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const it of visible) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= SAME_LINE_TOLERANCE) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }

  return lines.map((line) => {
    const sorted = line.items.sort((a, b) => a.x - b.x);
    const tokens = [];
    for (const it of sorted) {
      const prev = tokens[tokens.length - 1];
      if (prev && it.x - (prev.x + prev.width) < JOIN_GAP) {
        prev.text += it.str;
        prev.width = it.x + it.width - prev.x;
      } else {
        tokens.push({ text: it.str, x: it.x, width: it.width });
      }
    }
    for (const t of tokens) t.text = t.text.replace(/\s+/g, ' ').trim();
    return { y: line.y, tokens };
  });
}

async function extractPages(buffer) {
  if (!isPdfBuffer(buffer)) {
    throw new ConsorcioError('NOT_PDF', 'El archivo no es un PDF.');
  }
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0,
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
  } catch (err) {
    if (err.name === 'PasswordException') {
      throw new ConsorcioError('PDF_ENCRYPTED', 'El PDF está protegido con contraseña. Descargalo sin clave desde el banco.');
    }
    throw new ConsorcioError('PDF_UNREADABLE', 'No se pudo leer el PDF (archivo dañado o incompleto).');
  }

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width,
    }));
    pages.push({ number: n, lines: groupLines(items) });
  }
  await doc.destroy();

  if (pages.every((p) => p.lines.length === 0)) {
    throw new ConsorcioError('NO_TEXT', 'El PDF no tiene texto (¿es un escaneo o una foto?). Descargá el extracto digital desde el home banking.');
  }
  return pages;
}

module.exports = { extractPages, groupLines, isPdfBuffer };
