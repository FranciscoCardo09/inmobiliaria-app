// Multi Searchable Select - Checkbox multi-select with search
import { useState, useRef, useEffect } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

export const MultiSearchableSelect = ({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = 'Buscar...',
  disabled = false,
}) => {
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  const selectedOptions = options.filter((o) => value.includes(o.value))

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOption = (optionValue) => {
    const next = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue]
    onChange(next)
  }

  const removeOption = (optionValue) => {
    onChange(value.filter((v) => v !== optionValue))
  }

  const selectAll = () => {
    onChange(filtered.map((o) => o.value))
  }

  const clearAll = () => {
    onChange([])
  }

  return (
    <div className="form-control w-full" ref={containerRef}>
      {label && (
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
      )}

      {/* Selected tags */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full"
            >
              {opt.label}
              <button
                type="button"
                onClick={() => removeOption(opt.value)}
                className="hover:text-error transition-colors"
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
          {selectedOptions.length > 1 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-base-content/50 hover:text-error px-1 transition-colors"
            >
              Limpiar todo
            </button>
          )}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40 pointer-events-none" />
        <input
          type="text"
          className="input input-bordered w-full pl-9"
          placeholder={`${placeholder} (${value.length} seleccionados)`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => !disabled && setIsOpen(true)}
          disabled={disabled}
          autoComplete="off"
        />

        {isOpen && !disabled && (
          <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-base-300 bg-base-100 shadow-lg">
            {/* Select all / clear */}
            <li className="flex justify-between items-center px-4 py-2 border-b border-base-200 bg-base-50">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={selectAll}
                className="text-xs text-primary hover:underline"
              >
                Seleccionar todos ({filtered.length})
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearAll}
                className="text-xs text-base-content/50 hover:text-error"
              >
                Limpiar
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-base-content/50">
                No se encontraron resultados
              </li>
            ) : (
              filtered.map((option) => {
                const isSelected = value.includes(option.value)
                return (
                  <li
                    key={option.value}
                    className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-base-200 transition-colors flex items-center gap-2 ${
                      isSelected ? 'bg-primary/5' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleOption(option.value)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="checkbox checkbox-primary checkbox-sm"
                    />
                    <span className={isSelected ? 'font-medium text-primary' : ''}>
                      {option.label}
                    </span>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

export default MultiSearchableSelect
