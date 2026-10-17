// Clasificar uno o varios movimientos: a qué rubro y con qué texto van, o
// excluirlos del informe. Muestra TODO lo que dice el banco del movimiento
// para que se entienda qué es, y por qué el sistema no lo pudo decidir solo.
import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import LabelInput from './LabelInput'
import { STATUS_INFO, bulkItems, formatDate, formatMoney, itemLabelOptions } from '../../utils/consorcio'

function MovementDetail({ m }) {
  return (
    <div className="rounded-box bg-base-200 p-3 text-sm space-y-1">
      <div className="flex justify-between gap-2">
        <span>{formatDate(m.date)} · Código {m.conceptCode}{m.voucher ? ` · Comprobante ${m.voucher}` : ''}</span>
        <span className={`font-mono font-semibold ${m.amountCents < 0 ? 'text-error' : 'text-success'}`}>{formatMoney(m.amountCents)}</span>
      </div>
      <div className="font-medium break-words">{m.description}</div>
      {m.cuit && <div>CUIT {m.cuit}{m.counterparty ? ` — ${m.counterparty}` : ''}{m.ownAccount ? ' (cuenta de la misma titular)' : ''}</div>}
      <div className="text-xs">
        <span className={`badge badge-sm ${STATUS_INFO[m.status].badge} mr-1`}>{STATUS_INFO[m.status].label}</span>
        {m.reason}
      </div>
    </div>
  )
}

export default function ClassifyModal({ isOpen, onClose, movements, rubros, report, year, month, onSubmit, loading }) {
  const [action, setAction] = useState('ASIGNAR')
  const [rubroId, setRubroId] = useState('')
  const [itemLabel, setItemLabel] = useState('')
  const [note, setNote] = useState('')
  const [remember, setRemember] = useState('')
  const [error, setError] = useState(null)
  const single = movements.length === 1 ? movements[0] : null

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setNote(single?.note || '')
    setRemember('')
    if (single && single.rubroId && single.status !== 'PENDIENTE') {
      setAction('ASIGNAR')
      setRubroId(single.rubroId)
      setItemLabel(single.itemLabel || '')
    } else {
      setAction('ASIGNAR')
      setRubroId('')
      setItemLabel('')
    }
  }, [isOpen, single])

  const suggestions = useMemo(() => {
    const map = new Map()
    for (const m of movements) for (const s of m.suggestions || []) map.set(`${s.rubroId}|${s.itemLabel}`, s)
    return [...map.values()]
  }, [movements])

  const canRemember = movements.every((m) => m.cuit || m.counterparty)
  const rememberBy = single ? (single.cuit ? `el CUIT ${single.cuit}` : `el nombre "${single.counterparty}"`) : 'el CUIT (o el nombre) de cada uno'
  const total = movements.reduce((s, m) => s + m.amountCents, 0)
  const rubroName = (id) => {
    const r = rubros.find((x) => x.id === id)
    return r ? `${String(r.number).padStart(2, '0')} ${r.name}` : ''
  }

  const pickRubro = (id) => {
    setRubroId(id)
    const r = rubros.find((x) => x.id === id)
    if (!itemLabel && r?.defaultItemLabel) setItemLabel(r.defaultItemLabel)
  }

  const submit = () => {
    if (action === 'ASIGNAR' && (!rubroId || !itemLabel.trim())) return setError('Elegí el rubro y escribí el texto que va en el informe.')
    if (action === 'EXCLUIR' && !note.trim()) return setError('Escribí por qué no va en el informe (queda registrado).')
    setError(null)
    onSubmit(bulkItems(movements.map((m) => m.id), { action, rubroId, itemLabel: itemLabel.trim(), note: note.trim(), remember }))
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="full"
      title={single ? 'Clasificar movimiento' : `Clasificar ${movements.length} movimientos (${formatMoney(total)})`}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} loading={loading}>Guardar</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {single ? <MovementDetail m={single} /> : (
          <div className="max-h-48 overflow-y-auto space-y-2">{movements.map((m) => <MovementDetail key={m.id} m={m} />)}</div>
        )}

        <div className="flex flex-wrap gap-4">
          {[['ASIGNAR', 'Va en el informe'], ['EXCLUIR', 'No va en el informe'], ['AUTO', 'Volver a lo automático / reglas']].map(([v, l]) => (
            <label key={v} className="label cursor-pointer gap-2">
              <input type="radio" className="radio radio-sm" checked={action === v} onChange={() => setAction(v)} />
              <span className="label-text">{l}</span>
            </label>
          ))}
        </div>

        {action === 'ASIGNAR' && (
          <>
            {suggestions.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Opciones usadas antes para esta contraparte:</div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={`${s.rubroId}|${s.itemLabel}`}
                      type="button"
                      className={`btn btn-sm ${rubroId === s.rubroId && itemLabel === s.itemLabel ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => { setRubroId(s.rubroId); setItemLabel(s.itemLabel) }}
                    >
                      {rubroName(s.rubroId)} · {s.itemLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">Rubro</span></label>
                <select className="select select-bordered" value={rubroId} onChange={(e) => pickRubro(e.target.value)}>
                  <option value="">Elegí…</option>
                  {rubros.map((r) => <option key={r.id} value={r.id}>{String(r.number).padStart(2, '0')} {r.name}</option>)}
                </select>
              </div>
              <LabelInput id="classify-label" value={itemLabel} onChange={setItemLabel} year={year} month={month} options={itemLabelOptions(report, rubroId)} />
            </div>
            <p className="text-xs text-base-content/60">
              Los movimientos con el mismo rubro y el mismo texto se suman en una sola línea del informe (ej. dos pagos de vigilancia → una línea).
            </p>
            <div className="form-control">
              <label className="label"><span className="label-text font-medium">¿Recordar para los próximos meses?</span></label>
              <select className="select select-bordered" value={remember} onChange={(e) => setRemember(e.target.value)} disabled={!canRemember}>
                <option value="">No, sólo este mes</option>
                <option value="SIEMPRE">Sí: siempre va acá (se clasifica solo)</option>
                <option value="PREGUNTAR">Sí, pero preguntarme cada mes (lo sugiere)</option>
              </select>
              <span className="text-xs text-base-content/60 mt-1">
                {canRemember
                  ? `Se guarda una regla por ${rememberBy}. Usá "preguntarme" si a esta contraparte le pagás cosas distintas.`
                  : 'No se puede recordar: este movimiento no tiene CUIT ni nombre, y una regla agarraría todos los movimientos parecidos.'}
              </span>
            </div>
          </>
        )}

        {action !== 'AUTO' && (
          <div className="form-control">
            <label className="label"><span className="label-text font-medium">Nota {action === 'EXCLUIR' ? '(obligatoria)' : '(opcional)'}</span></label>
            <textarea className="textarea textarea-bordered" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={action === 'EXCLUIR' ? 'Ej. devolución a un propietario, no es gasto del consorcio' : ''} />
          </div>
        )}
        {action === 'AUTO' && (
          <p className="text-sm text-base-content/70">Se descarta lo elegido a mano y se vuelve a clasificar con el código del banco y las reglas guardadas.</p>
        )}
        {error && <div className="alert alert-error text-sm">{error}</div>}
      </div>
    </Modal>
  )
}
