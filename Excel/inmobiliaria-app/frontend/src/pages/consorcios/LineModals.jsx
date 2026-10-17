// Modales de la vista previa: ajustar el monto de una línea, agregar una línea
// manual y cambiar la Reserva Caja. Todo cambio de monto lleva una nota.
import { useEffect, useState } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import LabelInput from './LabelInput'
import { formatMoney, parseMoneyInput } from '../../utils/consorcio'

const toInput = (cents) => formatMoney(cents).replace('$ ', '')

function Actions({ onClose, onSave, loading, extra }) {
  return (
    <>
      {extra}
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button onClick={onSave} loading={loading}>Guardar</Button>
    </>
  )
}

export function AjusteModal({ line, ajuste, onClose, onSave, onRemove, loading }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!line) return
    setAmount(toInput(line.finalCents))
    setNote(ajuste?.note || '')
    setError(null)
  }, [line, ajuste])
  if (!line) return null
  const cents = parseMoneyInput(amount)
  const diff = cents === null ? null : cents - line.computedCents

  const save = () => {
    if (cents === null || cents < 0) return setError('No entiendo el importe (ej. 8.392,00).')
    if (!note.trim()) return setError('Escribí por qué el monto es distinto al del banco (queda registrado).')
    onSave({ amountCents: cents, note: note.trim() })
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Ajustar monto de la línea"
      actions={<Actions onClose={onClose} onSave={save} loading={loading}
        extra={ajuste && <Button variant="ghost" className="text-error mr-auto" onClick={onRemove}>Quitar ajuste</Button>} />}
    >
      <div className="space-y-3 text-sm">
        <div className="font-medium">{line.label}</div>
        <div>Según el extracto: <span className="font-mono">{formatMoney(line.computedCents)}</span></div>
        <Input label="Monto que va en el informe" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {diff !== null && diff !== 0 && (
          <div className="text-xs">Diferencia con el banco: <span className="font-mono">{diff > 0 ? '+' : ''}{formatMoney(diff)}</span></div>
        )}
        <div className="form-control">
          <label className="label"><span className="label-text font-medium">Nota (obligatoria)</span></label>
          <textarea className="textarea textarea-bordered" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. redondeo de la póliza / importe de la boleta / incluye gastos de junio" />
        </div>
        {error && <div className="alert alert-error text-sm">{error}</div>}
      </div>
    </Modal>
  )
}

export function ManualLineModal({ isOpen, rubros, year, month, onClose, onSave, loading }) {
  const [rubroId, setRubroId] = useState('')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!isOpen) return
    setRubroId(''); setLabel(''); setAmount(''); setNote(''); setError(null)
  }, [isOpen])

  const save = () => {
    const cents = parseMoneyInput(amount)
    if (!rubroId || !label.trim()) return setError('Elegí el rubro y el texto.')
    if (cents === null || cents <= 0) return setError('El importe tiene que ser mayor a cero.')
    if (!note.trim()) return setError('Escribí de dónde sale (no está en el extracto).')
    onSave({ kind: 'MANUAL', rubroId, itemLabel: label.trim(), amountCents: cents, note: note.trim() })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Línea sin movimiento bancario" size="lg" actions={<Actions onClose={onClose} onSave={save} loading={loading} />}>
      <div className="space-y-2 text-sm">
        <p className="text-base-content/70">Para algo que va en el informe pero no pasó por el banco (ej. un gasto pagado en efectivo). Si el texto coincide con una línea existente, se suma a esa línea.</p>
        <div className="form-control">
          <label className="label"><span className="label-text font-medium">Rubro</span></label>
          <select className="select select-bordered" value={rubroId} onChange={(e) => setRubroId(e.target.value)}>
            <option value="">Elegí…</option>
            {rubros.map((r) => <option key={r.id} value={r.id}>{String(r.number).padStart(2, '0')} {r.name}</option>)}
          </select>
        </div>
        <LabelInput id="manual-label" value={label} onChange={setLabel} year={year} month={month} />
        <Input label="Importe" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.000,00" />
        <div className="form-control">
          <label className="label"><span className="label-text font-medium">Nota (obligatoria)</span></label>
          <textarea className="textarea textarea-bordered" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="alert alert-error text-sm">{error}</div>}
      </div>
    </Modal>
  )
}

export function ReservaModal({ isOpen, rendicion, report, onClose, onSave, loading }) {
  const [mode, setMode] = useState('AUTO')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!isOpen) return
    setMode(rendicion.reserveSource === 'MANUAL' ? 'MANUAL' : 'AUTO')
    setAmount(report.totals.reserveCents != null ? toInput(report.totals.reserveCents) : '')
    setNote(rendicion.reserveNote || '')
    setError(null)
  }, [isOpen, rendicion, report])

  const save = () => {
    if (mode === 'AUTO') return onSave({ mode: 'AUTO' })
    const cents = parseMoneyInput(amount)
    if (cents === null) return setError('No entiendo el importe (ej. 4.572.078,57).')
    if (!note.trim()) return setError('Escribí de dónde sale este monto.')
    return onSave({ mode: 'MANUAL', cents, note: note.trim() })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reserva Caja" size="lg" actions={<Actions onClose={onClose} onSave={save} loading={loading} />}>
      <div className="space-y-3 text-sm">
        <p className="text-base-content/70">
          La Reserva Caja es el TOTAL CAJA del mes anterior. Normalmente sale sola de la rendición cerrada del mes anterior
          (o de la reserva inicial del consorcio, en la primera). Cargala a mano sólo si hace falta.
        </p>
        <label className="label cursor-pointer justify-start gap-2">
          <input type="radio" className="radio radio-sm" checked={mode === 'AUTO'} onChange={() => setMode('AUTO')} />
          <span className="label-text">Automática</span>
        </label>
        <label className="label cursor-pointer justify-start gap-2">
          <input type="radio" className="radio radio-sm" checked={mode === 'MANUAL'} onChange={() => setMode('MANUAL')} />
          <span className="label-text">A mano</span>
        </label>
        {mode === 'MANUAL' && (
          <>
            <Input label="Importe" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="form-control">
              <label className="label"><span className="label-text font-medium">Nota (obligatoria)</span></label>
              <textarea className="textarea textarea-bordered" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Total Caja del informe de junio hecho a mano" />
            </div>
          </>
        )}
        {error && <div className="alert alert-error text-sm">{error}</div>}
      </div>
    </Modal>
  )
}
