# Sistema de Historial de Alquileres

## Problema Original

Cuando se aplicaba un ajuste de alquiler para el próximo mes, se actualizaba inmediatamente el `baseRent` del contrato. Esto causaba que:

1. Los monthly records del mes actual que se regeneraban usaban el nuevo `baseRent` ajustado
2. El ajuste se aplicaba un mes antes de lo debido
3. Con múltiples ajustes con diferentes porcentajes, era imposible calcular correctamente el alquiler de meses anteriores

## Solución: Tabla `rent_history`

Se creó una nueva tabla que almacena el historial completo de cambios de alquiler para cada contrato.

### Modelo de Datos

```prisma
model RentHistory {
  id                  String   @id @default(uuid())
  contractId          String
  effectiveFromMonth  Int      // Mes del contrato desde el cual aplica
  rentAmount          Float    // Monto del alquiler en este período
  adjustmentPercent   Float?   // % de ajuste aplicado (opcional)
  reason              String?  // "AJUSTE_AUTOMATICO", "AJUSTE_MANUAL", "INICIAL"
  appliedAt           DateTime
  createdAt           DateTime
}
```

### Cómo Funciona

#### 1. Al crear un contrato nuevo
- Se crea automáticamente un registro inicial:
  ```javascript
  {
    effectiveFromMonth: startMonth,
    rentAmount: baseRent,
    reason: 'INICIAL'
  }
  ```

#### 2. Al aplicar un ajuste
- Se guarda un nuevo registro en el historial:
  ```javascript
  {
    effectiveFromMonth: currentMonth + 1, // Próximo mes
    rentAmount: newRent,
    adjustmentPercent: 3.5,
    reason: 'AJUSTE_AUTOMATICO'
  }
  ```

#### 3. Al calcular el rent de un mes
- La función `calculateRentForMonth(contract, monthNumber)` busca en el historial:
  ```sql
  SELECT * FROM rent_history 
  WHERE contractId = ? 
    AND effectiveFromMonth <= ?
  ORDER BY effectiveFromMonth DESC
  LIMIT 1
  ```

### Ejemplos

#### Ejemplo 1: Contrato con múltiples ajustes

```
Mes 1:  $100,000 (inicial)
Mes 4:  $103,000 (ajuste 3%)
Mes 7:  $108,150 (ajuste 5%)
Mes 10: $111,394 (ajuste 3%)
```

**Historial:**
```
| effectiveFromMonth | rentAmount | adjustmentPercent | reason            |
|--------------------|------------|-------------------|-------------------|
| 1                  | 100000     | null              | INICIAL           |
| 4                  | 103000     | 3.0               | AJUSTE_AUTOMATICO |
| 7                  | 108150     | 5.0               | AJUSTE_AUTOMATICO |
| 10                 | 111394     | 3.0               | AJUSTE_AUTOMATICO |
```

**Consultas:**
- `calculateRentForMonth(contract, 3)` → $100,000 ✅
- `calculateRentForMonth(contract, 5)` → $103,000 ✅
- `calculateRentForMonth(contract, 8)` → $108,150 ✅
- `calculateRentForMonth(contract, 12)` → $111,394 ✅

#### Ejemplo 2: Ajuste programado para próximo mes

**Situación:**
- Mes actual del contrato: 5
- Alquiler actual: $150,000
- Se aplica ajuste del 4% para el mes 6
- `baseRent` se actualiza a $156,000
- `nextAdjustmentMonth` = 6

**Historial después del ajuste:**
```
| effectiveFromMonth | rentAmount | adjustmentPercent | reason            |
|--------------------|------------|-------------------|-------------------|
| 1                  | 150000     | null              | INICIAL           |
| 6                  | 156000     | 4.0               | AJUSTE_AUTOMATICO |
```

**Consultas:**
- `calculateRentForMonth(contract, 5)` → $150,000 ✅ (usa el registro del mes 1)
- `calculateRentForMonth(contract, 6)` → $156,000 ✅ (usa el registro del mes 6)
- `calculateRentForMonth(contract, 7)` → $156,000 ✅ (usa el registro del mes 6)

## API

### Obtener historial de un contrato

```http
GET /api/groups/:groupId/contracts/:id/rent-history
```

**Respuesta:**
```json
[
  {
    "id": "uuid",
    "contractId": "uuid",
    "effectiveFromMonth": 1,
    "rentAmount": 150000,
    "adjustmentPercent": null,
    "reason": "INICIAL",
    "appliedAt": "2025-12-01T00:00:00Z",
    "createdAt": "2025-12-01T00:00:00Z"
  },
  {
    "id": "uuid",
    "contractId": "uuid",
    "effectiveFromMonth": 4,
    "rentAmount": 156000,
    "adjustmentPercent": 4.0,
    "reason": "AJUSTE_AUTOMATICO",
    "appliedAt": "2026-02-01T00:00:00Z",
    "createdAt": "2026-02-01T00:00:00Z"
  }
]
```

## Migración de Datos Existentes

Se ejecutó el script `scripts/migrate-rent-history.js` que:

1. Busca todos los contratos existentes
2. Crea un registro inicial para cada uno con:
   - `effectiveFromMonth`: startMonth del contrato
   - `rentAmount`: baseRent actual
   - `reason`: 'INICIAL'

**Resultado de la migración:**
```
✅ 5 contratos migrados exitosamente
```

## Ventajas del Nuevo Sistema

✅ **Historial completo**: Puedes ver todos los cambios de alquiler de un contrato
✅ **Cálculo preciso**: El rent se calcula correctamente para cualquier mes, incluso con múltiples ajustes
✅ **Auditable**: Cada cambio queda registrado con fecha, porcentaje y motivo
✅ **Flexible**: Permite ajustes manuales, automáticos, o cualquier otro tipo
✅ **No rompe nada**: Los contratos existentes siguen funcionando normalmente

## Archivos Modificados

1. **prisma/schema.prisma** - Nuevo modelo `RentHistory`
2. **services/monthlyRecordService.js** - `calculateRentForMonth()` usa el historial
3. **services/adjustmentService.js** - `applyAdjustmentToNextMonthContracts()` guarda en historial
4. **controllers/contractsController.js** - `createContract()` crea registro inicial
5. **routes/contracts.routes.js** - Nueva ruta `/rent-history`
6. **scripts/migrate-rent-history.js** - Script de migración de datos existentes
