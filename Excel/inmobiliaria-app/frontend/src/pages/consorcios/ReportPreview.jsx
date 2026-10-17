// Vista previa del informe, igual a lo que sale en el Word/PDF, pero cada línea
// se puede abrir para ver de qué movimientos sale, ajustar su monto (con nota)
// o moverla de lugar.
import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { STATUS_INFO, formatDate, formatMoney } from '../../utils/consorcio'

const RESERVE_SOURCE = {
  ANTERIOR: 'Total Caja de la rendición cerrada del mes anterior',
  INICIAL: 'Reserva inicial cargada en el consorcio',
  MANUAL: 'Cargada a mano en esta rendición',
}

function Line({ line, editable, isFirst, isLast, onMove, onAdjust, onRemoveAdjust, onEditReserve, reserveSource, ajustes }) {
  const [open, setOpen] = useState(false)
  const manualIds = line.manualSources.map((s) => s.adjustmentId)
  const hasDetail = line.sources.length > 0 || line.manualSources.length > 0 || line.adjustment || line.isReserve
  return (
    <li className="py-1">
      <div className="flex items-start gap-1">
        <button type="button" className="btn btn-ghost btn-xs px-1" onClick={() => setOpen(!open)} disabled={!hasDetail} aria-label="Ver detalle">
          {open ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
        </button>
        <span className="flex-1 break-words">- {line.label}</span>
        {line.adjustment && <span className="badge badge-warning badge-sm" title={line.adjustment.note}>ajustado</span>}
        <span className={`font-mono whitespace-nowrap ${line.finalCents < 0 ? 'text-error' : ''}`}>{formatMoney(line.finalCents)}</span>
        {editable && (
          <span className="flex">
            <button type="button" className="btn btn-ghost btn-xs px-1" disabled={isFirst} onClick={() => onMove(line.key, 'up')} title="Subir"><ChevronUpIcon className="w-3 h-3" /></button>
            <button type="button" className="btn btn-ghost btn-xs px-1" disabled={isLast} onClick={() => onMove(line.key, 'down')} title="Bajar"><ChevronDownIcon className="w-3 h-3" /></button>
            {line.isReserve
              ? <button type="button" className="btn btn-ghost btn-xs px-1" onClick={onEditReserve} title="Cambiar la reserva"><PencilSquareIcon className="w-3 h-3" /></button>
              : <button type="button" className="btn btn-ghost btn-xs px-1" onClick={() => onAdjust(line)} title="Ajustar monto"><PencilSquareIcon className="w-3 h-3" /></button>}
          </span>
        )}
      </div>
      {open && (
        <div className="ml-6 mt-1 mb-2 text-xs space-y-1 rounded-box bg-base-200 p-2">
          {line.isReserve && <div>Sale de: {RESERVE_SOURCE[reserveSource] || '—'}</div>}
          {line.sources.map((s) => (
            <div key={s.movementId} className="flex justify-between gap-2">
              <span>
                {formatDate(s.date)} · {s.description}
                <span className={`badge badge-xs ml-1 ${STATUS_INFO[s.status].badge}`}>{STATUS_INFO[s.status].label}</span>
              </span>
              <span className="font-mono whitespace-nowrap">{formatMoney(s.amountCents)}</span>
            </div>
          ))}
          {line.manualSources.map((s) => (
            <div key={s.adjustmentId} className="flex justify-between gap-2">
              <span>Línea manual: {s.note}</span>
              <span className="flex items-center gap-1">
                <span className="font-mono">{formatMoney(s.amountCents)}</span>
                {editable && <button type="button" className="btn btn-ghost btn-xs px-1 text-error" onClick={() => onRemoveAdjust(s.adjustmentId)}><TrashIcon className="w-3 h-3" /></button>}
              </span>
            </div>
          ))}
          {line.sources.length + manualIds.length > 1 && (
            <div className="flex justify-between border-t border-base-300 pt-1"><span>Suma</span><span className="font-mono">{formatMoney(line.computedCents)}</span></div>
          )}
          {line.adjustment && (
            <div className="text-warning-content bg-warning/20 rounded p-1 flex justify-between gap-2">
              <span>
                Ajustado de {formatMoney(line.adjustment.fromCents)} a {formatMoney(line.adjustment.toCents)} ({line.adjustment.differenceCents > 0 ? '+' : ''}{formatMoney(line.adjustment.differenceCents)}): {line.adjustment.note}
              </span>
              {editable && ajustes.some((a) => a.id === line.adjustment.adjustmentId) && (
                <button type="button" className="btn btn-ghost btn-xs px-1 text-error" title="Quitar ajuste" onClick={() => onRemoveAdjust(line.adjustment.adjustmentId)}><TrashIcon className="w-3 h-3" /></button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function ReportPreview({ report, ajustes, editable, onMove, onAdjust, onRemoveAdjust, onAddManual, onEditReserve }) {
  const num = (n) => String(n).padStart(2, '0')
  return (
    <div className="text-sm">
      <div className="font-bold underline">{report.title}</div>
      <div className="font-semibold mb-3">{report.subtitle}</div>
      {report.sections.map((section) => (
        <div key={section.rubro.id} className="mb-2">
          <div className={`font-semibold ${section.lines.length ? '' : 'text-base-content/40'}`}>
            {num(section.rubro.number)}- {section.rubro.name}
            {!section.lines.length && <span className="font-normal text-xs ml-2">(sin movimientos: no se imprime)</span>}
          </div>
          <ul>
            {section.lines.map((line, i) => (
              <Line
                key={line.key}
                line={line}
                editable={editable}
                isFirst={i === 0}
                isLast={i === section.lines.length - 1}
                onMove={onMove}
                onAdjust={onAdjust}
                onRemoveAdjust={onRemoveAdjust}
                onEditReserve={onEditReserve}
                reserveSource={report.totals.reserveSource}
                ajustes={ajustes}
              />
            ))}
          </ul>
        </div>
      ))}
      {editable && (
        <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={onAddManual}>
          <PlusIcon className="w-3 h-3" /> Agregar línea sin movimiento (ej. pago en efectivo)
        </button>
      )}
      <div className="flex justify-between font-bold border-t border-base-300 mt-3 pt-2">
        <span>{num(report.total.number)}- {report.total.label}</span>
        <span className="font-mono">{formatMoney(report.totals.totalCajaCents)}</span>
      </div>
      <div className="text-xs text-base-content/60 mt-1">
        = Reserva {formatMoney(report.totals.reserveCents)} + Ingresos {formatMoney(report.totals.ingresosCents)} − Egresos {formatMoney(report.totals.egresosCents)}
      </div>
    </div>
  )
}
