// Rubros del informe: "01- Ingresos del periodo", "02- Servicio de Limpieza", …
import { useEffect, useState } from 'react'
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Input from '../../components/ui/Input'
import LabelInput from './LabelInput'

const ROLE_HELP = {
  INGRESOS: 'Recibe solo las cobranzas (QR, Pago Mis Cuentas, Rapipago, PagoFácil, transferencias recibidas).',
  GASTOS_BANCARIOS: 'Recibe solo comisiones, IVA e impuesto Ley 25413.',
  RESERVA: 'Acá se muestra la Reserva Caja (el Total Caja del mes anterior).',
}

function RubroModal({ isOpen, onClose, initial, onSave, loading, nextNumber }) {
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!isOpen) return
    setF(initial
      ? { number: initial.number, name: initial.name, kind: initial.kind, role: initial.role || '', defaultItemLabel: initial.defaultItemLabel || '' }
      : { number: nextNumber, name: '', kind: 'EGRESO', role: '', defaultItemLabel: '' })
  }, [isOpen, initial, nextNumber])
  if (!isOpen || !f) return null
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? 'Editar rubro' : 'Nuevo rubro'} size="lg">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ number: Number(f.number), name: f.name.trim(), kind: f.kind, role: f.role || null, defaultItemLabel: f.defaultItemLabel.trim() || null })
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <Input label="Número" type="number" min="1" max="99" value={f.number} onChange={set('number')} required />
          <div className="col-span-2"><Input label="Nombre" value={f.name} onChange={set('name')} required /></div>
        </div>
        <div className="form-control">
          <label className="label"><span className="label-text font-medium">Tipo</span></label>
          <select className="select select-bordered" value={f.kind} onChange={set('kind')}>
            <option value="EGRESO">Egreso (resta del Total Caja)</option>
            <option value="INGRESO">Ingreso (suma al Total Caja)</option>
          </select>
        </div>
        <div className="form-control">
          <label className="label"><span className="label-text font-medium">Clasificación automática</span></label>
          <select className="select select-bordered" value={f.role} onChange={set('role')}>
            <option value="">Ninguna</option>
            <option value="INGRESOS">Cobranzas de expensas</option>
            <option value="GASTOS_BANCARIOS">Gastos bancarios</option>
            <option value="RESERVA">Mostrar la Reserva Caja</option>
          </select>
          {f.role && <span className="text-xs text-base-content/60 mt-1">{ROLE_HELP[f.role]}</span>}
        </div>
        {(f.role === 'INGRESOS' || f.role === 'GASTOS_BANCARIOS') && (
          <LabelInput id="rubro-label" label="Texto de la línea automática" value={f.defaultItemLabel} onChange={(v) => setF((x) => ({ ...x, defaultItemLabel: v }))} />
        )}
        <div className="modal-action">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>Guardar</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function RubrosTab({ consorcio, hook, canEdit, isAdmin }) {
  const [editing, setEditing] = useState(undefined)
  const nextNumber = Math.max(0, ...consorcio.rubros.map((r) => r.number)) + 1
  const save = (data) => {
    const done = { onSuccess: () => setEditing(undefined) }
    if (editing) hook.updateRubro.mutate({ id: editing.id, ...data }, done)
    else hook.createRubro.mutate(data, done)
  }
  return (
    <Card
      title="Rubros del informe"
      subtitle={`El TOTAL CAJA sale como rubro ${String(nextNumber).padStart(2, '0')}: Reserva + Ingresos − Egresos.`}
      actions={canEdit && <Button size="sm" onClick={() => setEditing(null)}><PlusIcon className="w-4 h-4" /> Nuevo rubro</Button>}
    >
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead><tr><th>N°</th><th>Nombre</th><th>Tipo</th><th>Automático</th><th /></tr></thead>
          <tbody>
            {consorcio.rubros.map((r) => (
              <tr key={r.id}>
                <td className="font-mono">{String(r.number).padStart(2, '0')}</td>
                <td>{r.name}</td>
                <td><span className={`badge badge-sm ${r.kind === 'INGRESO' ? 'badge-success' : 'badge-ghost'}`}>{r.kind === 'INGRESO' ? 'Ingreso' : 'Egreso'}</span></td>
                <td className="text-xs whitespace-normal">
                  {r.role ? ROLE_HELP[r.role] : '—'}
                  {r.defaultItemLabel && <div className="text-base-content/60">Texto: “{r.defaultItemLabel}”</div>}
                </td>
                <td className="whitespace-nowrap text-right">
                  {canEdit && <button className="btn btn-ghost btn-xs" onClick={() => setEditing(r)}><PencilIcon className="w-4 h-4" /></button>}
                  {isAdmin && (
                    <button className="btn btn-ghost btn-xs text-error" onClick={() => window.confirm(`¿Borrar el rubro "${r.name}"?`) && hook.removeRubro.mutate(r.id)}>
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RubroModal
        isOpen={editing !== undefined}
        initial={editing || null}
        nextNumber={nextNumber}
        onClose={() => setEditing(undefined)}
        onSave={save}
        loading={hook.createRubro.isPending || hook.updateRubro.isPending}
      />
    </Card>
  )
}
