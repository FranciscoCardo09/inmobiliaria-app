// DateInput - dd/mm/yyyy formatted date input with calendar picker
// Stores value internally as yyyy-mm-dd for API compatibility
// Displays and accepts input in dd/mm/yyyy format
// Click calendar icon or focus input to open a month-grid calendar
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'

const MONTH_NAMES_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]
const DAY_HEADERS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']

/**
 * Get today's date as yyyy-mm-dd in LOCAL timezone (no UTC shift)
 */
export function getLocalToday() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toDisplay(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  if (!y || !m || !d) return isoDate
  return `${d}/${m}/${y}`
}

function toISO(displayDate) {
  if (!displayDate) return ''
  const [d, m, y] = displayDate.split('/')
  if (!d || !m || !y) return displayDate
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function autoFormat(raw) {
  const digits = raw.replace(/\D/g, '')
  let result = ''
  for (let i = 0; i < digits.length && i < 8; i++) {
    if (i === 2 || i === 4) result += '/'
    result += digits[i]
  }
  return result
}

function isValidDate(str) {
  if (!str || str.length !== 10) return false
  const [d, m, y] = str.split('/').map(Number)
  if (!d || !m || !y) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  if (y < 2000 || y > 2100) return false
  const date = new Date(y, m - 1, d)
  return date.getDate() === d && date.getMonth() === m - 1 && date.getFullYear() === y
}

/** Parse yyyy-mm-dd to { year, month (0-based), day } */
function parseISO(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return { year: y, month: m - 1, day: d }
}

/** Build calendar grid for a given year/month (0-based) */
function buildCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1)
  // Monday=0 … Sunday=6
  let startWeekday = firstDay.getDay() - 1
  if (startWeekday < 0) startWeekday = 6

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells = []

  // Previous month trailing days
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, current: false })
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true })
  }
  // Next month leading days to fill 6 rows (42 cells) or at least full weeks
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, current: false })
  }

  return cells
}

// ─── Calendar dropdown ──────────────────────────────────────
function CalendarDropdown({ selectedISO, onSelect, onClose, dropUp }) {
  const parsed = parseISO(selectedISO)
  const today = new Date()
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())

  const cells = buildCalendarDays(viewYear, viewMonth)

  const todayStr = getLocalToday()

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
    else setViewMonth(viewMonth - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
    else setViewMonth(viewMonth + 1)
  }

  const handleDayClick = (cell) => {
    if (!cell.current) return
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`
    onSelect(iso)
  }

  return (
    <div
      className={`absolute z-50 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 w-[280px] select-none`}
      onMouseDown={(e) => e.preventDefault()} // prevent blur on input
    >
      {/* Header: nav + month/year */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle"
          onClick={prevMonth}
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold">
          {MONTH_NAMES_SHORT[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle"
          onClick={nextMonth}
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAY_HEADERS.map((h) => (
          <div key={h} className="text-center text-[10px] font-bold text-base-content/50 py-0.5">
            {h}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((cell, i) => {
          const cellISO = cell.current
            ? `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`
            : null
          const isSelected = cellISO === selectedISO
          const isToday = cellISO === todayStr

          return (
            <button
              key={i}
              type="button"
              className={`
                w-full aspect-square flex items-center justify-center text-xs rounded-md transition-colors
                ${!cell.current ? 'text-base-content/20 cursor-default' : 'hover:bg-primary/10 cursor-pointer'}
                ${isSelected ? 'bg-primary text-primary-content font-bold hover:bg-primary' : ''}
                ${isToday && !isSelected ? 'ring-1 ring-primary font-semibold' : ''}
              `}
              onClick={() => handleDayClick(cell)}
              tabIndex={-1}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      {/* Today shortcut */}
      <div className="mt-2 border-t border-base-300 pt-2 flex justify-center">
        <button
          type="button"
          className="btn btn-ghost btn-xs text-primary"
          onClick={() => onSelect(todayStr)}
        >
          Hoy
        </button>
      </div>
    </div>
  )
}

// ─── Main DateInput ─────────────────────────────────────────
/**
 * DateInput component with calendar picker
 * @param {string} value - Date in yyyy-mm-dd format
 * @param {function} onChange - Called with yyyy-mm-dd string
 * @param {string} className - Additional class names
 */
export default function DateInput({ value, onChange, className = '', ...props }) {
  const [displayValue, setDisplayValue] = useState(toDisplay(value || ''))
  const [isFocused, setIsFocused] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  // Sync external value changes
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(toDisplay(value || ''))
    }
  }, [value, isFocused])

  // Close calendar on outside click
  useEffect(() => {
    if (!showCalendar) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowCalendar(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCalendar])

  // Check if calendar should drop up (not enough space below)
  const checkDropDirection = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setDropUp(spaceBelow < 340)
  }, [])

  const openCalendar = () => {
    checkDropDirection()
    setShowCalendar(true)
  }

  const handleChange = (e) => {
    const formatted = autoFormat(e.target.value)
    setDisplayValue(formatted)
    if (formatted.length === 10 && isValidDate(formatted)) {
      onChange(toISO(formatted))
    }
  }

  const handleBlur = () => {
    setIsFocused(false)
    if (displayValue.length === 10 && isValidDate(displayValue)) {
      onChange(toISO(displayValue))
    } else if (displayValue.length === 0) {
      onChange('')
    } else {
      setDisplayValue(toDisplay(value || ''))
    }
  }

  const handleCalendarSelect = (iso) => {
    onChange(iso)
    setDisplayValue(toDisplay(iso))
    setShowCalendar(false)
    inputRef.current?.focus()
  }

  const handleIconClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (showCalendar) {
      setShowCalendar(false)
    } else {
      openCalendar()
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        className={`input input-bordered w-full pr-9 ${className}`}
        value={displayValue}
        onChange={handleChange}
        onFocus={() => { setIsFocused(true); openCalendar() }}
        onBlur={handleBlur}
        {...props}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-base-200 transition-colors"
        onClick={handleIconClick}
        tabIndex={-1}
      >
        <CalendarDaysIcon className="w-4 h-4 text-base-content/40" />
      </button>

      {showCalendar && (
        <CalendarDropdown
          selectedISO={value}
          onSelect={handleCalendarSelect}
          onClose={() => setShowCalendar(false)}
          dropUp={dropUp}
        />
      )}
    </div>
  )
}
