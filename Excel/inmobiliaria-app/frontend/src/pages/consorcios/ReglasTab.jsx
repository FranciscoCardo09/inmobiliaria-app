// Reglas de clasificación: "si la transferencia es al CUIT X → rubro Y con el texto Z".
// Se crean solas al clasificar con "Recordar", y acá se ven, editan y borran.
import { useEffect, useState } from 'react'
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Input from '../../components/ui/Input'
import LabelInput from './LabelInput'
import { formatMoney, parseMoneyInput } from '../../utils/consorcio'

const emptyRule = { matchCuit: '', matchText: '', matchConcept: '', direction: '', amount: '', rubroId: '', itemLabel: '', alwaysAsk: false, priority: 0, isActive: true }

function ReglaModal({ isOpen, onClose, rubros, initial, onSave, loading }) {
  const [f, setF] = useState(emptyRule)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setF(initial ? {
      ...emptyRule, ...initial,
      matchCuit: initial.matchCuit || '', matchText: initial.matchText || '', matchConcept: initial.matchConcept || '',
      direction: initial.direction || '', amount: initial.matchAmountCents != null ? formatMoney(initial.matchAmountCents).replace('$ ', '') : '',
    } : emptyRule)
  }, [isOpen, initial])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    if (!f.matchCuit && !f.matchText && !f.matchConcept) return setError('Poné al menos una condición: CUIT, texto o código de concepto.')
    if (!f.rubroId || !f.itemLabel.trim()) return setError('Elegí el rubro y el texto de la línea.')
    let matchAmountCents = null
    if (f.amount.trim()) {
      matchAmountCents = parseMoneyInput(f.amount)
      if (matchAmountCents === null || matchAmountCents <= 0) return setError('El importe no se entiende (ej. 541.200,00).')
    }
    onSave({
      matchCuit: f.matchCuit.replace(/\D/g, '') || null,
      matchText: f.matchText.trim() || null,
      matchConcept: f.matchConcept.trim() || null,
      direction: f.direction || null,
      matchAmountCents,
      rubroId: f.rubroId,
      itemLabel: f.itemLabel.trim(),
      alwaysAsk: f.alwaysAsk,
      priority: Number(f.priority) || 0,
      isActive: f.isActive,
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? 'Editar regla' : 'Nueva regla'} size="full">
      <form onSubmit={submit} className="space-y-3">
        <div className="text-sm font-semibold">Cuándo aplica (se tienen que cumplir todas las condiciones que completes)</div>
        <div className="grid md:grid-cols-3 gap-3">
          <Input label="CUIT de la contraparte" placeholder="11 dígitos" value={f.matchCuit} onChange={set('matchCuit')} />
          <Input label="La descripción contiene" placeholder="ej. PROVIDUS" value={f.matchText} onChange={set('matchText')} />
          <Input label="Código de concepto del banco" placeholder="ej. 190" value={f.matchConcept} onChange={set('matchConcept')} />
          <div className="form-control">
            <label className="label"><span className="label-text font-medium">Sentido</span></label>
            <select className="select select-bordered" value={f.direction} onChange={set('direction')}>
              <option value="">Cualquiera</option>
              <option value="DEBITO">Débito (sale plata)</option>
              <option value="CREDITO">Crédito (entra plata)</option>
            </select>
          </div>
          <Input label="Importe exacto (opcional)" placeholder="541.200,00" value={f.amount} onChange={set('amount')} />
          <Input label="Prioridad" type="number" value={f.priority} onChange={set('priority')} />
        </div>
        <p className="text-xs text-base-content/60">
          Si dos reglas coinciden gana la de mayor prioridad. Si empatan y mandan a lugares distintos, el movimiento queda pendiente para que elijas.
        </p>
        <div className="text-sm font-semibold pt-2">Qué hace</div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="form-control">
            <label className="label"><span className="label-text font-medium">Rubro</span></label>
            <select className="select select-bordered" value={f.rubroId} onChange={set('rubroId')}>
              <option value="">Elegí…</option>
              {rubros.map((r) => <option key={r.id} value={r.id}>{String(r.number).padStart(2, '0')} {r.name}</option>)}
            </select>
          </div>
          <LabelInput id="regla-label" value={f.itemLabel} onChange={(v) => setF((x) => ({ ...x, itemLabel: v }))} />
        </div>
        <label className="label cursor-pointer justify-start gap-3">
          <input type="checkbox" className="checkbox" checked={f.alwaysAsk} onChange={set('alwaysAsk')} />
          <span className="label-text">
            Preguntar siempre: sólo sugerirlo. Usalo cuando a la misma contraparte se le pagan cosas distintas (ej. un pagador de servicios que paga luz, agua e impuestos).
          </span>
        </label>
        <label className="label cursor-pointer justify-start gap-3">
          <input type="checkbox" className="checkbox" checked={f.isActive} onChange={set('isActive')} />
          <span className="label-text">Activa</span>
        </label>
        {error && <div className="alert alert-error text-sm">{error}</div>}
        <div className="modal-action">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>Guardar</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function ReglasTab({ consorcio, hook, canEdit }) {
  const [editing, setEditing] = useState(undefined) // undefined: cerrado; null: nueva; objeto: editar
  const save = (data) => {
    const done = { onSuccess: () => setEditing(undefined) }
    if (editing) hook.updateRegla.mutate({ id: editing.id, ...data }, done)
    else hook.createRegla.mutate(data, done)
  }

  return (
    <Card
      title="Reglas de clasificación"
      subtitle="Se crean al clasificar un movimiento con “Recordar”. Después de cambiar una regla, usá “Reaplicar reglas” en la rendición abierta."
      actions={canEdit && <Button size="sm" onClick={() => setEditing(null)}><PlusIcon className="w-4 h-4" /> Nueva regla</Button>}
    >
      {consorcio.reglas.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No hay reglas todavía. Lo automático (cobranzas, comisiones, IVA, impuesto al cheque) no necesita reglas; las transferencias sí.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead><tr><th>Regla</th><th>Prioridad</th><th /></tr></thead>
            <tbody>
              {consorcio.reglas.map((r) => (
                <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
                  <td className="whitespace-normal">
                    {r.description}
                    {r.alwaysAsk && <span className="badge badge-warning badge-sm ml-2">pregunta</span>}
                  </td>
                  <td>{r.priority}</td>
                  <td className="whitespace-nowrap text-right">
                    {canEdit && (
                      <>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => setEditing(r)}><PencilIcon className="w-4 h-4" /></button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          title="Borrar"
                          onClick={() => window.confirm('¿Borrar esta regla?') && hook.removeRegla.mutate(r.id)}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReglaModal
        isOpen={editing !== undefined}
        initial={editing || null}
        rubros={consorcio.rubros}
        onClose={() => setEditing(undefined)}
        onSave={save}
        loading={hook.createRegla.isPending || hook.updateRegla.isPending}
      />
    </Card>
  )
}
