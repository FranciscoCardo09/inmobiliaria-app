// TenantCheckboxList - Selectable list of tenants from monthly records
import {
  EnvelopeIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function TenantCheckboxList({
  records = [],
  selectedIds,
  onSelectionChange,
}) {
  // Extract unique tenants from records
  const tenants = records.map(record => {
    const tenant = record.tenants?.[0] || record.tenant || {}
    return {
      id: tenant.id,
      name: tenant.name || 'Sin inquilino',
      email: tenant.email,
      phone: tenant.phone,
      address: record.property?.address,
      totalDue: record.totalDue,
      status: record.status,
      recordId: record.id,
    }
  }).filter(t => t.id)

  const allSelected = tenants.length > 0 && tenants.every(t => selectedIds.includes(t.id))

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([])
    } else {
      onSelectionChange(tenants.map(t => t.id))
    }
  }

  const toggleTenant = (tenantId) => {
    if (selectedIds.includes(tenantId)) {
      onSelectionChange(selectedIds.filter(id => id !== tenantId))
    } else {
      onSelectionChange([...selectedIds, tenantId])
    }
  }

  if (tenants.length === 0) {
    return <p className="text-sm text-base-content/60 py-2">Sin inquilinos para notificar</p>
  }

  return (
    <div className="space-y-1">
      {/* Select all */}
      <label className="flex items-center gap-2 px-3 py-2 bg-base-200 rounded-lg cursor-pointer">
        <input
          type="checkbox"
          className="checkbox checkbox-sm checkbox-primary"
          checked={allSelected}
          onChange={toggleAll}
        />
        <span className="text-sm font-semibold">
          Seleccionar todos ({tenants.length})
        </span>
      </label>

      {/* Tenant rows */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {tenants.map(tenant => (
          <label
            key={tenant.id}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={selectedIds.includes(tenant.id)}
              onChange={() => toggleTenant(tenant.id)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{tenant.name}</div>
              <div className="text-xs text-base-content/60 truncate">{tenant.address}</div>
            </div>
            <div className="flex items-center gap-1">
              {tenant.email && <EnvelopeIcon className="w-3 h-3 text-info" title="Tiene email" />}
              {tenant.phone && <PhoneIcon className="w-3 h-3 text-success" title="Tiene teléfono" />}
            </div>
            <div className="text-sm font-mono text-right w-24">
              {formatCurrency(tenant.totalDue)}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
