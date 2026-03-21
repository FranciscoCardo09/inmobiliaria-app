# Multi-Property Service Loading - Design Document

**Date:** 2026-02-25
**Status:** Approved

## Problem

Currently, loading a service charge (e.g., a utility bill) to multiple properties requires repeating the process for each property individually. When a single bill covers multiple properties (e.g., two units in the same building), the user must manually calculate each unit's share and enter it separately.

## Requirements

1. **Multi-property service loading**: Select multiple properties, enter a total amount, distribute automatically.
2. **Percentage distribution with smart auto-complete**: Editable percentages per property that always sum to 100%.
3. **Predefined property groups**: Save property+percentage combinations for reuse.

## Design Decisions

- **Independent MonthlyService records**: Each property gets its own MonthlyService with its proportional amount. No changes to existing models.
- **Dedicated modal**: New "Cargar Servicio" button above the table opens a modal. Existing inline ServiceManager unchanged.
- **Groups managed within modal**: Create/load/edit groups inline without navigating away.
- **Current month only**: Applies to the month visible on screen.

## Data Model

### New: `PropertyGroup`

| Field | Type | Description |
|-------|------|-------------|
| id | String (cuid) | PK |
| groupId | String | FK → Group (tenant) |
| name | String | Display name (e.g., "Edificio Don Bosco") |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### New: `PropertyGroupItem`

| Field | Type | Description |
|-------|------|-------------|
| id | String (cuid) | PK |
| propertyGroupId | String | FK → PropertyGroup |
| contractId | String | FK → Contract |
| percentage | Float | Percentage of total (0-100) |

Unique constraint: `(propertyGroupId, contractId)`

## API Endpoints

### Batch Service Creation

`POST /api/groups/:gid/monthly-records/batch-services`

```json
{
  "conceptTypeId": "...",
  "totalAmount": 100000,
  "description": "Gas febrero",
  "distributions": [
    { "recordId": "rec1", "percentage": 50, "amount": 50000 },
    { "recordId": "rec2", "percentage": 50, "amount": 50000 }
  ]
}
```

Creates N MonthlyService records in a transaction, then recalculates each MonthlyRecord.

### Property Groups CRUD

- `GET /api/groups/:gid/property-groups` — list all groups with items
- `POST /api/groups/:gid/property-groups` — create group with items
- `PUT /api/groups/:gid/property-groups/:id` — update name/items
- `DELETE /api/groups/:gid/property-groups/:id` — delete group

## Frontend: Modal Flow

### Step 1 — Selection
- Dropdown of saved property groups (if any) with "Usar grupo" button
- Manual selection: checkboxes for all properties in current month
- Loading a group pre-fills properties and percentages

### Step 2 — Distribution
- ConceptType select + total amount input
- Editable table: Property | % | Calculated Amount
- Auto-distribution logic (see below)
- "Guardar como grupo" button to save current selection

### Step 3 — Confirmation
- Summary table with final distribution
- "Confirmar" button → calls batch endpoint

## Percentage Auto-Distribution Algorithm

```
State: Map<recordId, { percentage: number, locked: boolean }>
locked = true when user manually edited that percentage

On percentage change:
  1. Mark as locked
  2. remainingPct = 100 - sum(all locked percentages)
  3. If remainingPct < 0: reject the change
  4. Distribute remainingPct equally among unlocked items

On add/remove property:
  Reset all locks, distribute equally
```

## What Does NOT Change

- `ServiceManagerInline` — individual service loading stays as-is
- `MonthlyService` / `MonthlyRecord` models — unchanged
- `recalculateMonthlyRecord()` — reused for each affected record
