// Creatable Multi Searchable Select - Checkbox multi-select with search and creation
import { useState, useRef, useEffect } from 'react'
import { MagnifyingGlassIcon, XMarkIcon, PlusIcon } from '@heroicons/react/24/outline'

export const CreatableMultiSelect = ({
  label,
  options = [],
  value = [],
  onChange,
  onCreate,
  placeholder = 'Buscar o crear...',
  disabled = false,
  isCreating = false,
}) => {
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  const selectedOptions = options.filter((o) => value.includes(o.value))

  const exactMatchExists = options.some(
    (o) => o.label.toLowerCase() === search.toLowerCase().trim()
  )

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

  const handleCreate = async () => {
    if (!search.trim() || exactMatchExists || !onCreate) return
    const newLabel = search.trim()
    await onCreate(newLabel)
    setSearch('')
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
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full transition-colors hover:bg-primary hover:text-primary-content"
            >
              {opt.label}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeOption(opt.value)
                }}
                className="hover:text-error dark:hover:text-red-300 transition-colors ml-1"
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
      <div className="relative group">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40 pointer-events-none group-focus-within:text-primary transition-colors" />
        <input
          type="text"
          className="input input-bordered w-full pl-9 focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-300"
          placeholder={`${placeholder} (${value.length} seleccionados)`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => !disabled && setIsOpen(true)}
          disabled={disabled}
          autoComplete="off"
        />

        {isOpen && !disabled && (
          <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-base-300 bg-base-100 shadow-[0_8px_30px_rgb(0,0,0,0.12)] animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Create option */}
            {search.trim() !== '' && !exactMatchExists && onCreate && (
              <li 
                className="px-4 py-3 text-sm cursor-pointer border-b border-base-200 bg-primary/5 hover:bg-primary/10 text-primary font-medium transition-colors flex items-center justify-between"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCreate}
              >
                <span>Crear "{search.trim()}"</span>
                {isCreating ? (
                  <span className="loading loading-spinner loading-xs text-primary"></span>
                ) : (
                  <PlusIcon className="w-4 h-4" />
                )}
              </li>
            )}
            
            {/* Select all / clear */}
            {filtered.length > 0 && (
              <li className="flex justify-between items-center px-4 py-2 border-b border-base-200 bg-base-50/50 text-xs">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={selectAll}
                  className="text-primary hover:text-primary-focus font-medium transition-colors"
                >
                  Seleccionar filtrados ({filtered.length})
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearAll}
                  className="text-base-content/50 hover:text-error transition-colors"
                >
                  Limpiar
                </button>
              </li>
            )}

            {filtered.length === 0 && (!search.trim() || exactMatchExists) ? (
              <li className="px-4 py-4 text-sm text-base-content/50 text-center">
                No hay opciones disponibles
              </li>
            ) : (
              filtered.map((option) => {
                const isSelected = value.includes(option.value)
                return (
                  <li
                    key={option.value}
                    className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-base-200 transition-colors flex items-center gap-3 ${
                      isSelected ? 'bg-primary/5' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleOption(option.value)}
                  >
                    <div className={`flex items-center justify-center w-5 h-5 rounded border ${isSelected ? 'bg-primary border-primary text-primary-content' : 'border-base-content/20'}`}>
                      {isSelected && <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    <span className={isSelected ? 'font-medium text-base-content' : 'text-base-content/80'}>
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

export default CreatableMultiSelect
