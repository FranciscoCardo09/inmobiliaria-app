// Service Type List - CRUD for service/extra types with dynamic categories
import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useConceptTypes } from '../../hooks/usePayments'
import { useServiceCategories } from '../../hooks/useServiceCategories'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import {
  WrenchScrewdriverIcon,
  PlusIcon,
  TrashIcon,
  SparklesIcon,
  PencilIcon,
  TagIcon,
  XMarkIcon,
  CheckIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'

// Fallback colors for categories without dynamic data
const fallbackColors = {
  IMPUESTO: 'badge-error',
  SERVICIO: 'badge-info',
  GASTO: 'badge-warning',
  MANTENIMIENTO: 'badge-accent',
  DESCUENTO: 'badge-success',
  OTROS: 'badge-ghost',
}

const BADGE_COLOR_OPTIONS = [
  { value: 'badge-error', label: 'Rojo', preview: 'bg-error' },
  { value: 'badge-info', label: 'Azul', preview: 'bg-info' },
  { value: 'badge-warning', label: 'Naranja', preview: 'bg-warning' },
  { value: 'badge-success', label: 'Verde', preview: 'bg-success' },
  { value: 'badge-accent', label: 'Acento', preview: 'bg-accent' },
  { value: 'badge-primary', label: 'Primario', preview: 'bg-primary' },
  { value: 'badge-secondary', label: 'Secundario', preview: 'bg-secondary' },
  { value: 'badge-ghost', label: 'Gris', preview: 'bg-base-300' },
]

export default function ServiceTypeList() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const {
    conceptTypes,
    isLoading,
    createConceptType,
    updateConceptType,
    seedDefaults,
    deleteConceptType,
    isCreating,
  } = useConceptTypes(currentGroupId)

  const {
    serviceCategories,
    isLoading: isLoadingCategories,
    createServiceCategory,
    deleteServiceCategory,
    seedDefaults: seedCategoryDefaults,
    isCreating: isCreatingCategory,
    isDeleting: isDeletingCategory,
  } = useServiceCategories(currentGroupId)

  // Build lookup from dynamic categories
  const categoryMap = {}
  serviceCategories.forEach((sc) => {
    categoryMap[sc.name] = { label: sc.label, color: sc.color, id: sc.id, isDefault: sc.isDefault }
  })

  const getCategoryLabel = (name) => categoryMap[name]?.label || name
  const getCategoryColor = (name) => categoryMap[name]?.color || fallbackColors[name] || 'badge-ghost'

  // --- Service Type Form ---
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', label: '', category: 'SERVICIO', description: '' })

  // --- Edit mode ---
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ label: '', category: '', description: '' })

  // --- Category management ---
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [catForm, setCatForm] = useState({ name: '', label: '', color: 'badge-ghost' })
  const [activeTab, setActiveTab] = useState('types') // 'types' | 'categories'

  const handleCreate = () => {
    if (!form.name || !form.label) return
    createConceptType(form)
    setForm({ name: '', label: '', category: 'SERVICIO', description: '' })
    setShowForm(false)
  }

  const handleStartEdit = (ct) => {
    setEditingId(ct.id)
    setEditForm({ label: ct.label, category: ct.category, description: ct.description || '' })
  }

  const handleSaveEdit = (id) => {
    updateConceptType({ id, ...editForm })
    setEditingId(null)
  }

  const handleCreateCategory = () => {
    if (!catForm.name || !catForm.label) return
    createServiceCategory(catForm)
    setCatForm({ name: '', label: '', color: 'badge-ghost' })
    setShowCategoryForm(false)
  }

  const handleSeedAll = () => {
    seedDefaults()
    seedCategoryDefaults()
  }

  // Group concept types by category
  const grouped = conceptTypes.reduce((acc, ct) => {
    const cat = ct.category || 'OTROS'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(ct)
    return acc
  }, {})

  // Available categories for the select dropdown
  const availableCategories = serviceCategories.length > 0
    ? serviceCategories
    : Object.entries(fallbackColors).map(([name]) => ({ name, label: name.charAt(0) + name.slice(1).toLowerCase() }))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <WrenchScrewdriverIcon className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Servicios y Gastos</h1>
            <p className="text-sm text-base-content/60">
              Gestionar tipos de servicios, gastos, impuestos y mantenimiento
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleSeedAll}>
            <SparklesIcon className="w-4 h-4" />
            Cargar por defecto
          </Button>
          {activeTab === 'types' && (
            <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
              <PlusIcon className="w-4 h-4" />
              Nuevo tipo
            </Button>
          )}
          {activeTab === 'categories' && (
            <Button variant="primary" size="sm" onClick={() => setShowCategoryForm(!showCategoryForm)}>
              <PlusIcon className="w-4 h-4" />
              Nueva categoría
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs tabs-boxed w-fit">
        <button
          className={`tab ${activeTab === 'types' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('types')}
        >
          <WrenchScrewdriverIcon className="w-4 h-4 mr-1" />
          Tipos de servicio
        </button>
        <button
          className={`tab ${activeTab === 'categories' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          <TagIcon className="w-4 h-4 mr-1" />
          Categorías
        </button>
      </div>

      {/* ======== TAB: TYPES ======== */}
      {activeTab === 'types' && (
        <>
          {/* Create Form */}
          {showForm && (
            <Card title="Nuevo tipo de servicio / gasto">
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text text-sm">Código *</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm"
                      placeholder="Ej: PINTURA_TECHO"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                    />
                  </div>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text text-sm">Nombre *</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm"
                      placeholder="Ej: Pintura de techo"
                      value={form.label}
                      onChange={(e) => setForm({ ...form, label: e.target.value })}
                    />
                  </div>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text text-sm">Categoría</span>
                    </label>
                    <select
                      className="select select-bordered select-sm"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      {availableCategories.map((cat) => (
                        <option key={cat.name} value={cat.name}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text text-sm">&nbsp;</span>
                    </label>
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" onClick={handleCreate} loading={isCreating}>
                        Crear
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm">Descripción (para reportes)</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm"
                    placeholder="Ej: Pintura del techo del living por humedad, arreglo realizado en enero 2026"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* Types by Category */}
          {conceptTypes.length === 0 ? (
            <EmptyState
              title="Sin tipos de servicio"
              description="Crea tipos de servicios/gastos o carga los valores por defecto"
              action={{
                label: 'Cargar por defecto',
                onClick: handleSeedAll,
              }}
            />
          ) : (
            Object.entries(grouped).map(([cat, types]) => (
              <Card key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`badge ${getCategoryColor(cat)}`}>
                    {getCategoryLabel(cat)}
                  </span>
                  <span className="text-sm text-base-content/60">
                    {types.length} tipo(s)
                  </span>
                </div>
                <div className="space-y-2">
                  {types.map((ct) => (
                    <div
                      key={ct.id}
                      className="flex items-start justify-between bg-base-200 rounded-lg px-3 py-2 gap-3"
                    >
                      {editingId === ct.id ? (
                        /* Edit mode */
                        <div className="flex-1 space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <input
                              type="text"
                              className="input input-bordered input-xs"
                              value={editForm.label}
                              onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                              placeholder="Nombre"
                            />
                            <select
                              className="select select-bordered select-xs"
                              value={editForm.category}
                              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                            >
                              {availableCategories.map((c) => (
                                <option key={c.name} value={c.name}>{c.label}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              className="input input-bordered input-xs"
                              value={editForm.description}
                              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                              placeholder="Descripción..."
                            />
                          </div>
                          <div className="flex gap-1 justify-end">
                            <button className="btn btn-xs btn-success" onClick={() => handleSaveEdit(ct.id)}>
                              <CheckIcon className="w-3 h-3" /> Guardar
                            </button>
                            <button className="btn btn-xs btn-ghost" onClick={() => setEditingId(null)}>
                              <XMarkIcon className="w-3 h-3" /> Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* View mode */
                        <>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{ct.label}</span>
                              <span className="text-xs text-base-content/50 font-mono">{ct.name}</span>
                              {ct.isDefault && (
                                <span className="badge badge-xs badge-ghost">default</span>
                              )}
                            </div>
                            {ct.description && (
                              <div className="flex items-start gap-1 mt-1">
                                <InformationCircleIcon className="w-3 h-3 text-base-content/40 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-base-content/50">{ct.description}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => handleStartEdit(ct)}
                              title="Editar"
                            >
                              <PencilIcon className="w-3 h-3" />
                            </button>
                            <button
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => deleteConceptType(ct.id)}
                              title="Eliminar"
                            >
                              <TrashIcon className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </>
      )}

      {/* ======== TAB: CATEGORIES ======== */}
      {activeTab === 'categories' && (
        <>
          {/* Create Category Form */}
          {showCategoryForm && (
            <Card title="Nueva categoría de servicio">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm">Código *</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm"
                    placeholder="Ej: REPARACIONES"
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm">Nombre *</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm"
                    placeholder="Ej: Reparaciones"
                    value={catForm.label}
                    onChange={(e) => setCatForm({ ...catForm, label: e.target.value })}
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm">Color</span>
                  </label>
                  <select
                    className="select select-bordered select-sm"
                    value={catForm.color}
                    onChange={(e) => setCatForm({ ...catForm, color: e.target.value })}
                  >
                    {BADGE_COLOR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm">&nbsp;</span>
                  </label>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={handleCreateCategory} loading={isCreatingCategory}>
                      Crear
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowCategoryForm(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Category List */}
          {serviceCategories.length === 0 ? (
            <EmptyState
              title="Sin categorías"
              description="Carga las categorías por defecto para empezar"
              action={{
                label: 'Cargar por defecto',
                onClick: () => seedCategoryDefaults(),
              }}
            />
          ) : (
            <Card>
              <div className="space-y-2">
                {serviceCategories.map((cat) => {
                  const typesInCat = conceptTypes.filter((ct) => ct.category === cat.name).length
                  return (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between bg-base-200 rounded-lg px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`badge ${cat.color}`}>{cat.label}</span>
                        <span className="text-xs text-base-content/50 font-mono">{cat.name}</span>
                        {cat.isDefault && (
                          <span className="badge badge-xs badge-ghost">default</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-base-content/60">
                          {typesInCat} tipo(s)
                        </span>
                        {!cat.isDefault && (
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => deleteServiceCategory(cat.id)}
                            disabled={isDeletingCategory || typesInCat > 0}
                            title={typesInCat > 0 ? 'No se puede eliminar con tipos asociados' : 'Eliminar'}
                          >
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Stats */}
      <div className="stats shadow">
        <div className="stat">
          <div className="stat-title">Total Tipos</div>
          <div className="stat-value text-lg">{conceptTypes.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Categorías</div>
          <div className="stat-value text-lg">{serviceCategories.length}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Con descripción</div>
          <div className="stat-value text-lg">{conceptTypes.filter(ct => ct.description).length}</div>
        </div>
      </div>
    </div>
  )
}
