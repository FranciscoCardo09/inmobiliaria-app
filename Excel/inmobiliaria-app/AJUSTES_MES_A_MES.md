# Sistema de Ajustes Mes por Mes

## Funcionalidad Implementada

### 1. Navegación Mes por Mes
- Selector de mes con botones Anterior/Siguiente
- Vista del mes actual seleccionado (Mes 1, Mes 2, etc.)
- Contador de contratos con ajuste programado para ese mes
- Carga dinámica de contratos al cambiar de mes

### 2. Aplicar Ajustes por Mes
- Ingreso de porcentaje de ajuste por índice
- Botón "Aplicar" para cada índice
- Modal de confirmación mostrando:
  - Índice y porcentaje
  - Mes objetivo
  - Lista de contratos afectados
  - Comparación: Alquiler Actual → Nuevo Alquiler
  - Total de aumento
- Al aplicar, se crea registro en RentHistory
- Badge "Ajuste Aplicado" para índices ya procesados

### 3. Deshacer Cambios
- Botón "Deshacer" visible solo si hay ajuste aplicado
- Modal de confirmación para deshacer
- Revierte el alquiler al valor anterior
- Elimina el registro del historial
- Restaura nextAdjustmentMonth

## Backend - Nuevos Endpoints

### GET /groups/:groupId/adjustments/contracts-by-month/:targetMonth
Obtiene contratos que ajustan en un mes específico
- Incluye tenant, property, adjustmentIndex
- Incluye rentHistory para ese mes (para detectar ajustes aplicados)

### POST /groups/:groupId/adjustment-indices/:id/apply-to-month
Aplica ajuste a un mes específico
```json
{
  "percentageIncrease": 10,
  "targetMonth": 5
}
```

### POST /groups/:groupId/adjustment-indices/:id/undo-month
Deshace ajuste de un mes específico
```json
{
  "targetMonth": 5
}
```

## Frontend - Componentes Actualizados

### useAdjustmentIndices Hook
- `getContractsForMonth(targetMonth)` - Obtener contratos por mes
- `applyToMonth()` - Aplicar ajuste a mes específico
- `undoMonth()` - Deshacer ajuste de mes específico

### AdjustmentIndexList Component
- Selector mes por mes (ChevronLeft/Right)
- Lista de índices con contratos agrupados
- Inputs de porcentaje por índice
- Botones Aplicar/Deshacer
- Modal de confirmación con preview
- Badge indicador de estado

## Base de Datos

### RentHistory
Ya existe, se utiliza para:
- Guardar cada ajuste con `effectiveFromMonth`
- Detectar si un ajuste ya fue aplicado
- Restaurar valores al deshacer
- Calcular alquileres históricos

## Flujo de Uso

1. Usuario selecciona mes (ej: Mes 5)
2. Sistema muestra índices con contratos que ajustan ese mes
3. Usuario ingresa porcentaje y presiona "Aplicar"
4. Modal muestra preview de cambios
5. Usuario confirma → baseRent actualizado + RentHistory creado
6. Badge "Ajuste Aplicado" aparece
7. Si se equivoca → "Deshacer" revierte cambios
