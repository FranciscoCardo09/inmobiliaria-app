# Multi-Property Service Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow loading a service charge across multiple properties at once with percentage-based distribution, and save property groups for reuse.

**Architecture:** New Prisma models (PropertyGroup, PropertyGroupItem) for saved groups. New batch-services endpoint creates multiple MonthlyService records in a transaction. New frontend modal with 3-step wizard (select → distribute → confirm). Existing individual service loading untouched.

**Tech Stack:** Prisma + Express (backend), React + TanStack Query + DaisyUI (frontend)

---

### Task 1: Add Prisma Models

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Step 1: Add PropertyGroup and PropertyGroupItem models**

Add at the end of schema.prisma, before the closing:

```prisma
model PropertyGroup {
  id        String   @id @default(cuid())
  groupId   String   @map("group_id")
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  group Group    @relation(fields: [groupId], references: [id])
  items PropertyGroupItem[]

  @@map("property_groups")
}

model PropertyGroupItem {
  id              String  @id @default(cuid())
  propertyGroupId String  @map("property_group_id")
  contractId      String  @map("contract_id")
  percentage      Float

  propertyGroup PropertyGroup @relation(fields: [propertyGroupId], references: [id], onDelete: Cascade)
  contract      Contract      @relation(fields: [contractId], references: [id])

  @@unique([propertyGroupId, contractId])
  @@map("property_group_items")
}
```

**Step 2: Add relations to Group and Contract models**

In `model Group`, add to Relations section:
```prisma
  propertyGroups        PropertyGroup[]
```

In `model Contract`, add to Relations section:
```prisma
  propertyGroupItems    PropertyGroupItem[]
```

**Step 3: Run migration**

```bash
cd inmobiliaria-app/backend
npx prisma db push
npx prisma generate
```

**Step 4: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: add PropertyGroup and PropertyGroupItem models"
```

---

### Task 2: Backend - Property Groups CRUD Service + Routes

**Files:**
- Create: `backend/src/services/propertyGroupService.js`
- Create: `backend/src/controllers/propertyGroupController.js`
- Create: `backend/src/routes/propertyGroups.routes.js`
- Modify: `backend/src/routes/index.js`

**Step 1: Create property group service**

Create `backend/src/services/propertyGroupService.js`:

```js
const prisma = require('../lib/prisma');

const list = async (groupId) => {
  return prisma.propertyGroup.findMany({
    where: { groupId },
    include: {
      items: {
        include: {
          contract: {
            include: {
              property: { select: { id: true, address: true, unit: true } },
              tenant: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
};

const create = async (groupId, name, items) => {
  return prisma.propertyGroup.create({
    data: {
      groupId,
      name,
      items: {
        create: items.map(({ contractId, percentage }) => ({
          contractId,
          percentage,
        })),
      },
    },
    include: { items: true },
  });
};

const update = async (id, groupId, name, items) => {
  return prisma.$transaction(async (tx) => {
    await tx.propertyGroupItem.deleteMany({ where: { propertyGroupId: id } });
    return tx.propertyGroup.update({
      where: { id, groupId },
      data: {
        name,
        items: {
          create: items.map(({ contractId, percentage }) => ({
            contractId,
            percentage,
          })),
        },
      },
      include: { items: true },
    });
  });
};

const remove = async (id, groupId) => {
  return prisma.propertyGroup.delete({ where: { id, groupId } });
};

module.exports = { list, create, update, remove };
```

**Step 2: Create controller**

Create `backend/src/controllers/propertyGroupController.js`:

```js
const ApiResponse = require('../utils/apiResponse');
const propertyGroupService = require('../services/propertyGroupService');

const list = async (req, res, next) => {
  try {
    const groups = await propertyGroupService.list(req.params.groupId);
    return ApiResponse.success(res, groups);
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const { name, items } = req.body;
    if (!name || !items?.length) {
      return ApiResponse.badRequest(res, 'name e items son requeridos');
    }
    const pctSum = items.reduce((s, i) => s + i.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      return ApiResponse.badRequest(res, 'Los porcentajes deben sumar 100%');
    }
    const group = await propertyGroupService.create(req.params.groupId, name, items);
    return ApiResponse.created(res, group);
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const { name, items } = req.body;
    if (!name || !items?.length) {
      return ApiResponse.badRequest(res, 'name e items son requeridos');
    }
    const pctSum = items.reduce((s, i) => s + i.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      return ApiResponse.badRequest(res, 'Los porcentajes deben sumar 100%');
    }
    const group = await propertyGroupService.update(req.params.id, req.params.groupId, name, items);
    return ApiResponse.success(res, group);
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    await propertyGroupService.remove(req.params.id, req.params.groupId);
    return ApiResponse.success(res, null, 'Grupo eliminado');
  } catch (error) {
    next(error);
  }
};

module.exports = { list, create, update, remove };
```

**Step 3: Create routes**

Create `backend/src/routes/propertyGroups.routes.js`:

```js
const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/propertyGroupController');
const { authenticate } = require('../middleware/auth');
const { requireGroupAccess } = require('../middleware/groupAuth');

router.use(authenticate);

router.get('/', requireGroupAccess(['ADMIN', 'OPERATOR', 'VIEWER']), controller.list);
router.post('/', requireGroupAccess(['ADMIN', 'OPERATOR']), controller.create);
router.put('/:id', requireGroupAccess(['ADMIN', 'OPERATOR']), controller.update);
router.delete('/:id', requireGroupAccess(['ADMIN']), controller.remove);

module.exports = router;
```

**Step 4: Register routes in index.js**

In `backend/src/routes/index.js`, add import after line 24:
```js
const propertyGroupsRoutes = require('./propertyGroups.routes');
```

Add mount after line 85 (monthly-records line):
```js
router.use('/groups/:groupId/property-groups', propertyGroupsRoutes);
```

**Step 5: Commit**

```bash
git add backend/src/services/propertyGroupService.js backend/src/controllers/propertyGroupController.js backend/src/routes/propertyGroups.routes.js backend/src/routes/index.js
git commit -m "feat: add property groups CRUD backend"
```

---

### Task 3: Backend - Batch Services Endpoint

**Files:**
- Modify: `backend/src/services/monthlyServiceService.js`
- Modify: `backend/src/controllers/monthlyRecordsController.js`
- Modify: `backend/src/routes/monthlyRecords.routes.js`

**Step 1: Add batchAddServices to monthlyServiceService.js**

Add before the `module.exports`:

```js
/**
 * Add the same service type to multiple monthly records with different amounts.
 * Used for distributing a total amount across multiple properties.
 */
const batchAddServices = async (distributions, conceptTypeId, description = null) => {
  const results = [];

  await prisma.$transaction(async (tx) => {
    for (const { recordId, amount } of distributions) {
      const service = await tx.monthlyService.create({
        data: {
          monthlyRecordId: recordId,
          conceptTypeId,
          amount,
          description,
        },
        include: {
          conceptType: { select: { id: true, name: true, label: true, category: true } },
        },
      });
      results.push(service);
    }
  });

  // Recalculate all affected records outside the transaction
  for (const { recordId } of distributions) {
    await recalculateMonthlyRecord(recordId);
  }

  return results;
};
```

Add `batchAddServices` to the `module.exports`.

**Step 2: Add controller method**

In `monthlyRecordsController.js`, add:

```js
// POST /api/groups/:groupId/monthly-records/batch-services
const batchAddServices = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { conceptTypeId, totalAmount, description, distributions } = req.body;

    if (!conceptTypeId || !totalAmount || !distributions?.length) {
      return ApiResponse.badRequest(res, 'conceptTypeId, totalAmount y distributions son requeridos');
    }

    // Validate all records belong to this group
    const recordIds = distributions.map((d) => d.recordId);
    const records = await prisma.monthlyRecord.findMany({
      where: { id: { in: recordIds }, groupId },
    });
    if (records.length !== recordIds.length) {
      return ApiResponse.badRequest(res, 'Algunos registros no pertenecen a este grupo');
    }

    // Validate amounts sum matches total
    const amountSum = distributions.reduce((s, d) => s + d.amount, 0);
    if (Math.abs(amountSum - totalAmount) > 1) {
      return ApiResponse.badRequest(res, 'La suma de montos no coincide con el total');
    }

    const { batchAddServices: batchAdd } = require('../services/monthlyServiceService');
    const results = await batchAdd(distributions, conceptTypeId, description);
    return ApiResponse.success(res, results, 'Servicios asignados correctamente');
  } catch (error) {
    if (error.code === 'P2002') {
      return ApiResponse.conflict(res, 'Alguna propiedad ya tiene ese servicio asignado este mes');
    }
    next(error);
  }
};
```

Add `batchAddServices` to the module.exports of the controller.

**Step 3: Add route**

In `monthlyRecords.routes.js`, add after the `/generate` route (line 33):

```js
router.post(
  '/batch-services',
  requireGroupAccess(['ADMIN', 'OPERATOR']),
  controller.batchAddServices
);
```

**Step 4: Commit**

```bash
git add backend/src/services/monthlyServiceService.js backend/src/controllers/monthlyRecordsController.js backend/src/routes/monthlyRecords.routes.js
git commit -m "feat: add batch service creation endpoint"
```

---

### Task 4: Frontend - Property Groups Hook

**Files:**
- Create: `frontend/src/hooks/usePropertyGroups.js`

**Step 1: Create the hook**

```js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../services/api'

export const usePropertyGroups = (groupId) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['propertyGroups', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/property-groups`)
      return res.data.data
    },
    enabled: !!groupId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['propertyGroups'] })
  }

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.post(`/groups/${groupId}/property-groups`, data)
      return res.data.data
    },
    onSuccess: () => { invalidate(); toast.success('Grupo creado') },
    onError: (e) => toast.error(e.response?.data?.message || 'Error al crear grupo'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const res = await api.put(`/groups/${groupId}/property-groups/${id}`, data)
      return res.data.data
    },
    onSuccess: () => { invalidate(); toast.success('Grupo actualizado') },
    onError: (e) => toast.error(e.response?.data?.message || 'Error al actualizar grupo'),
  })

  const removeMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/groups/${groupId}/property-groups/${id}`)
    },
    onSuccess: () => { invalidate(); toast.success('Grupo eliminado') },
    onError: (e) => toast.error(e.response?.data?.message || 'Error al eliminar grupo'),
  })

  return {
    groups: query.data || [],
    isLoading: query.isLoading,
    createGroup: createMutation.mutateAsync,
    updateGroup: updateMutation.mutateAsync,
    removeGroup: removeMutation.mutateAsync,
    isCreating: createMutation.isPending,
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/usePropertyGroups.js
git commit -m "feat: add usePropertyGroups hook"
```

---

### Task 5: Frontend - Batch Services Modal Component

**Files:**
- Create: `frontend/src/pages/monthly-control/BatchServiceModal.jsx`

**Step 1: Create the modal component**

This is the main UI component. It implements a 3-step wizard:

1. **Selection step**: Choose properties (checkboxes from current month's records) or load a saved group
2. **Distribution step**: Pick ConceptType, enter total amount, edit percentages per property
3. **Confirmation step**: Review and submit

Key behaviors:
- Percentage auto-distribution: when a user edits one percentage, remaining unlocked properties share the rest equally
- "Guardar como grupo" button saves current selection + percentages
- Group management (load/delete) inline

```jsx
import { useState, useMemo, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../services/api'
import { usePropertyGroups } from '../../hooks/usePropertyGroups'
import {
  XMarkIcon,
  TrashIcon,
  FolderIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function BatchServiceModal({ groupId, records, periodMonth, periodYear, onClose }) {
  const queryClient = useQueryClient()
  const { groups: savedGroups, createGroup, removeGroup, isLoading: groupsLoading } = usePropertyGroups(groupId)
  const [step, setStep] = useState(1)

  // Step 1 state
  const [selectedRecordIds, setSelectedRecordIds] = useState(new Set())

  // Step 2 state
  const [conceptTypeId, setConceptTypeId] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [description, setDescription] = useState('')
  const [distributions, setDistributions] = useState({}) // { recordId: { percentage, locked } }
  const [savingGroup, setSavingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')

  // Fetch concept types
  const { data: conceptTypes = [] } = useQuery({
    queryKey: ['conceptTypes', groupId],
    queryFn: async () => {
      const res = await api.get(`/groups/${groupId}/payments/concept-types`)
      return res.data.data.filter((ct) => ct.isActive)
    },
    enabled: !!groupId,
  })

  const selectedRecords = useMemo(
    () => records.filter((r) => selectedRecordIds.has(r.id)),
    [records, selectedRecordIds]
  )

  // Toggle property selection
  const toggleRecord = (recordId) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  // Load a saved group - match by contractId to current records
  const loadGroup = (group) => {
    const newSelected = new Set()
    const newDist = {}
    for (const item of group.items) {
      const record = records.find((r) => r.contractId === item.contractId)
      if (record) {
        newSelected.add(record.id)
        newDist[record.id] = { percentage: item.percentage, locked: true }
      }
    }
    setSelectedRecordIds(newSelected)
    setDistributions(newDist)
    if (newSelected.size > 0) setStep(2)
  }

  // Initialize distributions when moving to step 2
  const goToStep2 = () => {
    const count = selectedRecordIds.size
    if (count === 0) return
    const equalPct = Math.round((100 / count) * 100) / 100
    const newDist = {}
    let i = 0
    for (const id of selectedRecordIds) {
      // Last one gets the remainder to ensure sum = 100
      if (i === count - 1) {
        const usedPct = Object.values(newDist).reduce((s, d) => s + d.percentage, 0)
        newDist[id] = { percentage: Math.round((100 - usedPct) * 100) / 100, locked: false }
      } else {
        newDist[id] = { percentage: equalPct, locked: false }
      }
      i++
    }
    // Keep previously set distributions if they came from a loaded group
    for (const id of selectedRecordIds) {
      if (distributions[id]) {
        newDist[id] = distributions[id]
      }
    }
    setDistributions(newDist)
    setStep(2)
  }

  // Percentage change handler with auto-redistribution
  const handlePercentageChange = useCallback((recordId, newPct) => {
    setDistributions((prev) => {
      const updated = { ...prev }
      newPct = Math.max(0, Math.min(100, newPct))
      updated[recordId] = { percentage: newPct, locked: true }

      // Calculate remaining for unlocked
      const lockedSum = Object.entries(updated)
        .filter(([id, d]) => d.locked && id !== recordId)
        .reduce((s, [, d]) => s + d.percentage, 0) + newPct

      if (lockedSum > 100) {
        // Reject: revert
        return prev
      }

      const remaining = 100 - lockedSum
      const unlockedIds = Object.keys(updated).filter(
        (id) => !updated[id].locked
      )

      if (unlockedIds.length > 0) {
        const each = Math.round((remaining / unlockedIds.length) * 100) / 100
        unlockedIds.forEach((id, i) => {
          if (i === unlockedIds.length - 1) {
            const usedUnlocked = each * (unlockedIds.length - 1)
            updated[id] = { percentage: Math.round((remaining - usedUnlocked) * 100) / 100, locked: false }
          } else {
            updated[id] = { percentage: each, locked: false }
          }
        })
      }

      return updated
    })
  }, [])

  // Reset lock on a percentage
  const unlockPercentage = (recordId) => {
    setDistributions((prev) => ({
      ...prev,
      [recordId]: { ...prev[recordId], locked: false },
    }))
  }

  // Compute amounts
  const computedDistributions = useMemo(() => {
    const total = parseFloat(totalAmount) || 0
    return Object.entries(distributions).map(([recordId, { percentage, locked }]) => ({
      recordId,
      percentage,
      locked,
      amount: Math.round((total * percentage) / 100),
      record: records.find((r) => r.id === recordId),
    }))
  }, [distributions, totalAmount, records])

  const totalDistributed = computedDistributions.reduce((s, d) => s + d.amount, 0)

  // Save as group
  const handleSaveGroup = async () => {
    if (!groupName.trim()) return
    const items = computedDistributions.map((d) => ({
      contractId: d.record.contractId,
      percentage: d.percentage,
    }))
    await createGroup({ name: groupName.trim(), items })
    setSavingGroup(false)
    setGroupName('')
  }

  // Submit batch
  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/groups/${groupId}/monthly-records/batch-services`, {
        conceptTypeId,
        totalAmount: parseFloat(totalAmount),
        description: description || undefined,
        distributions: computedDistributions.map((d) => ({
          recordId: d.recordId,
          percentage: d.percentage,
          amount: d.amount,
        })),
      })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyServices'] })
      queryClient.invalidateQueries({ queryKey: ['monthlyRecords'] })
      toast.success('Servicios asignados correctamente')
      onClose()
    },
    onError: (e) => {
      toast.error(e.response?.data?.message || 'Error al asignar servicios')
    },
  })

  const selectedConceptType = conceptTypes.find((ct) => ct.id === conceptTypeId)
  const canSubmit = conceptTypeId && parseFloat(totalAmount) > 0 && computedDistributions.length > 0

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">
            Cargar Servicio Múltiple
          </h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Steps indicator */}
        <ul className="steps steps-horizontal w-full mb-6">
          <li className={`step ${step >= 1 ? 'step-primary' : ''}`}>Selección</li>
          <li className={`step ${step >= 2 ? 'step-primary' : ''}`}>Distribución</li>
          <li className={`step ${step >= 3 ? 'step-primary' : ''}`}>Confirmación</li>
        </ul>

        {/* STEP 1: Selection */}
        {step === 1 && (
          <div>
            {/* Saved groups */}
            {savedGroups.length > 0 && (
              <div className="mb-4">
                <label className="label"><span className="label-text font-semibold">Grupos guardados</span></label>
                <div className="flex flex-wrap gap-2">
                  {savedGroups.map((g) => (
                    <div key={g.id} className="flex items-center gap-1">
                      <button
                        className="btn btn-sm btn-outline gap-1"
                        onClick={() => loadGroup(g)}
                      >
                        <FolderIcon className="w-4 h-4" />
                        {g.name} ({g.items.length})
                      </button>
                      <button
                        className="btn btn-ghost btn-xs btn-circle"
                        onClick={() => removeGroup(g.id)}
                        title="Eliminar grupo"
                      >
                        <TrashIcon className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Property list */}
            <label className="label"><span className="label-text font-semibold">Seleccionar propiedades</span></label>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              {records.map((record) => (
                <label
                  key={record.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-base-200 border-b last:border-b-0 ${
                    selectedRecordIds.has(record.id) ? 'bg-primary/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary"
                    checked={selectedRecordIds.has(record.id)}
                    onChange={() => toggleRecord(record.id)}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">
                      {record.contract?.property?.address}
                      {record.contract?.property?.unit ? ` - ${record.contract.property.unit}` : ''}
                    </div>
                    <div className="text-xs text-base-content/60">
                      {record.contract?.tenant?.firstName} {record.contract?.tenant?.lastName}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button
                className="btn btn-primary"
                disabled={selectedRecordIds.size < 2}
                onClick={goToStep2}
              >
                Siguiente ({selectedRecordIds.size} seleccionadas)
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Distribution */}
        {step === 2 && (
          <div>
            {/* Service type + amount */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label"><span className="label-text">Tipo de servicio</span></label>
                <select
                  className="select select-bordered w-full select-sm"
                  value={conceptTypeId}
                  onChange={(e) => setConceptTypeId(e.target.value)}
                >
                  <option value="">Seleccionar...</option>
                  {conceptTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.label} ({ct.category})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label"><span className="label-text">Monto total</span></label>
                <input
                  type="number"
                  className="input input-bordered w-full input-sm"
                  placeholder="100000"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  min="0"
                  step="1"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="label"><span className="label-text">Descripción (opcional)</span></label>
              <input
                type="text"
                className="input input-bordered w-full input-sm"
                placeholder="Ej: Gas febrero"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Distribution table */}
            <label className="label"><span className="label-text font-semibold">Distribución</span></label>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Propiedad</th>
                    <th className="w-28">%</th>
                    <th className="w-32 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {computedDistributions.map((d) => (
                    <tr key={d.recordId}>
                      <td>
                        <div className="text-sm font-medium">
                          {d.record?.contract?.property?.address}
                          {d.record?.contract?.property?.unit ? ` - ${d.record.contract.property.unit}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className={`input input-bordered input-xs w-20 ${d.locked ? 'input-primary' : ''}`}
                            value={d.percentage}
                            onChange={(e) => handlePercentageChange(d.recordId, parseFloat(e.target.value) || 0)}
                            min="0"
                            max="100"
                            step="0.01"
                          />
                          {d.locked && (
                            <button
                              className="btn btn-ghost btn-xs btn-circle"
                              onClick={() => unlockPercentage(d.recordId)}
                              title="Desbloquear para auto-ajuste"
                            >
                              🔓
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="text-right font-mono">{formatCurrency(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td>Total</td>
                    <td>{computedDistributions.reduce((s, d) => s + d.percentage, 0).toFixed(2)}%</td>
                    <td className="text-right font-mono">{formatCurrency(totalDistributed)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Save as group */}
            <div className="mt-3">
              {!savingGroup ? (
                <button className="btn btn-ghost btn-sm gap-1" onClick={() => setSavingGroup(true)}>
                  <PlusIcon className="w-4 h-4" /> Guardar como grupo
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1"
                    placeholder="Nombre del grupo..."
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveGroup} disabled={!groupName.trim()}>
                    Guardar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSavingGroup(false)}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>Atrás</button>
              <button className="btn btn-primary" disabled={!canSubmit} onClick={() => setStep(3)}>
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Confirmation */}
        {step === 3 && (
          <div>
            <div className="alert mb-4">
              <div>
                <div className="font-bold">{selectedConceptType?.label}</div>
                <div className="text-sm">Total: {formatCurrency(parseFloat(totalAmount))}</div>
                {description && <div className="text-sm text-base-content/60">{description}</div>}
              </div>
            </div>

            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Propiedad</th>
                  <th className="text-right">%</th>
                  <th className="text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {computedDistributions.map((d) => (
                  <tr key={d.recordId}>
                    <td>
                      {d.record?.contract?.property?.address}
                      {d.record?.contract?.property?.unit ? ` - ${d.record.contract.property.unit}` : ''}
                    </td>
                    <td className="text-right">{d.percentage}%</td>
                    <td className="text-right font-mono">{formatCurrency(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td>Total</td>
                  <td></td>
                  <td className="text-right font-mono">{formatCurrency(totalDistributed)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setStep(2)}>Atrás</button>
              <button
                className="btn btn-primary"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  'Confirmar'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/monthly-control/BatchServiceModal.jsx
git commit -m "feat: add BatchServiceModal component"
```

---

### Task 6: Frontend - Integrate Modal into MonthlyControlPage

**Files:**
- Modify: `frontend/src/pages/monthly-control/MonthlyControlPage.jsx`

**Step 1: Add import and state**

At the top imports, add:
```js
import BatchServiceModal from './BatchServiceModal'
```

Inside `MonthlyControlPage()`, add state variable near the other modal states:
```js
const [showBatchService, setShowBatchService] = useState(false)
```

**Step 2: Add button in the Actions area**

In the `{/* Actions */}` section (around line 200), before the Close Month button, add:
```jsx
<button
  className="btn btn-sm btn-primary gap-1"
  onClick={() => setShowBatchService(true)}
  title="Cargar servicio a múltiples propiedades"
>
  <WrenchScrewdriverIcon className="w-4 h-4" />
  Cargar Servicio
</button>
```

**Step 3: Render the modal**

At the bottom of the component JSX, before the closing fragment or final `</div>`, add:
```jsx
{showBatchService && (
  <BatchServiceModal
    groupId={currentGroupId}
    records={allRecords}
    periodMonth={periodMonth}
    periodYear={periodYear}
    onClose={() => setShowBatchService(false)}
  />
)}
```

Note: `allRecords` is the unfiltered records array. Check if this variable exists; it may be called `records` from the hook. Use whichever holds the full (unfiltered) list for the current month.

**Step 4: Commit**

```bash
git add frontend/src/pages/monthly-control/MonthlyControlPage.jsx
git commit -m "feat: integrate batch service modal into monthly control page"
```

---

### Task 7: Manual Testing & Polish

**Step 1: Start dev servers**

```bash
cd inmobiliaria-app/backend && npm run dev &
cd inmobiliaria-app/frontend && npm run dev &
```

**Step 2: Test the full flow**

1. Open Monthly Control page
2. Click "Cargar Servicio" button → modal opens
3. Select 2+ properties → click Siguiente
4. Select a ConceptType, enter total amount
5. Verify percentages auto-distribute equally
6. Edit one percentage → verify others redistribute
7. Click "Guardar como grupo" → enter name → save
8. Click Siguiente → review → Confirmar
9. Verify services appear on each property's row with correct amounts
10. Re-open modal → verify saved group appears and loads correctly
11. Test deleting a saved group

**Step 3: Test edge cases**

- Select only 1 property (button should be disabled, requires 2+)
- Enter 0 as total amount (should not allow submission)
- Try to set percentage > 100 on one property (should be rejected)
- Try assigning a service type that already exists on a property (should show conflict error)

**Step 4: Run frontend lint**

```bash
cd inmobiliaria-app/frontend && npm run lint
```

Fix any lint issues found.

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix: lint and polish for batch service feature"
```
