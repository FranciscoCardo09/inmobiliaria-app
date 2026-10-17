// Detalle de un consorcio: rendiciones (subir extracto), reglas, rubros y datos.
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeftIcon, ArrowUpTrayIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useConsorcio } from '../../hooks/useConsorcios'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import ConsorcioFormModal from './ConsorcioFormModal'
import ReglasTab from './ReglasTab'
import RubrosTab from './RubrosTab'
import { useCanEdit } from './permissions'
import { formatMoney, monthName, stripDataUrl } from '../../utils/consorcio'

const TABS = [
  { id: 'rendiciones', label: 'Rendiciones' },
  { id: 'reglas', label: 'Reglas de clasificación' },
  { id: 'rubros', label: 'Rubros del informe' },
]

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(stripDataUrl(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function UploadCard({ hook, canEdit }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [pending, setPending] = useState(null) // { fileBase64, fileName, message }
  const [error, setError] = useState(null)

  const send = (payload) => {
    setError(null)
    hook.upload.mutate(payload, {
      onSuccess: (res) => {
        setPending(null)
        toast.success(res.replaced
          ? `Extracto reemplazado. Se conservaron ${res.keptManual} clasificaciones manuales.`
          : 'Extracto leído y conciliado. Revisá lo pendiente.')
        navigate(`/consorcios/rendiciones/${res.rendicionId}`)
      },
      onError: (e) => {
        const body = e.response?.data || {}
        if (body.code === 'REQUIRES_REPLACE') return setPending({ ...payload, message: body.message })
        setPending(null)
        setError({ message: body.message || 'No se pudo leer el extracto.', rendicionId: body.details?.rendicionId, code: body.code })
      },
    })
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    send({ fileBase64: await readFileBase64(file), fileName: file.name })
  }

  if (!canEdit) return null
  return (
    <Card title="Subir extracto del mes" subtitle="El PDF del banco tal como lo descargás del home banking.">
      <p className="text-sm text-base-content/70">
        Se leen todos los movimientos y se controla que el saldo inicial más los movimientos dé cada saldo diario y el saldo final.
        Si algo no cierra, el extracto se rechaza y te digo qué renglón falla: nunca se arma un informe con un PDF mal leído.
      </p>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onFile} />
      <div>
        <Button onClick={() => inputRef.current?.click()} loading={hook.upload.isPending}>
          <ArrowUpTrayIcon className="w-5 h-5" /> Elegir PDF
        </Button>
      </div>
      {error && (
        <div className="alert alert-error text-sm mt-2 flex-col items-start">
          <span>{error.message}</span>
          {error.rendicionId && <Link className="link" to={`/consorcios/rendiciones/${error.rendicionId}`}>Abrir esa rendición</Link>}
        </div>
      )}
      <Modal
        isOpen={!!pending}
        onClose={() => setPending(null)}
        title="¿Reemplazar el extracto?"
        actions={(
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>Cancelar</Button>
            <Button variant="warning" loading={hook.upload.isPending} onClick={() => send({ fileBase64: pending.fileBase64, fileName: pending.fileName, replace: true })}>
              Reemplazar
            </Button>
          </>
        )}
      >
        <p>{pending?.message}</p>
      </Modal>
    </Card>
  )
}

function RendicionesList({ rendiciones }) {
  if (!rendiciones.length) {
    return <p className="text-sm text-base-content/60">Todavía no subiste ningún extracto.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr><th>Mes</th><th>Estado</th><th className="text-right">Saldo final banco</th><th className="text-right">Total Caja</th><th>Archivo</th><th /></tr>
        </thead>
        <tbody>
          {rendiciones.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{monthName(r.month)} {r.year}</td>
              <td>
                <span className={`badge ${r.status === 'CERRADA' ? 'badge-success' : 'badge-warning'}`}>
                  {r.status === 'CERRADA' ? 'Cerrada' : 'Borrador'}
                </span>
              </td>
              <td className="text-right font-mono">{formatMoney(r.closingBalanceCents)}</td>
              <td className="text-right font-mono">{r.totalCajaCents != null ? formatMoney(r.totalCajaCents) : '—'}</td>
              <td className="text-xs text-base-content/60">{r.fileName || ''}</td>
              <td><Link className="btn btn-xs btn-primary" to={`/consorcios/rendiciones/${r.id}`}>Abrir</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ConsorcioDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const groupId = useAuthStore((s) => s.currentGroupId)
  const hook = useConsorcio(groupId, id)
  const { canEdit, isAdmin } = useCanEdit()
  const [tab, setTab] = useState('rendiciones')
  const [editing, setEditing] = useState(false)
  const { consorcio } = hook

  if (hook.isLoading || !consorcio) {
    return <div className="flex justify-center py-12"><span className="loading loading-spinner loading-lg" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/consorcios" className="btn btn-ghost btn-sm mb-1"><ArrowLeftIcon className="w-4 h-4" /> Consorcios</Link>
          <h1 className="text-2xl font-bold">{consorcio.name}</h1>
          <p className="text-sm text-base-content/60">
            {consorcio.bankAccountName && <>{consorcio.bankAccountName} · </>}CBU <span className="font-mono">{consorcio.cbu}</span>
            {consorcio.initialReserveCents != null && <> · Reserva inicial {formatMoney(consorcio.initialReserveCents)}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Editar datos</Button>}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="text-error"
              onClick={() => {
                if (window.confirm(`¿Borrar el consorcio "${consorcio.name}"? Sólo se puede si no tiene rendiciones.`)) {
                  hook.remove.mutate(undefined, { onSuccess: () => navigate('/consorcios') })
                }
              }}
            >
              Borrar
            </Button>
          )}
        </div>
      </div>

      <div role="tablist" className="tabs tabs-boxed w-fit">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'rendiciones' && (
        <div className="space-y-4">
          <UploadCard hook={hook} canEdit={canEdit} />
          <Card title={<span className="flex items-center gap-2"><DocumentTextIcon className="w-5 h-5" /> Rendiciones</span>}>
            <RendicionesList rendiciones={hook.rendiciones} />
          </Card>
        </div>
      )}
      {tab === 'reglas' && <ReglasTab consorcio={consorcio} hook={hook} canEdit={canEdit} />}
      {tab === 'rubros' && <RubrosTab consorcio={consorcio} hook={hook} canEdit={canEdit} isAdmin={isAdmin} />}

      <ConsorcioFormModal
        isOpen={editing}
        initial={consorcio}
        onClose={() => setEditing(false)}
        loading={hook.update.isPending}
        onSubmit={(data) => hook.update.mutate(data, { onSuccess: () => setEditing(false) })}
      />
    </div>
  )
}
