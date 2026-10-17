// Rendición del mes: a la izquierda los movimientos del extracto (qué es cada
// uno y cómo se clasificó), a la derecha cómo queda el informe. Cuando no queda
// nada pendiente se baja el Word / PDF y se cierra el mes.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeftIcon, ArrowPathIcon, CheckCircleIcon, DocumentArrowDownIcon, ExclamationTriangleIcon, LockClosedIcon, LockOpenIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useRendicion } from '../../hooks/useConsorcios'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import ClassifyModal from './ClassifyModal'
import ReportPreview from './ReportPreview'
import { AjusteModal, ManualLineModal, ReservaModal } from './LineModals'
import { useCanEdit } from './permissions'
import {
  FILTERS, STATUS_INFO, blockerSummary, countByStatus, filterMovements, formatDate, formatMoney, monthName, moveLine,
  renderLabelPreview,
} from '../../utils/consorcio'

function rubroLabel(rubros, id) {
  const r = rubros.find((x) => x.id === id)
  return r ? `${String(r.number).padStart(2, '0')} ${r.name}` : '?'
}

function MovementsTable({ movimientos, rubros, editable, selected, setSelected, onOpen, year, month }) {
  const [filter, setFilter] = useState(() => (movimientos.some((m) => m.status === 'PENDIENTE') ? 'PENDIENTES' : 'TODOS'))
  const [search, setSearch] = useState('')
  const rows = filterMovements(movimientos, filter, search)
  const allSelected = rows.length > 0 && rows.every((m) => selected.has(m.id))
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="join">
          {FILTERS.map((f) => (
            <button key={f.value} className={`btn btn-xs join-item ${filter === f.value ? 'btn-active' : ''}`} onClick={() => setFilter(f.value)}>{f.label}</button>
          ))}
        </div>
        <input className="input input-bordered input-xs w-48" placeholder="Buscar nombre, CUIT, importe…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-base-content/60">{rows.length} movimientos</span>
      </div>
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
        <table className="table table-xs table-pin-rows">
          <thead>
            <tr>
              {editable && (
                <th>
                  <input type="checkbox" className="checkbox checkbox-xs" checked={allSelected}
                    onChange={() => setSelected((s) => {
                      const n = new Set(s)
                      rows.forEach((m) => (allSelected ? n.delete(m.id) : n.add(m.id)))
                      return n
                    })} />
                </th>
              )}
              <th>Fecha</th><th>Movimiento</th><th className="text-right">Importe</th><th>Estado y destino</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`hover cursor-pointer ${m.status === 'PENDIENTE' ? 'bg-error/5' : ''}`} onClick={() => editable && onOpen([m])}>
                {editable && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="checkbox checkbox-xs" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                  </td>
                )}
                <td className="whitespace-nowrap">{formatDate(m.date)}</td>
                <td className="whitespace-normal min-w-[14rem]">
                  <div className="font-medium">{m.counterparty || m.description}</div>
                  <div className="text-base-content/60">
                    Cód. {m.conceptCode}{m.cuit ? ` · CUIT ${m.cuit}` : ''}{m.counterparty ? ` · ${m.description}` : ''}
                  </div>
                </td>
                <td className={`text-right font-mono whitespace-nowrap ${m.amountCents < 0 ? 'text-error' : 'text-success'}`}>{formatMoney(m.amountCents)}</td>
                <td className="whitespace-normal min-w-[14rem]">
                  <span className={`badge badge-sm ${STATUS_INFO[m.status].badge}`} title={STATUS_INFO[m.status].help}>{STATUS_INFO[m.status].label}</span>
                  {m.rubroId && m.status !== 'EXCLUIDO' && (
                    <span className="ml-1">{rubroLabel(rubros, m.rubroId)} · «{renderLabelPreview(m.itemLabel, year, month).text}»</span>
                  )}
                  <div className="text-base-content/60">{m.reason}</div>
                  {m.note && <div className="italic">Nota: {m.note}</div>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center py-6 text-base-content/60">
                {filter === 'PENDIENTES' ? '¡No queda nada pendiente!' : 'No hay movimientos con ese filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function RendicionPage() {
  const { rid } = useParams()
  const navigate = useNavigate()
  const groupId = useAuthStore((s) => s.currentGroupId)
  const r = useRendicion(groupId, rid)
  const { canEdit, isAdmin } = useCanEdit()
  const [selected, setSelected] = useState(new Set())
  const [classifying, setClassifying] = useState(null) // movimientos en el modal
  const [adjusting, setAdjusting] = useState(null) // línea
  const [manualOpen, setManualOpen] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)

  const data = r.data
  const counts = useMemo(() => countByStatus(data?.movimientos || []), [data])

  if (r.isLoading) return <div className="flex justify-center py-12"><span className="loading loading-spinner loading-lg" /></div>
  if (r.error || !data) {
    return <div className="alert alert-error">{r.error?.response?.data?.message || 'No se encontró la rendición.'}</div>
  }

  const { rendicion, consorcio, rubros, movimientos, ajustes, report } = data
  const closed = rendicion.status === 'CERRADA'
  const editable = canEdit && !closed
  const blockers = blockerSummary(report)
  const ajusteFor = (line) => line && ajustes.find((a) => a.id === line.adjustment?.adjustmentId)

  const saveAdjust = ({ amountCents, note }) => {
    const existing = ajusteFor(adjusting)
    const done = { onSuccess: () => setAdjusting(null) }
    if (existing) r.updateAjuste.mutate({ id: existing.id, amountCents, note }, done)
    else r.createAjuste.mutate({ kind: 'AJUSTE', rubroId: adjusting.rubroId, itemLabel: adjusting.template, amountCents, note }, done)
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/consorcios/${consorcio.id}`} className="btn btn-ghost btn-sm mb-1"><ArrowLeftIcon className="w-4 h-4" /> {consorcio.name}</Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Rendición {monthName(rendicion.month)} {rendicion.year}
            <span className={`badge ${closed ? 'badge-success' : 'badge-warning'}`}>{closed ? 'Cerrada' : 'Borrador'}</span>
          </h1>
          <p className="text-sm text-base-content/60">{rendicion.fileName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="tooltip tooltip-bottom" data-tip={blockers.length ? blockers.join(' ') : 'Descargar'}>
            <Button size="sm" variant="outline" disabled={!report.canGenerate} onClick={() => r.download('docx')}>
              <DocumentArrowDownIcon className="w-4 h-4" /> Word
            </Button>
          </div>
          <div className="tooltip tooltip-bottom" data-tip={blockers.length ? blockers.join(' ') : 'Descargar'}>
            <Button size="sm" variant="outline" disabled={!report.canGenerate} onClick={() => r.download('pdf')}>
              <DocumentArrowDownIcon className="w-4 h-4" /> PDF
            </Button>
          </div>
          {editable && (
            <>
              <Button size="sm" variant="ghost" loading={r.reapply.isPending} onClick={() => r.reapply.mutate()} title="Volver a aplicar las reglas a todo lo que no elegiste a mano">
                <ArrowPathIcon className="w-4 h-4" /> Reaplicar reglas
              </Button>
              <Button size="sm" variant="success" disabled={!report.canGenerate} loading={r.close.isPending}
                onClick={() => window.confirm(`¿Cerrar ${monthName(rendicion.month)} ${rendicion.year}? El Total Caja ${formatMoney(report.totals.totalCajaCents)} pasa como Reserva Caja del mes siguiente y la rendición queda bloqueada.`) && r.close.mutate()}>
                <LockClosedIcon className="w-4 h-4" /> Cerrar mes
              </Button>
            </>
          )}
          {closed && isAdmin && (
            <Button size="sm" variant="warning" loading={r.reopen.isPending}
              onClick={() => window.confirm('¿Reabrir la rendición? Vas a poder modificarla y el Total Caja deja de estar congelado.') && r.reopen.mutate()}>
              <LockOpenIcon className="w-4 h-4" /> Reabrir
            </Button>
          )}
          {!closed && isAdmin && (
            <Button size="sm" variant="ghost" className="text-error"
              onClick={() => window.confirm('¿Borrar esta rendición? Se pierden las clasificaciones manuales y los ajustes de este mes.') && r.remove.mutate(undefined, { onSuccess: () => navigate(`/consorcios/${consorcio.id}`) })}>
              Borrar
            </Button>
          )}
        </div>
      </div>

      {/* Control del extracto */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="stat bg-base-100 rounded-box shadow">
          <div className="stat-title">Extracto bancario</div>
          <div className="stat-value text-base flex items-center gap-1"><CheckCircleIcon className="w-5 h-5 text-success" /> Cuadra</div>
          <div className="stat-desc whitespace-normal">
            {formatMoney(rendicion.openingBalanceCents)} + movimientos = {formatMoney(rendicion.closingBalanceCents)} (del {formatDate(rendicion.periodFrom)} al {formatDate(rendicion.periodTo)})
          </div>
        </div>
        <div className="stat bg-base-100 rounded-box shadow">
          <div className="stat-title">Movimientos ({movimientos.length})</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.entries(counts).filter(([, n]) => n > 0).map(([s, n]) => (
              <span key={s} className={`badge ${STATUS_INFO[s].badge}`} title={STATUS_INFO[s].help}>{STATUS_INFO[s].label}: {n}</span>
            ))}
          </div>
        </div>
        <div className="stat bg-base-100 rounded-box shadow">
          <div className="stat-title">Total Caja{!report.canGenerate && ' (provisorio: falta completar)'}</div>
          <div className="stat-value text-xl font-mono">{formatMoney(report.totals.totalCajaCents)}</div>
          <div className="stat-desc whitespace-normal">
            {report.control.differenceCents === 0
              ? 'Coincide con el saldo final del banco.'
              : `Diferencia con el saldo del banco: ${formatMoney(report.control.differenceCents)} (excluidos ${formatMoney(report.control.excludedCents)} + ajustes + reserva).`}
          </div>
        </div>
      </div>

      {/* Qué falta / avisos */}
      {!closed && blockers.length > 0 && (
        <div className="alert alert-warning items-start">
          <ExclamationTriangleIcon className="w-6 h-6" />
          <div>
            <div className="font-semibold">Para generar el informe falta:</div>
            <ul className="list-disc ml-5 text-sm">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        </div>
      )}
      {report.warnings.filter((w) => w.code !== 'BANK_DIFFERENCE').map((w) => (
        <div key={w.message} className="alert text-sm">{w.message}</div>
      ))}

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Movimientos del extracto"
          subtitle={editable ? 'Hacé click en un movimiento para ver todo el detalle y decidir a qué rubro va.' : null}>
          {editable && selected.size > 0 && (
            <div className="flex items-center gap-2 bg-base-200 rounded-box p-2 text-sm">
              <span>{selected.size} seleccionados</span>
              <Button size="xs" onClick={() => setClassifying(movimientos.filter((m) => selected.has(m.id)))}>Clasificar juntos</Button>
              <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Limpiar</Button>
            </div>
          )}
          <MovementsTable movimientos={movimientos} rubros={rubros} editable={editable} selected={selected} setSelected={setSelected} onOpen={setClassifying} year={rendicion.year} month={rendicion.month} />
        </Card>

        <Card className="xl:col-span-2" title="Así queda el informe"
          subtitle="Abrí cada línea para ver de qué movimientos sale. Se puede ajustar el monto (con nota) y cambiar el orden.">
          <ReportPreview
            report={report}
            ajustes={ajustes}
            editable={editable}
            onMove={(key, dir) => r.setOrder.mutate(moveLine(report, key, dir))}
            onAdjust={setAdjusting}
            onRemoveAdjust={(id) => r.removeAjuste.mutate(id)}
            onAddManual={() => setManualOpen(true)}
            onEditReserve={() => setReserveOpen(true)}
          />
          {report.excluded.length > 0 && (
            <div className="mt-4 text-xs">
              <div className="font-semibold">No van en el informe:</div>
              {report.excluded.map((e) => (
                <div key={e.movementId} className="flex justify-between gap-2">
                  <span>{formatDate(e.date)} · {e.description} — <i>{e.note}</i></span>
                  <span className="font-mono">{formatMoney(e.amountCents)}</span>
                </div>
              ))}
            </div>
          )}
          {editable && report.totals.reserveCents == null && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setReserveOpen(true)}>Cargar Reserva Caja</Button>
          )}
        </Card>
      </div>

      <ClassifyModal
        isOpen={!!classifying}
        movements={classifying || []}
        rubros={rubros}
        report={report}
        year={rendicion.year}
        month={rendicion.month}
        loading={r.classify.isPending}
        onClose={() => setClassifying(null)}
        onSubmit={(items) => r.classify.mutate(items, { onSuccess: () => { setClassifying(null); setSelected(new Set()) } })}
      />
      <AjusteModal
        line={adjusting}
        ajuste={ajusteFor(adjusting)}
        loading={r.createAjuste.isPending || r.updateAjuste.isPending}
        onClose={() => setAdjusting(null)}
        onSave={saveAdjust}
        onRemove={() => r.removeAjuste.mutate(ajusteFor(adjusting).id, { onSuccess: () => setAdjusting(null) })}
      />
      <ManualLineModal
        isOpen={manualOpen}
        rubros={rubros}
        year={rendicion.year}
        month={rendicion.month}
        loading={r.createAjuste.isPending}
        onClose={() => setManualOpen(false)}
        onSave={(body) => r.createAjuste.mutate(body, { onSuccess: () => setManualOpen(false) })}
      />
      <ReservaModal
        isOpen={reserveOpen}
        rendicion={rendicion}
        report={report}
        loading={r.setReserve.isPending}
        onClose={() => setReserveOpen(false)}
        onSave={(body) => r.setReserve.mutate(body, { onSuccess: () => setReserveOpen(false) })}
      />
    </div>
  )
}
