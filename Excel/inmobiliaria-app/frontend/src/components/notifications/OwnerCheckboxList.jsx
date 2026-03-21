// OwnerCheckboxList - Selectable list of property owners
import {
  EnvelopeIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'

export default function OwnerCheckboxList({
  owners = [],
  selectedIds,
  onSelectionChange,
}) {
  const allSelected = owners.length > 0 && owners.every(o => selectedIds.includes(o.id))

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([])
    } else {
      onSelectionChange(owners.map(o => o.id))
    }
  }

  const toggleOwner = (ownerId) => {
    if (selectedIds.includes(ownerId)) {
      onSelectionChange(selectedIds.filter(id => id !== ownerId))
    } else {
      onSelectionChange([...selectedIds, ownerId])
    }
  }

  if (owners.length === 0) {
    return <p className="text-sm text-base-content/60 py-2">Sin propietarios para notificar</p>
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
          Seleccionar todos ({owners.length})
        </span>
      </label>

      {/* Owner rows */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {owners.map(owner => (
          <label
            key={owner.id}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200 rounded cursor-pointer"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={selectedIds.includes(owner.id)}
              onChange={() => toggleOwner(owner.id)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{owner.name}</div>
            </div>
            <div className="flex items-center gap-1">
              {owner.email && <EnvelopeIcon className="w-3 h-3 text-info" title="Tiene email" />}
              {owner.phone && <PhoneIcon className="w-3 h-3 text-success" title="Tiene teléfono" />}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
