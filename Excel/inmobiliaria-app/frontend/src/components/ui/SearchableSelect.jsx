// Reusable Searchable Select Component
import { useState, useRef, useEffect } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'

export const SearchableSelect = ({
  label,
  options = [],
  value,
  onChange,
  placeholder = 'Buscar...',
  error,
  disabled = false,
  name,
}) => {
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  // Find the selected option's label
  const selectedOption = options.find((o) => o.value === value)

  // Filter options based on search text
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
        if (!value) setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [value])

  const handleSelect = (option) => {
    onChange({ target: { name, value: option.value } })
    setSearch(option.label)
    setIsOpen(false)
  }

  const handleClear = () => {
    onChange({ target: { name, value: '' } })
    setSearch('')
    inputRef.current?.focus()
  }

  const handleInputChange = (e) => {
    setSearch(e.target.value)
    if (!isOpen) setIsOpen(true)
    // If the user clears the text, also clear the selection
    if (e.target.value === '') {
      onChange({ target: { name, value: '' } })
    }
  }

  const handleFocus = () => {
    if (!disabled) {
      setIsOpen(true)
      // If there's a selected value, show all options but keep text
      if (selectedOption) {
        setSearch(selectedOption.label)
      }
    }
  }

  // Sync displayed text with selected option
  useEffect(() => {
    if (selectedOption && !isOpen) {
      setSearch(selectedOption.label)
    } else if (!value && !isOpen) {
      setSearch('')
    }
  }, [selectedOption, value, isOpen])

  return (
    <div className="form-control w-full" ref={containerRef}>
      {label && (
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
      )}
      <div className="relative">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            className={`input input-bordered w-full pl-9 pr-8 ${error ? 'input-error' : ''}`}
            placeholder={placeholder}
            value={search}
            onChange={handleInputChange}
            onFocus={handleFocus}
            disabled={disabled}
            autoComplete="off"
          />
          {value && !disabled && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content"
              onClick={handleClear}
              tabIndex={-1}
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {isOpen && !disabled && (
          <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-base-300 bg-base-100 shadow-lg">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-base-content/50">
                No se encontraron resultados
              </li>
            ) : (
              filtered.map((option) => (
                <li
                  key={option.value}
                  className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-base-200 transition-colors ${
                    option.value === value ? 'bg-primary/10 font-medium text-primary' : ''
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(option)}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  )
}

export default SearchableSelect
