// Alta / edición de los datos de un consorcio.
import { useEffect, useState } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { formatMoney, parseMoneyInput } from '../../utils/consorcio'

const empty = { name: '', cbu: '', bankAccountName: '', initialReserve: '', reserveLabel: 'Reserva Caja' }

export default function ConsorcioFormModal({ isOpen, onClose, onSubmit, loading, initial }) {
  const [form, setForm] = useState(empty)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setForm(initial ? {
      name: initial.name,
      cbu: initial.cbu,
      bankAccountName: initial.bankAccountName || '',
      initialReserve: initial.initialReserveCents != null ? formatMoney(initial.initialReserveCents).replace('$ ', '') : '',
      reserveLabel: initial.reserveLabel || 'Reserva Caja',
    } : empty)
  }, [isOpen, initial])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    const cbu = form.cbu.replace(/\D/g, '')
    if (cbu.length !== 22) return setError('El CBU tiene 22 dígitos (está arriba del extracto, en "C.B.U.").')
    let initialReserveCents = null
    if (form.initialReserve.trim()) {
      initialReserveCents = parseMoneyInput(form.initialReserve)
      if (initialReserveCents === null) return setError('No entiendo el importe de la reserva inicial. Escribilo como 4.572.078,57')
    }
    setError(null)
    onSubmit({
      name: form.name.trim(),
      cbu,
      bankAccountName: form.bankAccountName.trim() || null,
      initialReserveCents,
      reserveLabel: form.reserveLabel.trim() || 'Reserva Caja',
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? 'Datos del consorcio' : 'Nuevo consorcio'} size="lg">
      <form onSubmit={submit} className="space-y-2">
        <Input label="Nombre (título del informe)" placeholder="Portal del Hierro , Torre I" value={form.name} onChange={set('name')} required />
        <Input label="CBU de la cuenta del edificio" placeholder="22 dígitos" value={form.cbu} onChange={set('cbu')} required />
        <p className="text-xs text-base-content/60">Cada extracto que subas se controla contra este CBU, para no mezclar edificios.</p>
        <Input label="Nombre de la cuenta en el banco (opcional)" placeholder="EDIFICIO …" value={form.bankAccountName} onChange={set('bankAccountName')} />
        <Input label="Reserva Caja inicial (opcional)" placeholder="4.572.078,57" value={form.initialReserve} onChange={set('initialReserve')} />
        <p className="text-xs text-base-content/60">
          Es el TOTAL CAJA del último informe que hiciste a mano. Se usa sólo en la primera rendición; después se arrastra sola del mes anterior cerrado.
        </p>
        <Input label="Texto de la línea de reserva" value={form.reserveLabel} onChange={set('reserveLabel')} />
        {error && <div className="alert alert-error text-sm">{error}</div>}
        <div className="modal-action">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>Guardar</Button>
        </div>
      </form>
    </Modal>
  )
}
