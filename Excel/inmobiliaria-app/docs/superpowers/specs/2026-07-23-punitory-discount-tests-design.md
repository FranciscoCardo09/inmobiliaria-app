# Cobertura de tests: punitorios + descuentos/bonificaciones (caso Godoy)

## Contexto

El 2026-07-23 se encontró y corrigió un bug real en producción (contrato de
Godoy Fernando Alberto, Los Pinos 4031 Torre 2 1B, julio 2026): `computePunitoryBase`
(`backend/src/utils/punitory.js`) y los 5 lugares que la llamaban pre-recortaban
`servicesTotal` con `Math.max(servicesTotal, 0)` antes de comparar lo pagado
contra el total adeudado. Cuando un mes tenía un descuento/bonificación real
(`servicesTotal` negativo, ej. "Cocina cuota 2 de 3": -$123.333) que cubría
parte del alquiler, ese clamp ignoraba el descuento al decidir si quedaba algo
pendiente: el sistema comparaba lo pagado contra el alquiler BRUTO (sin
descuento), veía una diferencia fantasma, y le aplicaba mora en vivo calculada
contra la fecha de HOY (no la fecha real del pago) — el monto fantasma crecía
cada día que el pago tardara en registrarse en el sistema.

El fix (ya commiteado, `0ebc81b`) agrega un chequeo en `computePunitoryBase`:
si lo pagado ya cubre el total NETO (alquiler + servicios con el descuento
aplicado), la base de punitorio es 0. Para pagos genuinamente parciales, la
regla ya confirmada por el usuario el 2026-07-11 (la bonificación no reduce
la TASA de mora) queda intacta.

El proyecto tiene una suite de tests grande (`tests/*.test.js`, node:test +
proxyquire + un fake Prisma en memoria — ver `tests/helpers/fakePrisma.js`) que
ya cubre renovaciones, servicios/propagación, deudas, recibos, IVA, honorarios
y orden cronológico de pagos. Ninguno de esos ~40 archivos existentes prueba
la interacción específica "descuento real que deja el neto totalmente pagado"
contra el cálculo de punitorios — ese fue el hueco que permitió el bug. El
objetivo de este trabajo es cerrar ese hueco con un archivo de test nuevo y
dedicado, sin duplicar la cobertura ya existente.

## Alcance

Un archivo nuevo: `backend/tests/punitoryBaseDescuento.test.js`.

No se tocan los ~40 archivos de test existentes. No se agregan tests de
renovaciones, ajustes de índice, IVA-como-dato, honorarios de propietario, ni
recibos — esas áreas ya están cubiertas y no participan del bug corregido.

Todos los tests son unitarios: proxyquire + `makeFakePrisma()` (in-memory), sin
ninguna base de datos real (ni local ni de test vía Docker).

## Secciones del archivo

### A. `computePunitoryBase` — matriz de casos puros

Función pura, sin mocks. Casos (además de los 5 ya existentes en
`tests/punitory.test.js`, que no se tocan):

1. Descuento parcial (`servicesTotal<0`, cubre parte del alquiler) + pago
   exacto del neto → `base = 0` (regresión directa del caso Godoy).
2. Descuento parcial + pago parcial (menor al neto) → `base` = fórmula vieja
   (alquiler+servicios clamped a 0+IVA − pagado); la bonificación sigue sin
   bajar la tasa mientras algo quede pendiente.
3. Descuento parcial + sobrepago (más que el neto) → `base = 0`.
4. Descuento que EXCEDE el alquiler bruto (neto ≤ 0) + nada pagado → `base =
   rentAmount` (la regla "sin pago, base = solo alquiler" no cambia, no debe
   dar 0 ni negativo solo porque el descuento es grande).
5. Con servicios positivos (sin descuento) + pago exacto del neto → `base = 0`
   (control: confirma que el camino sin descuento sigue funcionando igual).
6. Con IVA + descuento parcial + pago exacto del neto (alquiler+servicios+IVA)
   → `base = 0`.
7. Pago exacto MENOS un centavo (dentro de redondeo pero fuera de la
   tolerancia de $0,01) → `base > 0` (no debe ocultar un pendiente real por el
   margen de tolerancia).
8. Pago exacto MÁS un centavo → `base = 0` (la tolerancia sí debe cubrir
   diferencias de redondeo).

### B. `computeLiveRecordPunitory` — mismo tipo de casos, función de más alto nivel

Confirma que, usando la fecha real de "hoy" como `calculationDate` (default),
un mes con descuento y neto totalmente pagado da `amount: 0, days: 0` sin
importar cuántos días pasaron desde el pago real hasta la fecha de cálculo —
el síntoma exacto que reportó el usuario ("como lo registré tarde"). Casos:
igual matriz que A pero pasando por esta función (que agrega el manejo de
`punitoryForgiven`, `isPostExpiry` y el punitorio congelado del último pago).

### C. Flujo completo: `registerPayment` real + `monthlyRecordService` real

Estos tests conectan `paymentTransactionService.registerPayment` con la
implementación REAL de `monthlyRecordService.recalculateMultipleRecords`
(no stubbeada a no-op, a diferencia del resto de los tests existentes que
solo verifican el valor intermedio capturado) — ambos módulos vía proxyquire
apuntando al MISMO `fakePrisma`, así el registro final queda persistido y se
puede leer con `prisma.monthlyRecord.findUnique(...)` después de cada pago,
igual que se verificó manualmente contra producción para Godoy.

1. **Caso Godoy exacto**: contrato con alquiler + servicios (impuestos) +
   descuento, IVA opcional. Un solo pago que cubre el neto exacto →
   `totalDue = amountPaid`, `balance = 0`, `status = 'COMPLETE'`,
   `punitoryAmount = 0`.
2. **Secuencia de 20 pagos parciales** (el pedido explícito del usuario):
   mismo mes con descuento, dividido en 20 transacciones de montos variados
   (algunas chicas, alguna grande) registradas una tras otra vía
   `registerPayment`. Verificaciones:
   - Después de cada pago intermedio (antes de completar el neto): `status =
     'PARTIAL'`, `amountPaid` = suma acumulada correcta.
   - Después del pago #20 (que completa el neto exacto): `status =
     'COMPLETE'`, `balance = 0`, `punitoryAmount = 0` — converge
     independientemente de en cuántos pedazos se fraccionó el pago.
3. **Variante con sobrepago**: la secuencia de pagos parciales termina
   pasándose del neto en la última cuota → `balance > 0` (saldo a favor),
   sin error ni punitorio fantasma.
4. **Variante SIN descuento** (control): misma mecánica de pagos parciales
   fragmentados, sin ningún servicio de descuento → confirma que el fix no
   alteró el comportamiento del caso normal (mora sí se cobra si el pago
   parcial no alcanza el bruto, como antes).

### D. `debtService.js` — mismo clamp en los otros 2 call-sites

1. `createDebtFromMonthlyRecord`: un `MonthlyRecord` con descuento que deja el
   neto pagado (`amountPaid` cubre alquiler+servicios netos) pero aún no
   `COMPLETE` → el punitorio "catch-up" calculado al crear la Deuda debe dar
   0, no un cargo fantasma sobre el alquiler bruto.
2. `recalculateDebtFromMonthlyRecord`: una Deuda `OPEN` cuyo `MonthlyRecord`
   asociado ya tiene `amountPaid` cubriendo el neto (con descuento) →
   `accumulatedPunitory` recalculado debe dar 0.

## Fuera de alcance

- Tests de integración con Postgres real (Docker) — el usuario pidió
  priorizar unitarios rápidos con Prisma mockeado.
- Cualquier área no tocada por el bug (renovaciones, ajustes de índice, IVA
  como dato de reporte, honorarios de propietario, recibos, orden
  cronológico de pagos) — ya tienen su propia cobertura extensa y no
  comparten código con `computePunitoryBase`.
- Reparación de datos o migraciones — no aplica, es solo cobertura de tests.

## Verificación

- `npm run test:unit` debe pasar completo (270 tests actuales + los nuevos de
  este archivo), sin afectar ningún test existente.
- El archivo nuevo debe fallar (`git stash` del fix en `punitory.js` /
  `paymentTransactionService.js` / `debtService.js`, o revertir el commit
  `0ebc81b` temporalmente) para confirmar que efectivamente habría atrapado
  el bug de Godoy antes de que llegara a producción — luego restaurar el fix
  y confirmar que todo pasa de nuevo.
