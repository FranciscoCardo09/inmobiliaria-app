// Phone Input with Country Code Selector and auto-formatting per country
import { useState, useRef, useEffect } from 'react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'

// Format patterns: each char means:
//   'D' = digit, ' ' = space, '-' = dash, '(' = open paren, ')' = close paren
// maxDigits = max raw digits allowed (without country code)
const COUNTRIES = [
  { code: 'AR', dial: '+54', name: 'Argentina',       flag: '🇦🇷', format: 'D DDD DDD-DDDD',       maxDigits: 11, placeholder: '9 111 234-5678' },
  { code: 'UY', dial: '+598', name: 'Uruguay',         flag: '🇺🇾', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '99 123 4567' },
  { code: 'BR', dial: '+55', name: 'Brasil',           flag: '🇧🇷', format: 'DD DDDDD-DDDD',         maxDigits: 11, placeholder: '11 98765-4321' },
  { code: 'CL', dial: '+56', name: 'Chile',            flag: '🇨🇱', format: 'D DDDD DDDD',           maxDigits: 9,  placeholder: '9 1234 5678' },
  { code: 'PY', dial: '+595', name: 'Paraguay',        flag: '🇵🇾', format: 'DDD DDDDDD',            maxDigits: 9,  placeholder: '981 123456' },
  { code: 'BO', dial: '+591', name: 'Bolivia',         flag: '🇧🇴', format: 'D DDDDDDD',             maxDigits: 8,  placeholder: '7 1234567' },
  { code: 'PE', dial: '+51', name: 'Perú',             flag: '🇵🇪', format: 'DDD DDD DDD',           maxDigits: 9,  placeholder: '912 345 678' },
  { code: 'CO', dial: '+57', name: 'Colombia',         flag: '🇨🇴', format: 'DDD DDD DDDD',          maxDigits: 10, placeholder: '310 123 4567' },
  { code: 'VE', dial: '+58', name: 'Venezuela',        flag: '🇻🇪', format: 'DDD-DDDDDDD',           maxDigits: 10, placeholder: '412-1234567' },
  { code: 'EC', dial: '+593', name: 'Ecuador',         flag: '🇪🇨', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '99 123 4567' },
  { code: 'MX', dial: '+52', name: 'México',           flag: '🇲🇽', format: 'DD DDDD DDDD',          maxDigits: 10, placeholder: '55 1234 5678' },
  { code: 'US', dial: '+1',  name: 'Estados Unidos',   flag: '🇺🇸', format: '(DDD) DDD-DDDD',        maxDigits: 10, placeholder: '(212) 555-1234' },
  { code: 'CA', dial: '+1',  name: 'Canadá',           flag: '🇨🇦', format: '(DDD) DDD-DDDD',        maxDigits: 10, placeholder: '(416) 555-1234' },
  { code: 'ES', dial: '+34', name: 'España',           flag: '🇪🇸', format: 'DDD DD DD DD',          maxDigits: 9,  placeholder: '612 34 56 78' },
  { code: 'IT', dial: '+39', name: 'Italia',           flag: '🇮🇹', format: 'DDD DDD DDDD',          maxDigits: 10, placeholder: '312 345 6789' },
  { code: 'FR', dial: '+33', name: 'Francia',          flag: '🇫🇷', format: 'D DD DD DD DD',         maxDigits: 9,  placeholder: '6 12 34 56 78' },
  { code: 'DE', dial: '+49', name: 'Alemania',         flag: '🇩🇪', format: 'DDDD DDDDDDD',          maxDigits: 11, placeholder: '1512 3456789' },
  { code: 'GB', dial: '+44', name: 'Reino Unido',      flag: '🇬🇧', format: 'DDDD DDDDDD',           maxDigits: 10, placeholder: '7911 123456' },
  { code: 'PT', dial: '+351', name: 'Portugal',        flag: '🇵🇹', format: 'DDD DDD DDD',           maxDigits: 9,  placeholder: '912 345 678' },
  { code: 'IL', dial: '+972', name: 'Israel',          flag: '🇮🇱', format: 'DD-DDD-DDDD',           maxDigits: 9,  placeholder: '50-123-4567' },
  { code: 'CN', dial: '+86', name: 'China',            flag: '🇨🇳', format: 'DDD DDDD DDDD',         maxDigits: 11, placeholder: '131 1234 5678' },
  { code: 'JP', dial: '+81', name: 'Japón',            flag: '🇯🇵', format: 'DD-DDDD-DDDD',          maxDigits: 10, placeholder: '90-1234-5678' },
  { code: 'KR', dial: '+82', name: 'Corea del Sur',    flag: '🇰🇷', format: 'DD-DDDD-DDDD',          maxDigits: 10, placeholder: '10-1234-5678' },
  { code: 'IN', dial: '+91', name: 'India',            flag: '🇮🇳', format: 'DDDDD DDDDD',           maxDigits: 10, placeholder: '98765 43210' },
  { code: 'AU', dial: '+61', name: 'Australia',        flag: '🇦🇺', format: 'DDD DDD DDD',           maxDigits: 9,  placeholder: '412 345 678' },
  { code: 'NZ', dial: '+64', name: 'Nueva Zelanda',    flag: '🇳🇿', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '21 123 4567' },
  { code: 'CR', dial: '+506', name: 'Costa Rica',      flag: '🇨🇷', format: 'DDDD DDDD',             maxDigits: 8,  placeholder: '8312 3456' },
  { code: 'PA', dial: '+507', name: 'Panamá',          flag: '🇵🇦', format: 'DDDD-DDDD',             maxDigits: 8,  placeholder: '6123-4567' },
  { code: 'DO', dial: '+1',  name: 'Rep. Dominicana',  flag: '🇩🇴', format: '(DDD) DDD-DDDD',        maxDigits: 10, placeholder: '(809) 555-1234' },
  { code: 'CU', dial: '+53', name: 'Cuba',             flag: '🇨🇺', format: 'D DDDDDDD',             maxDigits: 8,  placeholder: '5 1234567' },
  { code: 'GT', dial: '+502', name: 'Guatemala',       flag: '🇬🇹', format: 'DDDD DDDD',             maxDigits: 8,  placeholder: '5123 4567' },
  { code: 'HN', dial: '+504', name: 'Honduras',        flag: '🇭🇳', format: 'DDDD-DDDD',             maxDigits: 8,  placeholder: '9123-4567' },
  { code: 'SV', dial: '+503', name: 'El Salvador',     flag: '🇸🇻', format: 'DDDD DDDD',             maxDigits: 8,  placeholder: '7012 3456' },
  { code: 'NI', dial: '+505', name: 'Nicaragua',       flag: '🇳🇮', format: 'DDDD DDDD',             maxDigits: 8,  placeholder: '8123 4567' },
  { code: 'ZA', dial: '+27', name: 'Sudáfrica',        flag: '🇿🇦', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '71 123 4567' },
  { code: 'RU', dial: '+7',  name: 'Rusia',            flag: '🇷🇺', format: '(DDD) DDD-DD-DD',       maxDigits: 10, placeholder: '(912) 345-67-89' },
  { code: 'TR', dial: '+90', name: 'Turquía',          flag: '🇹🇷', format: 'DDD DDD DD DD',         maxDigits: 10, placeholder: '532 123 45 67' },
  { code: 'SA', dial: '+966', name: 'Arabia Saudita',  flag: '🇸🇦', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '50 123 4567' },
  { code: 'AE', dial: '+971', name: 'Emiratos Árabes', flag: '🇦🇪', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '50 123 4567' },
  { code: 'PL', dial: '+48', name: 'Polonia',          flag: '🇵🇱', format: 'DDD DDD DDD',           maxDigits: 9,  placeholder: '512 345 678' },
  { code: 'NL', dial: '+31', name: 'Países Bajos',     flag: '🇳🇱', format: 'D DDDDDDDD',            maxDigits: 9,  placeholder: '6 12345678' },
  { code: 'BE', dial: '+32', name: 'Bélgica',          flag: '🇧🇪', format: 'DDD DD DD DD',          maxDigits: 9,  placeholder: '470 12 34 56' },
  { code: 'CH', dial: '+41', name: 'Suiza',            flag: '🇨🇭', format: 'DD DDD DD DD',          maxDigits: 9,  placeholder: '78 123 45 67' },
  { code: 'AT', dial: '+43', name: 'Austria',          flag: '🇦🇹', format: 'DDD DDDDDDD',           maxDigits: 10, placeholder: '664 1234567' },
  { code: 'SE', dial: '+46', name: 'Suecia',           flag: '🇸🇪', format: 'DD-DDD DD DD',          maxDigits: 9,  placeholder: '70-123 45 67' },
  { code: 'NO', dial: '+47', name: 'Noruega',          flag: '🇳🇴', format: 'DDD DD DDD',            maxDigits: 8,  placeholder: '412 34 567' },
  { code: 'DK', dial: '+45', name: 'Dinamarca',        flag: '🇩🇰', format: 'DD DD DD DD',           maxDigits: 8,  placeholder: '20 12 34 56' },
  { code: 'FI', dial: '+358', name: 'Finlandia',       flag: '🇫🇮', format: 'DD DDDDDDD',            maxDigits: 9,  placeholder: '50 1234567' },
  { code: 'IE', dial: '+353', name: 'Irlanda',         flag: '🇮🇪', format: 'DD DDD DDDD',           maxDigits: 9,  placeholder: '85 123 4567' },
  { code: 'GR', dial: '+30', name: 'Grecia',           flag: '🇬🇷', format: 'DDD DDD DDDD',          maxDigits: 10, placeholder: '691 234 5678' },
]

const DEFAULT_COUNTRY = COUNTRIES[0] // Argentina

/**
 * Apply a format pattern to raw digits.
 * Pattern chars: D = digit slot, anything else = literal separator
 * Returns the formatted string (only up to the digits available).
 */
function applyFormat(digits, format) {
  let result = ''
  let di = 0
  for (let i = 0; i < format.length && di < digits.length; i++) {
    if (format[i] === 'D') {
      result += digits[di++]
    } else {
      result += format[i]
    }
  }
  return result
}

/**
 * Strip all non-digit chars from a string.
 */
function stripNonDigits(str) {
  return str.replace(/[^0-9]/g, '')
}

/**
 * Parse a stored phone value like "+54 9 351 508-8882" into { country, rawDigits }
 */
function parsePhone(value) {
  if (!value) return { country: DEFAULT_COUNTRY, rawDigits: '' }

  const trimmed = value.trim()
  if (trimmed.startsWith('+')) {
    // Try matching longest dial codes first (up to 4 digits after +)
    for (let len = 4; len >= 1; len--) {
      const candidateDial = trimmed.slice(0, len + 1) // e.g. +54, +598
      const found = COUNTRIES.find(c => c.dial === candidateDial)
      if (found) {
        const rest = trimmed.slice(candidateDial.length)
        return { country: found, rawDigits: stripNonDigits(rest) }
      }
    }
  }

  // No code found — treat everything as digits with default country
  return { country: DEFAULT_COUNTRY, rawDigits: stripNonDigits(trimmed) }
}

export const PhoneInput = ({
  label,
  value = '',
  onChange,
  error,
  className = '',
  name,
}) => {
  const { country: initialCountry, rawDigits: initialDigits } = parsePhone(value)
  const [selectedCountry, setSelectedCountry] = useState(initialCountry)
  const [rawDigits, setRawDigits] = useState(initialDigits)
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef(null)
  const searchInputRef = useRef(null)
  const inputRef = useRef(null)

  // Sync from external value changes (e.g., form load on edit)
  useEffect(() => {
    const { country, rawDigits: digits } = parsePhone(value)
    setSelectedCountry(country)
    setRawDigits(digits)
  }, [value])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const emitChange = (country, digits) => {
    if (!onChange) return
    // Store formatted: "+54 9 351 508-8882"
    const formatted = digits ? `${country.dial} ${applyFormat(digits, country.format)}` : ''
    if (name) {
      onChange({ target: { name, value: formatted } })
    } else {
      onChange(formatted)
    }
  }

  const handleCountrySelect = (country) => {
    setSelectedCountry(country)
    setIsOpen(false)
    setSearch('')
    // Trim digits if new country has lower maxDigits
    const trimmed = rawDigits.slice(0, country.maxDigits)
    setRawDigits(trimmed)
    emitChange(country, trimmed)
  }

  const handleInputChange = (e) => {
    const digits = stripNonDigits(e.target.value).slice(0, selectedCountry.maxDigits)
    setRawDigits(digits)
    emitChange(selectedCountry, digits)
  }

  // Handle keyboard: let user type normally; backspace removes last digit
  const handleKeyDown = (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const newDigits = rawDigits.slice(0, -1)
      setRawDigits(newDigits)
      emitChange(selectedCountry, newDigits)
    }
  }

  const displayValue = applyFormat(rawDigits, selectedCountry.format)

  const filtered = search
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.dial.includes(search) ||
          c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRIES

  return (
    <div className="form-control w-full">
      {label && (
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
      )}
      <div className="flex">
        {/* Country selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            className={`flex items-center gap-1 px-3 h-full border border-r-0 rounded-l-lg bg-base-200 hover:bg-base-300 transition-colors min-w-[100px] ${
              error ? 'border-error' : 'border-base-300'
            }`}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className="text-lg">{selectedCountry.flag}</span>
            <span className="text-sm font-medium">{selectedCountry.dial}</span>
            <ChevronDownIcon className="w-3 h-3 text-base-content/50" />
          </button>

          {isOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-base-100 border border-base-300 rounded-lg shadow-xl z-50 max-h-64 flex flex-col">
              {/* Search */}
              <div className="p-2 border-b border-base-300">
                <input
                  ref={searchInputRef}
                  type="text"
                  className="input input-bordered input-sm w-full"
                  placeholder="Buscar país..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {/* Country list */}
              <div className="overflow-y-auto flex-1">
                {filtered.length === 0 ? (
                  <div className="p-3 text-sm text-base-content/50 text-center">
                    No se encontraron países
                  </div>
                ) : (
                  filtered.map((country) => (
                    <button
                      key={country.code}
                      type="button"
                      className={`flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-base-200 transition-colors text-sm ${
                        selectedCountry.code === country.code ? 'bg-primary/10 font-medium' : ''
                      }`}
                      onClick={() => handleCountrySelect(country)}
                    >
                      <span className="text-lg">{country.flag}</span>
                      <span className="flex-1">{country.name}</span>
                      <span className="text-base-content/60 font-mono">{country.dial}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Formatted phone number input */}
        <input
          ref={inputRef}
          type="tel"
          className={`input input-bordered w-full rounded-l-none ${error ? 'input-error' : ''} ${className}`}
          value={displayValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={selectedCountry.placeholder}
        />
      </div>
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  )
}

export default PhoneInput
