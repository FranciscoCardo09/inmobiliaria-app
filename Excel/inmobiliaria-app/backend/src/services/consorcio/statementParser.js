// Parser del "Extracto de Cuenta" (Banco Roela / SIRO) a partir de los
// renglones posicionados de pdfText.extractPages().
//
// Garantía: si devuelve un resultado, cada peso del PDF está contado. El saldo
// inicial más los movimientos tiene que coincidir con cada "Saldo al dd/mm" y
// con el saldo final. Si un renglón no se entiende, se rechaza el extracto
// entero (UNRECOGNIZED_LINE) en lugar de saltearlo en silencio.
const { ConsorcioError } = require('./errors');
const { parseAmount, formatAmount } = require('./money');

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const PERIOD_RE = /entre el (\d{1,2})\/(\d{1,2})\/(\d{4}) y el (\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const FOOTER_RE = /^Página (\d+) de (\d+)/i;
const PAGE_HEADER_RE = /^(Extracto de Cuenta|entre el .*)$/i;
const OPENING_RE = /^(\d{2}\/\d{2}\/\d{4}) Saldo Al Inicio (.+)$/i;
const DAILY_RE = /^Saldo al (\d{2}\/\d{2}\/\d{4}) (.+)$/i;
const ORPHAN_MAX_DISTANCE = 9; // pt entre una descripción suelta y su movimiento
const COLUMN_HEADERS = ['Fecha', 'Comprobante', 'Concepto', 'Descripción', 'Importe'];

function fail(code, message, details = null) {
  throw new ConsorcioError(code, message, 400, details);
}

function lineText(line) {
  return line.tokens.map((t) => t.text).join(' ');
}

// "06/07/2026" → "2026-07-06" (valida que la fecha exista)
function parseDate(text, where) {
  const m = DATE_RE.exec(text);
  const d = m && new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (!m || d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) {
    fail('BAD_DATE', `Fecha inválida "${text}"`, where);
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function isoFromParts(day, month, year) {
  return parseDate(`${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`, null);
}

function amountAt(text, where) {
  try {
    return parseAmount(text);
  } catch (err) {
    fail('BAD_AMOUNT', err.message, where);
  }
}

// Saca CUIT y contraparte de una descripción de transferencia:
// "TRANSF.INTERB.DISTINTO TIT. 23444444445 LIMPIEZA SERVICIOS INTEGRALES"
//   → { cuit: '23444444445', counterparty: 'LIMPIEZA SERVICIOS INTEGRALES', ownAccount: false }
function parseCounterparty(description) {
  const m = /\b(\d{11})\b\s*(.*)$/.exec(description);
  return {
    cuit: m ? m[1] : null,
    counterparty: m && m[2] ? m[2].trim() : null,
    ownAccount: /MISMO TIT/i.test(description),
  };
}

function readHeader(page1) {
  const texts = page1.lines.map(lineText);
  const periodIdx = texts.findIndex((t) => PERIOD_RE.test(t));
  if (!texts.some((t) => /^Extracto de Cuenta$/i.test(t)) || periodIdx === -1) {
    fail('NOT_A_STATEMENT', 'El PDF no parece un "Extracto de Cuenta": falta el título o el período ("entre el … y el …").');
  }
  const p = PERIOD_RE.exec(texts[periodIdx]);
  const period = { from: isoFromParts(p[1], p[2], p[3]), to: isoFromParts(p[4], p[5], p[6]) };
  if (period.from > period.to) fail('BAD_PERIOD', `El período del extracto está invertido (${texts[periodIdx]}).`);

  const headerRowIdx = page1.lines.findIndex((line) => COLUMN_HEADERS.every((h) => line.tokens.some((t) => t.text === h)));
  if (headerRowIdx === -1) {
    fail('NOT_A_STATEMENT', 'No se encontró la fila de títulos (Fecha / Comprobante / Concepto / Descripción / Importe).');
  }
  const headerRow = page1.lines[headerRowIdx];
  const colX = Object.fromEntries(COLUMN_HEADERS.map((h) => [h, headerRow.tokens.find((t) => t.text === h).x]));

  const info = { accountName: null, holderName: null, holderCuit: null, cbu: null, accountNumber: null, branch: null };
  for (const text of texts.slice(periodIdx + 1, headerRowIdx)) {
    let m;
    if ((m = /Titular:\s*(.+?)\s+(\d{11})$/i.exec(text))) {
      info.holderName = m[1];
      info.holderCuit = m[2];
    } else if ((m = /^C\.B\.U\.:\s*(\d{22})$/i.exec(text))) {
      info.cbu = m[1];
    } else if ((m = /Nro\.\s*(\S+)\s+Sucursal:\s*(.+)$/i.exec(text))) {
      info.accountNumber = m[1];
      info.branch = m[2];
    } else if (!info.accountName) {
      info.accountName = text;
    }
  }
  if (!info.cbu) fail('MISSING_CBU', 'El extracto no tiene el C.B.U. de la cuenta en el encabezado.');

  return { period, colX, headerRowIdx, ...info };
}

function checkFooters(pages) {
  pages.forEach((page, i) => {
    const m = page.lines.map(lineText).map((t) => FOOTER_RE.exec(t)).find(Boolean);
    if (!m || Number(m[1]) !== i + 1 || Number(m[2]) !== pages.length) {
      fail('MISSING_PAGES', `El extracto está incompleto: la hoja ${i + 1} de ${pages.length} no tiene el pie "Página ${i + 1} de ${pages.length}".`, { page: i + 1 });
    }
  });
}

// Clasifica un renglón de la tabla.
function readRow(line, colX, where) {
  const text = lineText(line);
  const tokens = line.tokens;
  const last = tokens[tokens.length - 1];

  let m;
  if ((m = OPENING_RE.exec(text))) {
    return { type: 'opening', date: parseDate(m[1], where), cents: amountAt(m[2], where) };
  }
  if ((m = DAILY_RE.exec(text))) {
    return { type: 'daily', date: parseDate(m[1], where), cents: amountAt(m[2], where) };
  }

  const descBoundary = (colX.Concepto + colX['Descripción']) / 2;
  const startsWithDate = DATE_RE.test(tokens[0].text) && tokens[0].x < colX.Comprobante;

  if (startsWithDate && tokens.length >= 3 && /\$/.test(last.text)) {
    const middle = tokens.slice(1, -1);
    const codes = [];
    while (middle.length && /^\d+$/.test(middle[0].text) && middle[0].x < descBoundary) codes.push(middle.shift().text);
    if (codes.length < 1 || codes.length > 2 || middle.some((t) => t.x < descBoundary)) {
      fail('UNRECOGNIZED_LINE', `No se entiende el renglón: "${text}"`, where);
    }
    return {
      type: 'movement',
      date: parseDate(tokens[0].text, where),
      voucher: codes.length === 2 ? codes[0] : null,
      conceptCode: codes[codes.length - 1],
      ownDescription: middle.map((t) => t.text).join(' '),
      cents: amountAt(last.text, where),
    };
  }

  const hasAmount = tokens.some((t) => /\$/.test(t.text));
  if (!startsWithDate && !hasAmount && tokens[0].x >= descBoundary && tokens[0].x < colX.Importe) {
    return { type: 'description', text };
  }

  fail('UNRECOGNIZED_LINE', `No se entiende el renglón: "${text}"`, where);
}

function parseStatement(pages) {
  if (!Array.isArray(pages) || pages.length === 0) fail('NO_TEXT', 'El PDF no tiene páginas con texto.');
  const header = readHeader(pages[0]);
  checkFooters(pages);

  const entries = []; // en orden de lectura
  let opening = null;
  pages.forEach((page, pi) => {
    const startIdx = pi === 0 ? header.headerRowIdx + 1 : 0;
    page.lines.slice(startIdx).forEach((line) => {
      const text = lineText(line);
      if (PAGE_HEADER_RE.test(text) || FOOTER_RE.test(text)) return;
      const where = { page: page.number, text };
      const row = readRow(line, header.colX, where);
      if (row.type === 'opening') {
        if (opening || entries.length) fail('UNRECOGNIZED_LINE', `"Saldo Al Inicio" fuera de lugar: "${text}"`, where);
        opening = row;
        return;
      }
      if (!opening) fail('MISSING_OPENING_BALANCE', 'El extracto no empieza con "Saldo Al Inicio".', where);
      entries.push({ ...row, page: page.number, y: line.y, where });
    });
  });
  if (!opening) fail('MISSING_OPENING_BALANCE', 'El extracto no tiene "Saldo Al Inicio".');

  // Pegar cada descripción suelta al movimiento más cercano de la misma hoja.
  const movements = entries.filter((e) => e.type === 'movement');
  for (const mv of movements) mv.parts = mv.ownDescription ? [{ y: mv.y, text: mv.ownDescription }] : [];
  for (const d of entries.filter((e) => e.type === 'description')) {
    let best = null;
    for (const mv of movements) {
      const dist = Math.abs(mv.y - d.y);
      if (mv.page === d.page && dist <= ORPHAN_MAX_DISTANCE && (!best || dist < best.dist)) best = { mv, dist };
    }
    if (!best) fail('ORPHAN_DESCRIPTION', `Hay un texto que no corresponde a ningún movimiento: "${d.text}"`, d.where);
    best.mv.parts.push({ y: d.y, text: d.text });
  }

  // Conciliación: saldo inicial + movimientos = cada saldo diario = saldo final.
  let running = opening.cents;
  let closing = opening.cents;
  let pendingSinceDaily = false;
  const dailyBalances = [];
  for (const e of entries) {
    if (e.type === 'movement') {
      running += e.cents;
      pendingSinceDaily = true;
    } else if (e.type === 'daily') {
      if (e.cents !== running) {
        fail('DAILY_BALANCE_MISMATCH',
          `El saldo del ${e.date.split('-').reverse().join('/')} no cuadra: el extracto dice ${formatAmount(e.cents)} y la suma de movimientos da ${formatAmount(running)} (diferencia ${formatAmount(e.cents - running)}). Puede faltar o sobrar un renglón.`,
          { ...e.where, printedCents: e.cents, computedCents: running });
      }
      dailyBalances.push({ date: e.date, cents: e.cents });
      closing = e.cents;
      pendingSinceDaily = false;
    }
  }
  if (pendingSinceDaily) fail('MISSING_CLOSING_BALANCE', 'Después del último movimiento no hay un "Saldo al …" para confirmar el saldo final.');

  const seen = new Map();
  const result = movements.map((mv, index) => {
    if (mv.date < header.period.from || mv.date > header.period.to) {
      fail('DATE_OUT_OF_PERIOD', `El movimiento del ${mv.date} está fuera del período del extracto (${header.period.from} a ${header.period.to}).`, mv.where);
    }
    const description = mv.parts.sort((a, b) => b.y - a.y).map((p) => p.text).join(' ');
    const base = `${mv.date}|${mv.voucher || ''}|${mv.conceptCode}|${mv.cents}|${description}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return {
      index,
      page: mv.page,
      date: mv.date,
      voucher: mv.voucher,
      conceptCode: mv.conceptCode,
      description,
      amountCents: mv.cents,
      ...parseCounterparty(description),
      fingerprint: `${base}#${n}`,
    };
  });

  return {
    period: header.period,
    accountName: header.accountName,
    holderName: header.holderName,
    holderCuit: header.holderCuit,
    cbu: header.cbu,
    accountNumber: header.accountNumber,
    branch: header.branch,
    openingBalanceCents: opening.cents,
    closingBalanceCents: closing,
    dailyBalances,
    movements: result,
  };
}

module.exports = { parseStatement, parseCounterparty, parseDate };
