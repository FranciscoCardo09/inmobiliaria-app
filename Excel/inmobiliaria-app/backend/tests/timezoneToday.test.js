const test = require('node:test');
const assert = require('node:assert');
const { getTodayLocalString, getTodayLocalDate } = require('../src/utils/dateUtils');
const { calculatePunitoryV2, toLocalDate } = require('../src/utils/punitory');

// A-25 (AUDITORIA_FUNCIONAL_2026-07-10.md): el servidor (Render) corre sin TZ
// configurada (= UTC). Entre las 21:00 y las 23:59 ART (UTC-3), `new Date()`
// ya cayó en el día UTC siguiente, y todo cálculo de punitorios en vivo que
// lo use como "hoy" cuenta un día de más (o reclasifica el mes como "pasado"
// un día antes de tiempo). Estos tests fijan el comportamiento del helper
// `getTodayLocalString`/`getTodayLocalDate` que corrige eso SIN fijar TZ
// global del proceso ni migrar datos históricos.

// ================= getTodayLocalString: límites de día ART =================

test('getTodayLocalString - mediodía ART cae en el día esperado', (t) => {
  // 2026-07-31T15:00:00Z = 2026-07-31T12:00:00 ART (UTC-3)
  const now = new Date('2026-07-31T15:00:00Z');
  assert.strictEqual(getTodayLocalString(now), '2026-07-31');
});

test('getTodayLocalString - 20:30 ART sigue en el mismo día', (t) => {
  // 2026-07-31T23:30:00Z = 2026-07-31T20:30:00 ART
  const now = new Date('2026-07-31T23:30:00Z');
  assert.strictEqual(getTodayLocalString(now), '2026-07-31');
});

test('getTodayLocalString - CASO DEL BUG: 23:30 ART sigue siendo el 31, no el 1', (t) => {
  // 2026-08-01T02:30:00Z = 2026-07-31T23:30:00 ART.
  // `new Date()` crudo en un proceso UTC ya reporta 01/08 acá (getFullYear/
  // getMonth/getDate devuelven los componentes UTC) - ese es exactamente el
  // corrimiento de A-25. El helper debe devolver el día ART real: 31/07.
  const now = new Date('2026-08-01T02:30:00Z');
  assert.strictEqual(getTodayLocalString(now), '2026-07-31');
});

test('getTodayLocalString - 00:30 ART del día siguiente ya es el nuevo día', (t) => {
  // 2026-08-01T03:30:00Z = 2026-08-01T00:30:00 ART
  const now = new Date('2026-08-01T03:30:00Z');
  assert.strictEqual(getTodayLocalString(now), '2026-08-01');
});

test('getTodayLocalString - cruce de año (31/12 a la noche ART)', (t) => {
  // 2026-01-01T02:30:00Z = 2025-12-31T23:30:00 ART
  const now = new Date('2026-01-01T02:30:00Z');
  assert.strictEqual(getTodayLocalString(now), '2025-12-31');
});

test('getTodayLocalString - default sin argumento no explota', (t) => {
  const result = getTodayLocalString();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

// ================= getTodayLocalDate =================

test('getTodayLocalDate - devuelve un Date con el mismo día calendario que el string', (t) => {
  const now = new Date('2026-08-01T02:30:00Z'); // caso del bug: 23:30 ART del 31/07
  const d = getTodayLocalDate(now);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 6); // Julio (0-indexed)
  assert.strictEqual(d.getDate(), 31);
});

test('getTodayLocalDate - toLocalDate(punitory.js) lo trunca al mismo día que produjo', (t) => {
  // El Date devuelto debe sobrevivir intacto al truncado de calculatePunitoryV2
  // (toLocalDate usa getFullYear/getMonth/getDate, no getters UTC).
  const now = new Date('2026-08-01T02:30:00Z');
  const d = getTodayLocalDate(now);
  const truncated = toLocalDate(d);
  assert.strictEqual(truncated.getFullYear(), 2026);
  assert.strictEqual(truncated.getMonth(), 6);
  assert.strictEqual(truncated.getDate(), 31);
});

// ================= Regresión del wiring: calculatePunitoryV2 con el "hoy" corregido =================

test('A-25: pasar new Date() crudo (UTC) de las 23:30 ART cuenta un día de más que el string ART correcto', (t) => {
  // Mes de julio 2026, pago SIN pagos previos, ya pasado el punitoryStartDay.
  // Simulamos el "hoy" real de un servidor UTC a las 23:30 ART del 31/07/2026,
  // dentro del propio mes de julio (mes ACTUAL, no pasado).
  //
  // `toLocalDate` (punitory.js) trunca un Date con getFullYear/getMonth/getDate,
  // que son locales AL PROCESO. La máquina de desarrollo suele estar en ART
  // (America/Cordoba/Buenos_Aires), lo que "enmascara el bug" (tal como señala
  // la auditoría) si no se fuerza explícitamente la TZ=UTC del servidor real
  // (Render). Por eso este test fija `process.env.TZ='UTC'` para reproducir
  // determinísticamente el escenario de producción, sin importar en qué TZ
  // corra la suite, y lo restaura al terminar.
  const originalTz = process.env.TZ;
  process.env.TZ = 'UTC';
  let withBug, withFix;
  try {
    const rawNow = new Date('2026-08-01T02:30:00Z'); // lo que `new Date()` crudo daría
    const correctedToday = getTodayLocalString(rawNow); // '2026-07-31'

    withBug = calculatePunitoryV2(
      rawNow, 7, 2026, 100000, /*startDay*/ 10, /*graceDay*/ 10, 0.006, [], null
    );
    withFix = calculatePunitoryV2(
      correctedToday, 7, 2026, 100000, 10, 10, 0.006, [], null
    );
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }

  // Con el bug: payDateNorm cae en agosto -> periodMonth(7) < payMonth(8) ->
  // isPastPeriod = true -> cuenta desde el día 1 del mes (31 días), NO desde
  // punitoryStartDay. Con el fix: sigue siendo julio (mes actual) -> cuenta
  // desde el día 10 (22 días: 10 a 31 inclusive).
  assert.strictEqual(withFix.days, 22, 'con el día ART correcto, el mes sigue siendo julio: 10..31 inclusive');
  assert.strictEqual(withBug.days, 32, 'con el Date crudo (bug), julio se reclasifica como pasado: día 1..1(ago), ambos inclusive');
  assert.notStrictEqual(withBug.days, withFix.days, 'el bug y el fix deben dar resultados distintos en este caso límite');
  assert.ok(withFix.amount < withBug.amount, 'el fix nunca debe cobrar de más que el bug en este escenario');
});

test('A-25: en horario diurno, Date crudo y string ART coinciden (no hay regresión fuera del horario de riesgo)', (t) => {
  const rawNow = new Date('2026-07-15T15:00:00Z'); // mediodía ART, sin riesgo de corrimiento
  const correctedToday = getTodayLocalString(rawNow);

  const withRawDate = calculatePunitoryV2(rawNow, 7, 2026, 100000, 10, 10, 0.006, [], null);
  const withString = calculatePunitoryV2(correctedToday, 7, 2026, 100000, 10, 10, 0.006, [], null);

  assert.strictEqual(withRawDate.days, withString.days);
  assert.strictEqual(withRawDate.amount, withString.amount);
});
