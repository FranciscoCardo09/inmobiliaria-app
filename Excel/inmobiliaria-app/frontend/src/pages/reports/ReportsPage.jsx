// Reports Page - Phase 6: Professional Reports
import { useState, useMemo } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { numeroATexto } from '../../utils/formatters'
import { useContracts } from '../../hooks/useContracts'
import { useOwners } from '../../hooks/useOwners'
import { useProperties } from '../../hooks/useProperties'
import {
  useLiquidacion,
  useLiquidacionAll,
  useEstadoCuentas,
  useAjustesMes,
  useControlMensual,
  useImpuestos,
  useVencimientos,
  useMonthlyRecordsForPago,
  useReportDownload,
  useSendReportEmail,
} from '../../hooks/useReports'
import MultiSearchableSelect from '../../components/ui/MultiSearchableSelect'
import SearchableSelect from '../../components/ui/SearchableSelect'
import api from '../../services/api'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
import { useNotifications } from '../../hooks/useNotifications'
import SendNotificationModal from '../../components/notifications/SendNotificationModal'
import {
  DocumentTextIcon,
  ArrowDownTrayIcon,
  TableCellsIcon,
  EnvelopeIcon,
  PrinterIcon,
  ChartBarIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  BanknotesIcon,
  AdjustmentsHorizontalIcon,
  CalendarDaysIcon,
  ReceiptPercentIcon,
  BellAlertIcon,
  CodeBracketIcon,
  BellIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline'

const monthNames = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '$0'
  return `$${Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-AR')
}

const StatusBadge = ({ status, isPaid }) => {
  if (isPaid) return <span className="badge badge-sm badge-success">Pagado</span>
  if (status === 'PARTIAL') return <span className="badge badge-sm badge-warning">Parcial</span>
  return <span className="badge badge-sm badge-error">Pendiente</span>
}

// ============================================
// TABS
// ============================================

const TABS = [
  { id: 'pago-efectivo', label: 'Pago Efectivo', icon: BanknotesIcon },
  { id: 'liquidacion', label: 'Liquidación', icon: DocumentTextIcon },
  { id: 'ajustes', label: 'Ajustes', icon: AdjustmentsHorizontalIcon },
  { id: 'control-mensual', label: 'Control Mensual', icon: CalendarDaysIcon },
  { id: 'impuestos', label: 'Impuestos y Servicios', icon: ReceiptPercentIcon },
  { id: 'vencimientos', label: 'Vencimientos', icon: BellAlertIcon },
  { id: 'estado-cuentas', label: 'Estado Cuentas', icon: DocumentDuplicateIcon },
  { id: 'carta-documento', label: 'Carta Documento', icon: ExclamationTriangleIcon },
]

export default function ReportsPage() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const [activeTab, setActiveTab] = useState('pago-efectivo')

  if (!currentGroupId) {
    return <EmptyState title="Sin grupo" description="Selecciona un grupo para ver reportes" />
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <DocumentTextIcon className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-sm text-base-content/60">Generación de reportes profesionales en PDF y Excel</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs tabs-boxed bg-base-200 overflow-x-auto flex-nowrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab gap-2 whitespace-nowrap ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'pago-efectivo' && <PagoEfectivoTab groupId={currentGroupId} />}
      {activeTab === 'liquidacion' && <LiquidacionTab groupId={currentGroupId} />}
      {activeTab === 'ajustes' && <AjustesTab groupId={currentGroupId} />}
      {activeTab === 'control-mensual' && <ControlMensualTab groupId={currentGroupId} />}
      {activeTab === 'impuestos' && <ImpuestosTab groupId={currentGroupId} />}
      {activeTab === 'vencimientos' && <VencimientosTab groupId={currentGroupId} />}
      {activeTab === 'estado-cuentas' && <EstadoCuentasTab groupId={currentGroupId} />}
      {activeTab === 'carta-documento' && <CartaDocumentoTab groupId={currentGroupId} />}
    </div>
  )
}

// ============================================
// LIQUIDACION TAB - Modern Design with Property Multi-Select
// ============================================

// Helper: compute effective honorarios for a single contract given local gastos selections
function computeHonorariosLocal(data, gastosState, honPct) {
  const sel = gastosState[data.contractId] || {}
  const selectedIds = sel.serviceIds || []
  const extras = sel.extras || []
  const pct = parseFloat(honPct) || 0

  const hasAny = selectedIds.length > 0 || extras.length > 0 || pct > 0
  if (!hasAny) return null

  // Services selected as "paid by me" — base cost only, no extra commission
  const gastosItems = []
  for (const svc of (data.serviciosDisponibles || [])) {
    if (!selectedIds.includes(svc.id)) continue
    gastosItems.push({ concepto: svc.concepto, importe: Math.abs(svc.importe) })
  }
  for (const ex of extras) {
    gastosItems.push({ concepto: ex.concepto || 'Extra', importe: parseFloat(ex.importe) || 0, isExtra: true })
  }

  // Rent honorarios
  const baseHonorarios = Math.max(0, data.total || 0)
  const montoAlquiler = pct > 0 ? Math.round(baseHonorarios * pct / 100 * 100) / 100 : 0
  const totalGastos = gastosItems.reduce((s, g) => s + g.importe, 0)
  const monto = montoAlquiler + totalGastos

  return { porcentaje: pct, baseHonorarios, montoAlquiler, gastosAMiCargo: gastosItems, totalGastos, monto }
}

function LiquidacionTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [selectedContractIds, setSelectedContractIds] = useState([])
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [honorariosPercent, setHonorariosPercent] = useState('')
  // { [contractId]: { serviceIds: string[], extras: { id, concepto, importe }[] } }
  const [gastosAMiCargo, setGastosAMiCargo] = useState({})
  const [soloConPago, setSoloConPago] = useState(true)
  const [showOwnerNotifyModal, setShowOwnerNotifyModal] = useState(false)

  const { contracts } = useContracts(groupId, { status: 'ACTIVE' })
  const { properties } = useProperties(groupId, { isActive: true })
  const { owners } = useOwners(groupId)
  const { sendOwnerReport } = useNotifications(groupId)
  const { data: allData, isLoading } = useLiquidacionAll(groupId, {
    month: String(month),
    year: String(year),
    contractIds: selectedContractIds.length > 0 ? selectedContractIds : undefined,
    ownerId: selectedOwnerId || undefined,
  })
  const { downloadPDFPost, downloadDOCXPost, downloadHTMLPost, downloadExcelPost } = useReportDownload(groupId)

  const contractOptions = useMemo(() => {
    return (contracts || []).map((c) => {
      const type = c.contractType === 'PROPIETARIO' ? 'PROP' : 'INQ'
      const tenant = c.tenants?.[0]?.name || c.tenant?.name || 'Sin inquilino'
      const name = c.contractType === 'PROPIETARIO' ? (c.property?.owner?.name || 'Propietario') : tenant
      return { value: c.id, label: `[${type}] ${c.property?.address || 'Sin dirección'} - ${name}` }
    })
  }, [contracts])

  const filteredData = useMemo(() => {
    const base = allData || []
    return soloConPago ? base.filter((d) => d.isCancelled) : base
  }, [allData, soloConPago])

  // Build effective data applying local gastos selections for preview
  // Services stay in conceptos and total unchanged — gastos only affect honorarios section
  const effectiveData = useMemo(() => {
    return filteredData.map(data => {
      const sel = gastosAMiCargo[data.contractId] || {}
      const selectedIds = sel.serviceIds || []
      const extras = sel.extras || []
      if (selectedIds.length === 0 && extras.length === 0 && !honorariosPercent) return data
      const honorarios = computeHonorariosLocal(data, gastosAMiCargo, honorariosPercent)
      return { ...data, honorarios }
    })
  }, [filteredData, gastosAMiCargo, honorariosPercent])

  const buildPostBody = () => {
    // Build gastosAMiCargo map for POST body
    const gastosBody = {}
    for (const [contractId, sel] of Object.entries(gastosAMiCargo)) {
      if ((sel.serviceIds?.length || 0) > 0 || (sel.extras?.length || 0) > 0) {
        gastosBody[contractId] = {
          serviceIds: sel.serviceIds || [],
          extras: (sel.extras || []).map(e => ({ concepto: e.concepto, importe: parseFloat(e.importe) || 0 })),
          comisionPercent: parseFloat(honorariosPercent) || 0,
        }
      }
    }
    // If "solo con pago" is active, restrict contractIds to only paid ones
    const paidContractIds = soloConPago ? filteredData.map((d) => d.contractId) : null

    return {
      month, year,
      honorariosPercent: honorariosPercent ? parseFloat(honorariosPercent) : undefined,
      contractIds: paidContractIds
        ? paidContractIds
        : selectedContractIds.length > 0 ? selectedContractIds : undefined,
      ownerId: selectedOwnerId || undefined,
      gastosAMiCargo: Object.keys(gastosBody).length > 0 ? gastosBody : undefined,
    }
  }

  const handleDownloadPDF = () => downloadPDFPost('liquidacion-all/pdf', buildPostBody(), `liquidacion-${monthNames[month]?.toLowerCase()}-${year}.pdf`)
  const handleDownloadDOCX = () => downloadDOCXPost('liquidacion-all/docx', buildPostBody(), `liquidacion-${monthNames[month]?.toLowerCase()}-${year}.docx`)
  const handleDownloadHTML = () => downloadHTMLPost('liquidacion-all/html', buildPostBody(), `liquidacion-${monthNames[month]?.toLowerCase()}-${year}.html`)
  const handleDownloadExcel = () => downloadExcelPost('liquidacion/excel', buildPostBody(), `liquidaciones-${monthNames[month]?.toLowerCase()}-${year}.xlsx`)

  // Gastos state helpers
  const toggleService = (contractId, serviceId) => {
    setGastosAMiCargo(prev => {
      const cur = prev[contractId] || { serviceIds: [], extras: [] }
      const ids = cur.serviceIds.includes(serviceId)
        ? cur.serviceIds.filter(id => id !== serviceId)
        : [...cur.serviceIds, serviceId]
      return { ...prev, [contractId]: { ...cur, serviceIds: ids } }
    })
  }

  const addExtra = (contractId) => {
    setGastosAMiCargo(prev => {
      const cur = prev[contractId] || { serviceIds: [], extras: [] }
      return { ...prev, [contractId]: { ...cur, extras: [...cur.extras, { id: Date.now(), concepto: '', importe: '' }] } }
    })
  }

  const updateExtra = (contractId, extraId, field, value) => {
    setGastosAMiCargo(prev => {
      const cur = prev[contractId] || { serviceIds: [], extras: [] }
      return { ...prev, [contractId]: { ...cur, extras: cur.extras.map(e => e.id === extraId ? { ...e, [field]: value } : e) } }
    })
  }

  const removeExtra = (contractId, extraId) => {
    setGastosAMiCargo(prev => {
      const cur = prev[contractId] || { serviceIds: [], extras: [] }
      return { ...prev, [contractId]: { ...cur, extras: cur.extras.filter(e => e.id !== extraId) } }
    })
  }

  const allTransactions = useMemo(() => {
    const txns = []
    for (const d of effectiveData) {
      for (const t of (d.transacciones || [])) {
        txns.push({ ...t, inquilino: t.inquilino || d.inquilino.nombre })
      }
    }
    txns.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    return txns
  }, [effectiveData])

  const grandTotal = useMemo(() => effectiveData.reduce((s, d) => s + d.total, 0), [effectiveData])
  const grandSubtotalAlquileres = useMemo(() => effectiveData.reduce((s, d) => s + (d.subtotalAlquileres || 0), 0), [effectiveData])
  const totalPagado = useMemo(() => allTransactions.reduce((s, t) => s + t.monto, 0), [allTransactions])
  const saldo = grandTotal - totalPagado

  return (
    <div className="space-y-4">
      <Card title="Liquidación Mensual">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Mes</span></label>
            <select className="select select-bordered select-sm w-full" value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
              {monthNames.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Honorarios %</span></label>
            <input
              type="number"
              className="input input-bordered input-sm w-full"
              placeholder="Ej: 5"
              value={honorariosPercent}
              onChange={(e) => setHonorariosPercent(e.target.value)}
              min="0" max="100" step="0.5"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label"><span className="label-text text-xs font-semibold">Filtrar por contratos (opcional)</span></label>
            <MultiSearchableSelect
              options={contractOptions}
              value={selectedContractIds}
              onChange={setSelectedContractIds}
              placeholder="Todos los contratos..."
            />
            {selectedContractIds.length > 0 && (
              <p className="text-xs text-base-content/60 mt-2">{selectedContractIds.length} contrato(s) seleccionado(s)</p>
            )}
          </div>
          <div>
            <SearchableSelect
              label="Filtrar por dueño (opcional)"
              name="ownerId"
              options={(owners || []).map((owner) => ({ value: owner.id, label: owner.name }))}
              value={selectedOwnerId}
              onChange={(e) => setSelectedOwnerId(e?.target?.value ?? e ?? '')}
              placeholder="Todos los dueños..."
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            id="soloConPago"
            className="checkbox checkbox-sm checkbox-primary"
            checked={soloConPago}
            onChange={(e) => setSoloConPago(e.target.checked)}
          />
          <label htmlFor="soloConPago" className="text-sm cursor-pointer select-none">
            Solo contratos con cancelación en este período
          </label>
        </div>

        {/* Download buttons row */}
        <div className="mt-4 pt-3 border-t border-base-300">
          <p className="text-xs text-base-content/60 mb-2">Descargar liquidación</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleDownloadPDF} className="btn-sm btn-neutral gap-1.5" disabled={!effectiveData || effectiveData.length === 0}>
              <ArrowDownTrayIcon className="w-4 h-4" /> PDF
            </Button>
            <Button onClick={handleDownloadDOCX} className="btn-sm btn-outline gap-1.5" disabled={!effectiveData || effectiveData.length === 0}>
              <DocumentTextIcon className="w-4 h-4" /> DOCX
            </Button>
            <Button onClick={handleDownloadHTML} className="btn-sm btn-outline gap-1.5" disabled={!effectiveData || effectiveData.length === 0}>
              <CodeBracketIcon className="w-4 h-4" /> HTML
            </Button>
            <Button onClick={handleDownloadExcel} className="btn-sm btn-outline gap-1.5" disabled={!effectiveData || effectiveData.length === 0}>
              <TableCellsIcon className="w-4 h-4" /> Excel
            </Button>
            <Button onClick={handleDownloadPDF} className="btn-sm btn-ghost gap-1.5" disabled={!effectiveData || effectiveData.length === 0}>
              <PrinterIcon className="w-4 h-4" /> Imprimir
            </Button>
            {(() => {
              const targetOwners = selectedOwnerId
                ? (owners || []).filter(o => o.id === selectedOwnerId)
                : (owners || [])
              return (
                <Button
                  onClick={() => setShowOwnerNotifyModal(true)}
                  className="btn-sm btn-primary gap-1.5"
                  disabled={!filteredData || filteredData.length === 0 || !targetOwners.length}
                >
                  <BellIcon className="w-4 h-4" /> Enviar a dueños ({targetOwners.length})
                </Button>
              )
            })()}
          </div>
        </div>
      </Card>

      {/* Owner Notification Modal */}
      {showOwnerNotifyModal && (
        <SendNotificationModal
          isOpen={showOwnerNotifyModal}
          onClose={() => setShowOwnerNotifyModal(false)}
          type="REPORT_OWNER"
          recipients={(selectedOwnerId
            ? (owners || []).filter(o => o.id === selectedOwnerId)
            : (owners || [])
          ).map(o => ({ id: o.id, name: o.name, email: o.email, phone: o.phone }))}
          recipientType="OWNER"
          onSend={async ({ channels }) => {
            const body = buildPostBody()
            const targetOwnerIds = selectedOwnerId
              ? [selectedOwnerId]
              : (owners || []).map(o => o.id)
            await sendOwnerReport.mutateAsync({
              ownerIds: targetOwnerIds,
              reportType: 'liquidacion',
              month,
              year,
              channels,
              honorariosPercent: body.honorariosPercent,
              gastosAMiCargo: body.gastosAMiCargo,
              contractIds: body.contractIds,
            })
            setShowOwnerNotifyModal(false)
          }}
          isSending={sendOwnerReport.isPending}
        />
      )}

      {isLoading && <LoadingPage />}

      {!isLoading && filteredData.length === 0 && (
        <Card><p className="text-base-content/60 text-center py-4">No hay liquidaciones para este período</p></Card>
      )}

      {effectiveData.length > 0 && (
        <>
          <Card title="Resumen">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-base-content/60 mb-1">Total Facturado</p>
                <p className="text-xl font-bold">{formatCurrency(grandTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-base-content/60 mb-1">Total Cobrado</p>
                <p className="text-xl font-bold">{formatCurrency(totalPagado)}</p>
              </div>
              <div>
                <p className="text-xs text-base-content/60 mb-1">{saldo > 0 ? 'Saldo Pendiente' : 'Saldo a Favor'}</p>
                <p className="text-xl font-bold">{formatCurrency(Math.abs(saldo))}</p>
              </div>
            </div>
          </Card>

          <Card title={`Detalle - ${monthNames[month]} ${year}`}>
            {effectiveData.map((data, idx) => {
              const addr = [data.propiedad.direccion, data.propiedad.piso ? `Piso ${data.propiedad.piso}` : null, data.propiedad.depto].filter(Boolean).join(', ')
              const selState = gastosAMiCargo[data.contractId] || { serviceIds: [], extras: [] }
              const disponibles = data.serviciosDisponibles || []

              return (
                <div key={idx} className={idx > 0 ? 'mt-4 pt-4 border-t border-base-300' : ''}>
                  <h3 className="font-semibold text-sm mb-2">{addr} - {data.inquilino.nombre}</h3>

                  {/* Conceptos table */}
                  <div className="overflow-x-auto">
                    <table className="table table-xs">
                      <tbody>
                        {data.conceptos.map((c, ci) => {
                          const label = c.concepto.includes('Punitorios (0') ? 'Punitorios' : c.concepto
                          if (c.concepto.includes('Punitorios') && c.importe === 0) return null
                          return (
                            <tr key={ci}>
                              <td className="pl-4">{label}</td>
                              <td className="text-right">{formatCurrency(c.importe)}</td>
                            </tr>
                          )
                        })}
                        <tr className="font-semibold">
                          <td className="pl-4">Subtotal</td>
                          <td className="text-right">{formatCurrency(data.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Gastos a mi cargo — always shown so extras can be added even without services */}
                  {(
                    <div className="mt-3 p-3 bg-base-200/60 rounded-lg border border-base-300">
                      <p className="text-xs font-semibold text-base-content/70 mb-2 uppercase tracking-wide">Gastos a mi cargo</p>

                      {/* Service checkboxes */}
                      {disponibles.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {disponibles.map(svc => (
                            <label key={svc.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-xs checkbox-primary"
                                checked={selState.serviceIds.includes(svc.id)}
                                onChange={() => toggleService(data.contractId, svc.id)}
                              />
                              <span className="text-xs">{svc.concepto}</span>
                              <span className="text-xs text-base-content/50 ml-auto">{formatCurrency(svc.importe)}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* Extra rows */}
                      {selState.extras.map(ex => (
                        <div key={ex.id} className="flex items-center gap-2 mt-1">
                          <input
                            type="text"
                            className="input input-bordered input-xs flex-1"
                            placeholder="Descripción"
                            value={ex.concepto}
                            onChange={e => updateExtra(data.contractId, ex.id, 'concepto', e.target.value)}
                          />
                          <input
                            type="number"
                            className="input input-bordered input-xs w-28"
                            placeholder="Importe"
                            value={ex.importe}
                            onChange={e => updateExtra(data.contractId, ex.id, 'importe', e.target.value)}
                            min="0" step="0.01"
                          />
                          <button
                            className="btn btn-xs btn-ghost text-error"
                            onClick={() => removeExtra(data.contractId, ex.id)}
                          >✕</button>
                        </div>
                      ))}

                      <button
                        className="btn btn-xs btn-ghost mt-2 text-primary"
                        onClick={() => addExtra(data.contractId)}
                      >
                        + Agregar extra
                      </button>
                    </div>
                  )}

                  {/* Honorarios per contract (preview) */}
                  {data.honorarios && (() => {
                    const hon = data.honorarios
                    const gastos = hon.gastosAMiCargo || []
                    return (
                      <div className="mt-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                        <p className="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-2">Honorarios</p>
                        <div className="space-y-1">
                          {hon.porcentaje > 0 && (
                            <div className="flex justify-between text-xs">
                              <span>Honorarios alquiler ({hon.porcentaje}%)</span>
                              <span className="font-medium">{formatCurrency(hon.montoAlquiler)}</span>
                            </div>
                          )}
                          {gastos.map((g, gi) => (
                            <div key={gi} className="flex justify-between text-xs">
                              <span className="text-base-content/70">{g.concepto}</span>
                              <span className="font-medium">{formatCurrency(g.importe)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between font-bold text-sm mt-1">
                          <span>Total honorarios</span>
                          <span>{formatCurrency(hon.monto)}</span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })}

            {/* Totals Summary */}
            <div className="mt-6 space-y-4">
              {/* Grand Total Alquileres */}
              <div>
                <div className="bg-base-300 px-4 py-3 border-t-2 border-base-content flex justify-between items-center rounded-t-lg">
                  <span className="font-bold text-lg uppercase">Total Alquileres</span>
                  <span className="font-bold text-xl">{formatCurrency(grandSubtotalAlquileres)}</span>
                </div>
                <div className="bg-base-200 px-4 py-2 text-xs italic text-base-content/70 rounded-b-lg border-x border-b border-base-300">
                  Son: {numeroATexto(grandSubtotalAlquileres)}
                </div>
              </div>

              {/* Grand Total a Pagar */}
              <div>
                <div className="bg-base-300 px-4 py-3 border-t-2 border-base-content flex justify-between items-center rounded-t-lg">
                  <span className="font-bold text-lg uppercase">Total a Pagar</span>
                  <span className="font-bold text-xl">{formatCurrency(grandTotal)}</span>
                </div>
                <div className="bg-base-200 px-4 py-2 text-xs italic text-base-content/70 rounded-b-lg border-x border-b border-base-300">
                  Son: {numeroATexto(grandTotal)}
                </div>
              </div>
            </div>

            {/* Honorarios summary (all contracts) */}
            {effectiveData.some(d => d.honorarios) && (() => {
              const totalHon = effectiveData.reduce((s, d) => s + (d.honorarios?.monto || 0), 0)
              const allGastos = effectiveData.flatMap(d => d.honorarios?.gastosAMiCargo || [])
              const gastosGrouped = []
              for (const g of allGastos) {
                const ex = gastosGrouped.find(x => x.concepto === g.concepto)
                if (ex) { ex.importe += g.importe }
                else gastosGrouped.push({ ...g })
              }
              const honPct = effectiveData.find(d => d.honorarios)?.honorarios.porcentaje
              const totalAlquiler = effectiveData.reduce((s, d) => s + (d.honorarios?.montoAlquiler || 0), 0)
              return (
                <div className="mt-3 p-3 bg-base-200 rounded-lg">
                  <p className="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-2">Honorarios totales</p>
                  <div className="space-y-1 text-sm">
                    {honPct > 0 && (
                      <div className="flex justify-between">
                        <span>Honorarios alquiler ({honPct}%)</span>
                        <span>{formatCurrency(totalAlquiler)}</span>
                      </div>
                    )}
                    {gastosGrouped.map((g, i) => (
                      <div key={i} className="flex justify-between text-base-content/70">
                        <span>{g.concepto}</span>
                        <span>{formatCurrency(g.importe)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between font-bold mt-2 pt-2 border-t border-base-300">
                    <span>TOTAL HONORARIOS</span>
                    <span>{formatCurrency(totalHon)}</span>
                  </div>
                </div>
              )
            })()}
          </Card>

          {/* Datos bancarios empresa */}
          {effectiveData[0]?.empresa?.banco?.cbu && (
            <Card title="Datos para Transferencia de Honorarios">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {effectiveData[0].empresa.banco.nombre && <div><span className="text-base-content/60">Banco:</span> {effectiveData[0].empresa.banco.nombre}</div>}
                {effectiveData[0].empresa.banco.titular && <div><span className="text-base-content/60">Titular:</span> {effectiveData[0].empresa.banco.titular}</div>}
                {effectiveData[0].empresa.banco.cuit && <div><span className="text-base-content/60">CUIT:</span> {effectiveData[0].empresa.banco.cuit}</div>}
                {effectiveData[0].empresa.banco.tipoCuenta && <div><span className="text-base-content/60">Tipo:</span> {effectiveData[0].empresa.banco.tipoCuenta}</div>}
                {effectiveData[0].empresa.banco.numeroCuenta && <div><span className="text-base-content/60">N° Cuenta:</span> {effectiveData[0].empresa.banco.numeroCuenta}</div>}
                {effectiveData[0].empresa.banco.cbu && <div><span className="text-base-content/60">CBU:</span> {effectiveData[0].empresa.banco.cbu}</div>}
                {effectiveData[0].empresa.banco.alias && <div><span className="text-base-content/60">Alias:</span> {effectiveData[0].empresa.banco.alias}</div>}
              </div>
            </Card>
          )}

          {/* Payments */}
          {allTransactions.length > 0 && (
            <Card title="Pagos Registrados">
              <div className="overflow-x-auto">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Inquilino</th>
                      <th>Medio</th>
                      <th className="text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTransactions.map((t, i) => (
                      <tr key={i}>
                        <td>{formatDate(t.fecha)}</td>
                        <td>{t.inquilino}</td>
                        <td>{t.metodo === 'TRANSFERENCIA' ? 'Transf.' : 'Efectivo'}</td>
                        <td className="text-right">{formatCurrency(t.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan="3">Total Pagado</td>
                      <td className="text-right">{formatCurrency(totalPagado)}</td>
                    </tr>
                    {Math.abs(saldo) > 0.01 && (
                      <tr className="font-semibold">
                        <td colSpan="3">{saldo > 0 ? 'Saldo Pendiente' : 'Saldo a Favor'}</td>
                        <td className="text-right">{formatCurrency(Math.abs(saldo))}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ============================================
// ESTADO DE CUENTAS TAB
// ============================================

function EstadoCuentasTab({ groupId }) {
  const [contractId, setContractId] = useState('')
  const { contracts } = useContracts(groupId, { status: 'active' })
  const { data, isLoading, error } = useEstadoCuentas(groupId, { contractId: contractId || undefined })
  const { downloadPDF, downloadExcel } = useReportDownload(groupId)

  return (
    <div className="space-y-4">
      <Card title="Filtros">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div className="sm:col-span-2">
            <SearchableSelect
              label="Contrato / Inquilino"
              name="contractId"
              options={contracts.map((c) => ({
                value: c.id,
                label: `${c.tenants?.length > 0 ? c.tenants.map(t => t.name).join(' / ') : c.tenant?.name || 'Sin inquilino'} - ${c.property?.address}`,
              }))}
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="Buscar contrato..."
            />
          </div>
          <div className="flex items-end gap-2">
            {contractId && (
              <>
                <Button onClick={() => downloadPDF(`estado-cuentas/pdf?contractId=${contractId}`, 'estado-cuentas.pdf')} className="btn-sm btn-neutral gap-1.5">
                  <ArrowDownTrayIcon className="w-4 h-4" /> PDF
                </Button>
                <Button onClick={() => downloadExcel(`estado-cuentas/excel?contractId=${contractId}`, 'estado-cuentas.xlsx')} className="btn-sm btn-outline gap-1.5">
                  <TableCellsIcon className="w-4 h-4" /> Excel
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {isLoading && contractId && <LoadingPage />}

      {data && (
        <Card title={`Estado de Cuentas - ${data.inquilino.nombre}`}>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="stat bg-success/10 rounded-lg p-3">
              <div className="stat-title text-xs">Total Pagado</div>
              <div className="stat-value text-lg text-success">{formatCurrency(data.resumen.totalPagado)}</div>
            </div>
            <div className="stat bg-error/10 rounded-lg p-3">
              <div className="stat-title text-xs">Total Adeudado</div>
              <div className="stat-value text-lg text-error">{formatCurrency(data.resumen.totalAdeudado)}</div>
            </div>
            <div className="stat bg-info/10 rounded-lg p-3">
              <div className="stat-title text-xs">Balance</div>
              <div className={`stat-value text-lg ${data.resumen.balance >= 0 ? 'text-success' : 'text-error'}`}>
                {formatCurrency(data.resumen.balance)}
              </div>
            </div>
          </div>

          {/* History Table */}
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="text-right">Alquiler</th>
                  <th className="text-right">Servicios</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Pagado</th>
                  <th className="text-right">Saldo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.historial.map((h, i) => (
                  <tr key={i}>
                    <td className="font-medium">{h.periodo}</td>
                    <td className="text-right">{formatCurrency(h.alquiler)}</td>
                    <td className="text-right">{formatCurrency(h.servicios)}</td>
                    <td className="text-right font-medium">{formatCurrency(h.totalDue)}</td>
                    <td className="text-right">{formatCurrency(h.amountPaid)}</td>
                    <td className={`text-right ${h.balance >= 0 ? 'text-success' : 'text-error'}`}>
                      {formatCurrency(h.balance)}
                    </td>
                    <td><StatusBadge status={h.status} isPaid={h.isPaid} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Debts */}
          {data.deudas.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-error mb-2">Deudas Abiertas</h3>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th className="text-right">Original</th>
                      <th className="text-right">Pagado</th>
                      <th className="text-right">Punitorios</th>
                      <th className="text-right">Pendiente</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deudas.map((d, i) => (
                      <tr key={i}>
                        <td>{d.periodo}</td>
                        <td className="text-right">{formatCurrency(d.original)}</td>
                        <td className="text-right">{formatCurrency(d.pagado)}</td>
                        <td className="text-right text-warning">{formatCurrency(d.punitorios)}</td>
                        <td className="text-right font-bold text-error">{formatCurrency(d.pendiente)}</td>
                        <td>
                          <span className={`badge badge-sm ${d.status === 'PAID' ? 'badge-success' : 'badge-error'}`}>
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ============================================
// CARTA DOCUMENTO TAB
// ============================================

function CartaDocumentoTab({ groupId }) {
  const [contractId, setContractId] = useState('')
  const [message, setMessage] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const { contracts } = useContracts(groupId, { status: 'active' })
  const { downloadPDF } = useReportDownload(groupId)

  const handleGenerate = async () => {
    if (!contractId) return
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/groups/${groupId}/reports/carta-documento/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().accessToken}`,
        },
        body: JSON.stringify({ contractId, message: message || undefined }),
      })
      if (!response.ok) throw new Error('Error al generar carta documento')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'carta-documento.pdf'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
    }
    setIsGenerating(false)
  }

  return (
    <div className="space-y-4">
      <Card title="Carta Documento - Intimación de Pago">
        <div className="space-y-4 mt-2">
          <div>
            <SearchableSelect
              label="Contrato / Inquilino (con deuda)"
              name="contractId"
              options={contracts.map((c) => ({
                value: c.id,
                label: `${c.tenants?.length > 0 ? c.tenants.map(t => t.name).join(' / ') : c.tenant?.name || 'Sin inquilino'} - ${c.property?.address}`,
              }))}
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              placeholder="Buscar contrato..."
            />
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Mensaje personalizado (opcional)</span></label>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={4}
              placeholder="Dejar vacío para usar el texto estándar de intimación de pago..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <Button
            onClick={handleGenerate}
            disabled={!contractId || isGenerating}
            className="btn-neutral gap-1.5"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {isGenerating ? 'Generando...' : 'Generar PDF'}
          </Button>
        </div>
      </Card>

      <div className="alert alert-warning">
        <ExclamationTriangleIcon className="w-5 h-5" />
        <span className="text-sm">
          La carta documento es un documento legal. Verifique los datos antes de enviarlo.
          Solo los administradores pueden generar este documento.
        </span>
      </div>
    </div>
  )
}

// ============================================
// PAGO EFECTIVO TAB
// ============================================

function PagoEfectivoTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [selectedIds, setSelectedIds] = useState([])
  const [isDownloading, setIsDownloading] = useState(false)

  const { records, isLoading } = useMonthlyRecordsForPago(groupId, { month: String(month), year: String(year) })
  const { downloadPDF } = useReportDownload(groupId)

  const recordOptions = records.map((r) => ({
    value: r.id,
    label: `${r.tenants?.length > 0 ? r.tenants.map(t => t.name).join(' / ') : r.tenant?.name || 'Sin inquilino'} - ${r.property?.address || 'Sin propiedad'}`,
  }))

  const handleDownloadSingle = (recordId) => {
    const rec = records.find((r) => r.id === recordId)
    const name = rec?.tenants?.length > 0 ? rec.tenants[0].name : rec?.tenant?.name || 'recibo'
    downloadPDF(`pago-efectivo/pdf?monthlyRecordId=${recordId}`, `recibo-${name.toLowerCase().replace(/\s/g, '-')}.pdf`)
  }

  const handleDownloadMulti = async () => {
    if (selectedIds.length === 0) return
    setIsDownloading(true)
    try {
      const response = await api.post(`/groups/${groupId}/reports/pago-efectivo/pdf/multi`, {
        monthlyRecordIds: selectedIds,
      }, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `recibos-${monthNames[month]?.toLowerCase()}-${year}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
    }
    setIsDownloading(false)
  }

  return (
    <div className="space-y-4">
      <Card title="Recibos de Pago Efectivo">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Mes</span></label>
            <select className="select select-bordered select-sm w-full" value={month} onChange={(e) => { setMonth(parseInt(e.target.value)); setSelectedIds([]) }}>
              {monthNames.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => { setYear(parseInt(e.target.value)); setSelectedIds([]) }}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleDownloadMulti}
              disabled={selectedIds.length === 0 || isDownloading}
              className="btn-neutral btn-sm gap-1.5"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              {isDownloading ? 'Generando...' : `PDF Consolidado (${selectedIds.length})`}
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {!isLoading && records.length === 0 && (
        <Card><p className="text-base-content/60 text-center py-4">No hay registros para este período</p></Card>
      )}

      {records.length > 0 && (
        <Card title={`Registros - ${monthNames[month]} ${year}`}>
          <div className="mb-4">
            <MultiSearchableSelect
              label="Seleccionar registros para PDF consolidado"
              options={recordOptions}
              value={selectedIds}
              onChange={setSelectedIds}
              placeholder="Buscar inquilino o propiedad..."
            />
          </div>

          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>Inquilino</th>
                  <th>Propiedad</th>
                  <th className="text-right">Total</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  // Determinar si está completamente pagado basado en liveBalance y deuda
                  const isFullyPaid = r.status === 'COMPLETE' || 
                    (r.liveBalance >= 0 && (!r.debtInfo || r.debtInfo.status === 'PAID'))
                  const displayStatus = isFullyPaid ? 'PAID' : r.status
                  
                  return (
                    <tr key={r.id}>
                      <td className="font-medium">{r.tenants?.length > 0 ? r.tenants.map(t => t.name).join(' / ') : r.tenant?.name || '-'}</td>
                      <td>{r.property?.address || '-'}</td>
                      <td className="text-right font-medium">{formatCurrency(r.liveTotalDue || r.totalDue)}</td>
                      <td><StatusBadge status={displayStatus} isPaid={isFullyPaid} /></td>
                      <td>
                        <Button onClick={() => handleDownloadSingle(r.id)} className="btn-xs btn-ghost gap-1">
                          <ArrowDownTrayIcon className="w-3 h-3" /> PDF
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ============================================
// AJUSTES TAB
// ============================================

function AjustesTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const { data, isLoading } = useAjustesMes(groupId, { month: String(month), year: String(year) })
  const { downloadExcel } = useReportDownload(groupId)

  return (
    <div className="space-y-4">
      <Card title="Ajustes del Mes">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Mes</span></label>
            <select className="select select-bordered select-sm w-full" value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
              {monthNames.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => downloadExcel(`ajustes-mes/excel?month=${month}&year=${year}`, `ajustes-${monthNames[month]?.toLowerCase()}-${year}.xlsx`)}
              className="btn-sm btn-neutral gap-1.5"
              disabled={!data}
            >
              <TableCellsIcon className="w-4 h-4" /> Excel
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {data && (
        <Card title={`Ajustes - ${monthNames[month]} ${year}`}>
          {data.ajustes.length === 0 ? (
            <p className="text-base-content/60 text-center py-4">No hay ajustes para este período</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Inquilino</th>
                    <th>Propiedad</th>
                    <th className="text-right">Alquiler Anterior</th>
                    <th>Índice</th>
                    <th className="text-right">% Ajuste</th>
                    <th className="text-right">Alquiler Nuevo</th>
                    <th className="text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ajustes.map((a, i) => (
                    <tr key={i}>
                      <td className="font-medium">{a.inquilino}</td>
                      <td>{a.propiedad}</td>
                      <td className="text-right">{formatCurrency(a.alquilerAnterior)}</td>
                      <td>{a.indice}</td>
                      <td className="text-right font-medium text-info">{a.porcentajeAjuste}%</td>
                      <td className="text-right font-bold text-success">{formatCurrency(a.alquilerNuevo)}</td>
                      <td className="text-center">
                        {a.aplicado ? (
                          <span className="badge badge-sm badge-success">Aplicado</span>
                        ) : (
                          <span className="badge badge-sm badge-warning">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ============================================
// CONTROL MENSUAL TAB
// ============================================

function ControlMensualTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const { data, isLoading } = useControlMensual(groupId, { month: String(month), year: String(year) })
  const { downloadExcel } = useReportDownload(groupId)

  return (
    <div className="space-y-4">
      <Card title="Control Mensual">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Mes</span></label>
            <select className="select select-bordered select-sm w-full" value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
              {monthNames.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => downloadExcel(`control-mensual/excel?month=${month}&year=${year}`, `control-mensual-${monthNames[month]?.toLowerCase()}-${year}.xlsx`)}
              className="btn-sm btn-neutral gap-1.5"
              disabled={!data}
            >
              <TableCellsIcon className="w-4 h-4" /> Excel
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {data && (
        <>
          {/* Totals Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KPIBox label="Total Facturado" value={formatCurrency(data.totales.total)} color="text-primary" />
            <KPIBox label="Total Cobrado" value={formatCurrency(data.totales.pagado)} color="text-success" />
            <KPIBox label="Saldo Pendiente" value={formatCurrency(data.totales.saldo)} color="text-error" />
          </div>

          <Card title={`Registros - ${monthNames[month]} ${year}`}>
            {data.registros.length === 0 ? (
              <p className="text-base-content/60 text-center py-4">No hay registros para este período</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm table-zebra">
                  <thead>
                    <tr>
                      <th>Inquilino</th>
                      <th>Propiedad</th>
                      <th className="text-right">Alquiler</th>
                      <th className="text-right">Servicios</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Pagado</th>
                      <th className="text-right">Saldo</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.registros.map((r, i) => (
                      <tr key={i}>
                        <td className="font-medium">{r.inquilino}</td>
                        <td>{r.propiedad}</td>
                        <td className="text-right">
                          {formatCurrency(r.alquiler)}
                        </td>
                        <td className="text-right">{formatCurrency(r.servicios)}</td>
                        <td className="text-right font-medium">{formatCurrency(r.total)}</td>
                        <td className="text-right">{formatCurrency(r.pagado)}</td>
                        <td className={`text-right ${r.saldo > 0 ? 'text-error' : 'text-success'}`}>
                          {formatCurrency(r.saldo)}
                        </td>
                        <td><StatusBadge status={r.estado} isPaid={r.isPaid} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold">
                      <td colSpan={2}>TOTALES</td>
                      <td className="text-right">{formatCurrency(data.totales.alquiler)}</td>
                      <td className="text-right">{formatCurrency(data.totales.servicios)}</td>
                      <td className="text-right">{formatCurrency(data.totales.total)}</td>
                      <td className="text-right">{formatCurrency(data.totales.pagado)}</td>
                      <td className="text-right">{formatCurrency(data.totales.saldo)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ============================================
// IMPUESTOS TAB
// ============================================

function ImpuestosTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [selectedContractIds, setSelectedContractIds] = useState([])
  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [showOwnerNotifyModal, setShowOwnerNotifyModal] = useState(false)

  const { contracts } = useContracts(groupId, { status: 'ACTIVE' })
  const { owners } = useOwners(groupId)
  const { sendOwnerReport } = useNotifications(groupId)
  const { data, isLoading } = useImpuestos(groupId, {
    month: String(month),
    year: String(year),
    contractIds: selectedContractIds.length > 0 ? selectedContractIds : undefined,
    ownerId: selectedOwnerId || undefined
  })
  const { downloadPDF } = useReportDownload(groupId)

  // Contract options for multi-select
  const contractOptions = useMemo(() => {
    return (contracts || []).map((c) => {
      const type = c.contractType === 'PROPIETARIO' ? 'PROP' : 'INQ'
      const tenant = c.tenants?.[0]?.name || c.tenant?.name || 'Sin inquilino'
      const name = c.contractType === 'PROPIETARIO' ? (c.property?.owner?.name || 'Propietario') : tenant
      return {
        value: c.id,
        label: `[${type}] ${c.property?.address || 'Sin dirección'} - ${name}`,
      }
    })
  }, [contracts])

  // Collect unique owner bank details
  const ownerBanks = useMemo(() => {
    if (!data?.impuestos) return []
    const seen = new Map()
    for (const item of data.impuestos) {
      if (item.banco && item.banco.nombre) {
        const key = item.banco.cbu || item.banco.nombre + item.banco.titular
        if (!seen.has(key)) {
          seen.set(key, { propietario: item.propietario, banco: item.banco, beneficiario: item.beneficiario || null })
        }
      }
    }
    return Array.from(seen.values())
  }, [data])

  const handleDownloadPDF = () => {
    const contractIdsParam = selectedContractIds.length > 0 ? `&contractIds=${selectedContractIds.join(',')}` : ''
    const ownerIdParam = selectedOwnerId ? `&ownerId=${selectedOwnerId}` : ''
    downloadPDF(`impuestos/pdf?month=${month}&year=${year}${contractIdsParam}${ownerIdParam}`, `impuestos-${monthNames[month]?.toLowerCase()}-${year}.pdf`)
  }

  return (
    <div className="space-y-4">
      <Card title="Reporte de Impuestos y Servicios">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Mes</span></label>
            <select className="select select-bordered select-sm w-full" value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
              {monthNames.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleDownloadPDF} className="btn-sm btn-neutral gap-1.5" disabled={!data}>
              <ArrowDownTrayIcon className="w-4 h-4" /> PDF
            </Button>
            {(() => {
              const targetOwners = selectedOwnerId
                ? (owners || []).filter(o => o.id === selectedOwnerId)
                : (owners || [])
              return (
                <Button
                  onClick={() => setShowOwnerNotifyModal(true)}
                  className="btn-sm btn-primary gap-1.5"
                  disabled={!data || data.impuestos.length === 0 || !targetOwners.length}
                >
                  <BellIcon className="w-4 h-4" /> Enviar a dueños ({targetOwners.length})
                </Button>
              )
            })()}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label"><span className="label-text text-xs">Filtrar por contratos (opcional)</span></label>
            <MultiSearchableSelect
              options={contractOptions}
              value={selectedContractIds}
              onChange={setSelectedContractIds}
              placeholder="Todos los contratos..."
            />
            {selectedContractIds.length > 0 && (
              <p className="text-xs text-base-content/60 mt-2">{selectedContractIds.length} contrato(s) seleccionado(s)</p>
            )}
          </div>
          <div>
            <SearchableSelect
              label="Filtrar por dueño (opcional)"
              name="ownerId"
              options={(owners || []).map((owner) => ({
                value: owner.id,
                label: owner.name,
              }))}
              value={selectedOwnerId}
              onChange={(e) => setSelectedOwnerId(e?.target?.value ?? e ?? '')}
              placeholder="Todos los dueños..."
            />
          </div>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {data && data.impuestos.length === 0 && (
        <Card><p className="text-base-content/60 text-center py-4">No hay impuestos ni servicios registrados para este período</p></Card>
      )}

      {data && data.impuestos.length > 0 && (
        <>
          {/* Per-property detail */}
          <Card title={`Detalle - ${monthNames[month]} ${year}`}>
            {data.impuestos.map((item, idx) => (
              <div key={idx} className={idx > 0 ? 'mt-4 pt-4 border-t border-base-300' : ''}>
                <h3 className="font-semibold text-sm mb-2">{item.propiedad} - {item.inquilino}</h3>
                <div className="overflow-x-auto">
                  <table className="table table-xs">
                    <tbody>
                      {item.impuestos.map((imp, ii) => (
                        <tr key={ii}>
                          <td className="pl-4">{imp.concepto}</td>
                          <td className="text-right">{formatCurrency(imp.monto)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="pl-4">Subtotal</td>
                        <td className="text-right">{formatCurrency(item.totalImpuestos)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Grand Total */}
            <div className="mt-4 pt-3 border-t-2 border-base-content flex justify-between items-center">
              <span className="font-bold text-lg">TOTAL</span>
              <span className="font-bold text-lg">{formatCurrency(data.grandTotal)}</span>
            </div>
          </Card>

          {/* Owner bank details */}
          {ownerBanks.length > 0 && (
            <Card title="Datos Bancarios por Propietario">
              {ownerBanks.map((ob, idx) => (
                <div key={idx} className={idx > 0 ? 'mt-4 pt-4 border-t border-base-300' : ''}>
                  <h3 className="font-semibold text-sm mb-2">
                    {ob.beneficiario
                      ? `Transferir a: ${ob.beneficiario}`
                      : ob.propietario}
                    {ob.beneficiario && (
                      <span className="text-xs font-normal text-base-content/60 ml-2">
                        (propietario: {ob.propietario})
                      </span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                    {ob.banco.nombre && <div><span className="text-base-content/60">Banco:</span> {ob.banco.nombre}</div>}
                    {ob.banco.titular && <div><span className="text-base-content/60">Titular:</span> {ob.banco.titular}</div>}
                    {ob.banco.cuit && <div><span className="text-base-content/60">CUIT:</span> {ob.banco.cuit}</div>}
                    {ob.banco.tipoCuenta && <div><span className="text-base-content/60">Tipo:</span> {ob.banco.tipoCuenta}</div>}
                    {ob.banco.numeroCuenta && <div><span className="text-base-content/60">N° Cuenta:</span> {ob.banco.numeroCuenta}</div>}
                    {ob.banco.cbu && <div><span className="text-base-content/60">CBU:</span> {ob.banco.cbu}</div>}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {/* Owner Notification Modal */}
      {showOwnerNotifyModal && (
        <SendNotificationModal
          isOpen={showOwnerNotifyModal}
          onClose={() => setShowOwnerNotifyModal(false)}
          type="REPORT_OWNER"
          recipients={(selectedOwnerId
            ? (owners || []).filter(o => o.id === selectedOwnerId)
            : (owners || [])
          ).map(o => ({ id: o.id, name: o.name, email: o.email, phone: o.phone }))}
          recipientType="OWNER"
          onSend={async ({ channels }) => {
            const targetOwnerIds = selectedOwnerId
              ? [selectedOwnerId]
              : (owners || []).map(o => o.id)
            const contractIdsList = selectedContractIds.length > 0 ? selectedContractIds : undefined
            await sendOwnerReport.mutateAsync({
              ownerIds: targetOwnerIds,
              reportType: 'impuestos',
              month,
              year,
              channels,
              contractIds: contractIdsList,
            })
            setShowOwnerNotifyModal(false)
          }}
          isSending={sendOwnerReport.isPending}
        />
      )}
    </div>
  )
}

// ============================================
// VENCIMIENTOS TAB
// ============================================

function VencimientosTab({ groupId }) {
  const { data, isLoading } = useVencimientos(groupId)
  const { downloadPDF } = useReportDownload(groupId)

  return (
    <div className="space-y-4">
      <Card title="Contratos por Vencer">
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-base-content/60">Contratos que vencen en los próximos 2 meses</p>
          <Button
            onClick={() => downloadPDF('vencimientos/pdf', 'vencimientos.pdf')}
            className="btn-sm btn-neutral gap-1.5"
            disabled={!data}
          >
            <ArrowDownTrayIcon className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {data && (
        <Card>
          {data.vencimientos.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircleIcon className="w-12 h-12 text-success mx-auto mb-2" />
              <p className="text-lg font-medium text-success">Sin vencimientos próximos</p>
              <p className="text-sm text-base-content/60">No hay contratos por vencer en los próximos 2 meses</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Inquilino</th>
                    <th>Propiedad</th>
                    <th>Inicio</th>
                    <th>Vencimiento</th>
                    <th className="text-right">Alquiler</th>
                    <th>Días Restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vencimientos.map((v, i) => {
                    const isExpired = v.diasRestantes <= 0
                    const isUrgent = v.diasRestantes > 0 && v.diasRestantes <= 30
                    return (
                      <tr key={i}>
                        <td className="font-medium">{v.inquilino}</td>
                        <td>{v.propiedad}</td>
                        <td>{formatDate(v.inicio)}</td>
                        <td>{formatDate(v.vencimiento)}</td>
                        <td className="text-right">{formatCurrency(v.alquiler)}</td>
                        <td>
                          <span className={`badge badge-sm ${isExpired ? 'badge-error' : isUrgent ? 'badge-warning' : 'badge-info'}`}>
                            {isExpired ? 'Vencido' : `${v.diasRestantes} días`}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ============================================
// KPI Box Component
// ============================================

function KPIBox({ label, value, color = 'text-primary' }) {
  return (
    <div className="border border-base-300 rounded-lg p-3">
      <div className="text-xs text-base-content/60 mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  )
}
