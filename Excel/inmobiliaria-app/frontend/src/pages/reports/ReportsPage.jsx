// Reports Page - Phase 6: Professional Reports
import { useState, useMemo } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useContracts } from '../../hooks/useContracts'
import {
  useLiquidacion,
  useEstadoCuentas,
  useResumenEjecutivo,
  useEvolucionIngresos,
  useReportDownload,
  useSendReportEmail,
} from '../../hooks/useReports'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
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
  { id: 'liquidacion', label: 'Liquidación', icon: DocumentTextIcon },
  { id: 'estado-cuentas', label: 'Estado Cuentas', icon: DocumentDuplicateIcon },
  { id: 'evolucion', label: 'Evolución', icon: ChartBarIcon },
  { id: 'carta-documento', label: 'Carta Documento', icon: ExclamationTriangleIcon },
  { id: 'resumen', label: 'Resumen', icon: TableCellsIcon },
]

export default function ReportsPage() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const [activeTab, setActiveTab] = useState('liquidacion')

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
      <div className="tabs tabs-boxed bg-base-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab gap-2 ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'liquidacion' && <LiquidacionTab groupId={currentGroupId} />}
      {activeTab === 'estado-cuentas' && <EstadoCuentasTab groupId={currentGroupId} />}
      {activeTab === 'evolucion' && <EvolucionTab groupId={currentGroupId} />}
      {activeTab === 'carta-documento' && <CartaDocumentoTab groupId={currentGroupId} />}
      {activeTab === 'resumen' && <ResumenTab groupId={currentGroupId} />}
    </div>
  )
}

// ============================================
// LIQUIDACION TAB
// ============================================

function LiquidacionTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [contractId, setContractId] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [showEmailModal, setShowEmailModal] = useState(false)

  const { contracts, isLoading: loadingContracts } = useContracts(groupId, { status: 'active' })
  const { data, isLoading, error } = useLiquidacion(groupId, {
    month: showPreview ? month : null,
    year: showPreview ? year : null,
    contractId: showPreview ? contractId : null,
  })
  const { downloadPDF, downloadExcel } = useReportDownload(groupId)
  const { send, isSending } = useSendReportEmail(groupId)

  const handleView = () => {
    if (!contractId) return
    setShowPreview(true)
  }

  const handleDownloadPDF = () => {
    downloadPDF(`liquidacion/pdf?month=${month}&year=${year}&contractId=${contractId}`, `liquidacion-${monthNames[month]?.toLowerCase()}-${year}.pdf`)
  }

  const handleDownloadExcel = () => {
    downloadExcel(`liquidacion/excel?month=${month}&year=${year}`, `liquidaciones-${monthNames[month]?.toLowerCase()}-${year}.xlsx`)
  }

  const handlePrint = () => {
    window.open(`/api/groups/${groupId}/reports/liquidacion/pdf?month=${month}&year=${year}&contractId=${contractId}`, '_blank')
  }

  const handleSendEmail = () => {
    if (!emailTo) return
    send({ type: 'liquidacion', contractId, month, year, to: emailTo })
    setShowEmailModal(false)
    setEmailTo('')
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card title="Filtros">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Mes</span></label>
            <select className="select select-bordered select-sm w-full" value={month} onChange={(e) => { setMonth(parseInt(e.target.value)); setShowPreview(false) }}>
              {monthNames.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => { setYear(parseInt(e.target.value)); setShowPreview(false) }}>
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label"><span className="label-text text-xs">Contrato / Inquilino</span></label>
            <select className="select select-bordered select-sm w-full" value={contractId} onChange={(e) => { setContractId(e.target.value); setShowPreview(false) }}>
              <option value="">Seleccionar...</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tenant?.name || 'Sin inquilino'} - {c.property?.address || 'Sin propiedad'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleView} disabled={!contractId} className="btn-primary btn-sm w-full">
              Ver Reporte
            </Button>
          </div>
        </div>
      </Card>

      {/* Preview */}
      {showPreview && isLoading && <LoadingPage />}
      {showPreview && error && (
        <Card><p className="text-error">No se encontró liquidación para ese período</p></Card>
      )}
      {showPreview && data && (
        <Card
          title={`Liquidación - ${data.periodo.label}`}
          actions={
            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleDownloadPDF} className="btn-sm btn-primary gap-1">
                <ArrowDownTrayIcon className="w-4 h-4" /> PDF
              </Button>
              <Button onClick={handleDownloadExcel} className="btn-sm btn-secondary gap-1">
                <TableCellsIcon className="w-4 h-4" /> Excel
              </Button>
              <Button onClick={handlePrint} className="btn-sm btn-ghost gap-1">
                <PrinterIcon className="w-4 h-4" /> Imprimir
              </Button>
              <Button onClick={() => setShowEmailModal(true)} className="btn-sm btn-accent gap-1">
                <EnvelopeIcon className="w-4 h-4" /> Email
              </Button>
            </div>
          }
        >
          {/* Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
            <div>
              <p><span className="font-semibold">Inquilino:</span> {data.inquilino.nombre}</p>
              <p><span className="font-semibold">DNI/CUIT:</span> {data.inquilino.dni}</p>
            </div>
            <div>
              <p><span className="font-semibold">Propiedad:</span> {data.propiedad.direccion}</p>
              <p><span className="font-semibold">Propietario:</span> {data.propietario.nombre}</p>
            </div>
          </div>

          {/* Concepts Table */}
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="bg-[#003087] text-white">
                  <th>Concepto</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {data.conceptos.map((c, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-base-200' : ''}>
                    <td>{c.concepto}</td>
                    <td className="text-right">{c.base != null ? formatCurrency(c.base) : '-'}</td>
                    <td className="text-right">{formatCurrency(c.importe)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#003087] text-white font-bold text-base">
                  <td>TOTAL A PAGAR</td>
                  <td></td>
                  <td className="text-right">{formatCurrency(data.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Status */}
          <div className="mt-4 flex items-center gap-4 text-sm">
            <StatusBadge status={data.estado} isPaid={data.isPaid} />
            {data.fechaPago && <span>Fecha pago: {formatDate(data.fechaPago)}</span>}
            {data.amountPaid > 0 && !data.isPaid && (
              <span>Pagado: {formatCurrency(data.amountPaid)} | Saldo: {formatCurrency(Math.abs(data.balance))}</span>
            )}
          </div>
        </Card>
      )}

      {/* Email Modal */}
      {showEmailModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Enviar Liquidación por Email</h3>
            <div className="mt-4">
              <label className="label"><span className="label-text">Email destinatario</span></label>
              <input
                type="email"
                className="input input-bordered w-full"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="email@ejemplo.com"
              />
            </div>
            <div className="modal-action">
              <Button onClick={() => setShowEmailModal(false)} className="btn-ghost">Cancelar</Button>
              <Button onClick={handleSendEmail} disabled={!emailTo || isSending} className="btn-primary">
                {isSending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowEmailModal(false)} />
        </div>
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
            <label className="label"><span className="label-text text-xs">Contrato / Inquilino</span></label>
            <select className="select select-bordered select-sm w-full" value={contractId} onChange={(e) => setContractId(e.target.value)}>
              <option value="">Seleccionar contrato...</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tenant?.name} - {c.property?.address}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            {contractId && (
              <>
                <Button onClick={() => downloadPDF(`estado-cuentas/pdf?contractId=${contractId}`, 'estado-cuentas.pdf')} className="btn-sm btn-primary gap-1">
                  <ArrowDownTrayIcon className="w-4 h-4" /> PDF
                </Button>
                <Button onClick={() => downloadExcel(`estado-cuentas/excel?contractId=${contractId}`, 'estado-cuentas.xlsx')} className="btn-sm btn-secondary gap-1">
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
// EVOLUCION TAB
// ============================================

function EvolucionTab({ groupId }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const { data, isLoading } = useEvolucionIngresos(groupId, { year: String(year) })
  const { downloadExcel } = useReportDownload(groupId)

  const maxAmount = useMemo(() => {
    if (!data?.meses) return 1
    return Math.max(...data.meses.map((m) => m.amountPaid), 1)
  }, [data])

  return (
    <div className="space-y-4">
      <Card title="Filtros">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div>
            <label className="label"><span className="label-text text-xs">Año</span></label>
            <select className="select select-bordered select-sm w-full" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => downloadExcel(`evolucion-ingresos/excel?year=${year}`, `evolucion-ingresos-${year}.xlsx`)}
              className="btn-sm btn-secondary gap-1"
              disabled={!data}
            >
              <TableCellsIcon className="w-4 h-4" /> Excel
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {data && (
        <Card title={`Evolución de Ingresos - ${year}`}>
          {/* Mini bar chart */}
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="text-right">Facturado</th>
                  <th className="text-right">Cobrado</th>
                  <th className="w-48">Progreso</th>
                  <th className="text-right">Contratos</th>
                  <th className="text-right">Pagados</th>
                </tr>
              </thead>
              <tbody>
                {data.meses.map((m) => {
                  const pct = maxAmount > 0 ? (m.amountPaid / maxAmount) * 100 : 0
                  const cobranza = m.totalDue > 0 ? ((m.amountPaid / m.totalDue) * 100).toFixed(0) : '-'
                  return (
                    <tr key={m.mes} className={m.contratos === 0 ? 'opacity-40' : ''}>
                      <td className="font-medium">{m.label}</td>
                      <td className="text-right">{formatCurrency(m.totalDue)}</td>
                      <td className="text-right font-medium">{formatCurrency(m.amountPaid)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-full bg-base-200 rounded-full h-3">
                            <div
                              className="bg-primary h-3 rounded-full transition-all"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-base-content/60 w-10 text-right">{cobranza}%</span>
                        </div>
                      </td>
                      <td className="text-right">{m.contratos}</td>
                      <td className="text-right">{m.pagados}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td>TOTAL</td>
                  <td className="text-right">{formatCurrency(data.meses.reduce((s, m) => s + m.totalDue, 0))}</td>
                  <td className="text-right">{formatCurrency(data.totalAnual)}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
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
            <label className="label"><span className="label-text text-xs">Contrato / Inquilino (con deuda)</span></label>
            <select className="select select-bordered select-sm w-full" value={contractId} onChange={(e) => setContractId(e.target.value)}>
              <option value="">Seleccionar contrato...</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tenant?.name} - {c.property?.address}
                </option>
              ))}
            </select>
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
            className="btn-primary gap-1"
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
// RESUMEN TAB
// ============================================

function ResumenTab({ groupId }) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const { data, isLoading } = useResumenEjecutivo(groupId, { month: String(month), year: String(year) })
  const { downloadPDF } = useReportDownload(groupId)

  return (
    <div className="space-y-4">
      <Card title="Filtros">
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
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => downloadPDF(`resumen-ejecutivo/pdf?month=${month}&year=${year}`, `resumen-ejecutivo-${monthNames[month]?.toLowerCase()}-${year}.pdf`)}
              className="btn-sm btn-primary gap-1"
              disabled={!data}
            >
              <ArrowDownTrayIcon className="w-4 h-4" /> PDF
            </Button>
          </div>
        </div>
      </Card>

      {isLoading && <LoadingPage />}

      {data && (
        <Card title={`Resumen Ejecutivo - ${data.periodo.label}`}>
          {/* KPIs Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            <KPIBox label="Ingresos del Mes" value={formatCurrency(data.kpis.ingresosMes)} color="text-success" />
            <KPIBox label="Total Facturado" value={formatCurrency(data.kpis.totalDueMes)} color="text-primary" />
            <KPIBox label="% Cobranza" value={`${data.kpis.cobranza}%`} color="text-primary" />
            <KPIBox label="Deuda Total" value={formatCurrency(data.kpis.totalDeuda)} color="text-error" />
            <KPIBox label="Punitorios" value={formatCurrency(data.kpis.punitoryMes)} color="text-warning" />
            <KPIBox label="Ocupación" value={`${data.kpis.ocupacion}%`} color="text-info" />
          </div>

          {/* Variation */}
          {data.kpis.variacionIngresos !== null && (
            <div className="flex items-center gap-2 mb-4 text-sm">
              <span className="text-base-content/60">Variación vs. mes anterior:</span>
              <span className={`font-bold ${parseFloat(data.kpis.variacionIngresos) >= 0 ? 'text-success' : 'text-error'}`}>
                {parseFloat(data.kpis.variacionIngresos) >= 0 ? '+' : ''}{data.kpis.variacionIngresos}%
              </span>
            </div>
          )}

          {/* Payment Status */}
          <h3 className="text-md font-semibold mb-2">Estado de Pagos</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-success/10 rounded-lg p-3">
              <CheckCircleIcon className="w-6 h-6 text-success mx-auto mb-1" />
              <div className="text-xl font-bold text-success">{data.estadoPagos.pagados}</div>
              <div className="text-xs text-base-content/60">Pagados</div>
            </div>
            <div className="bg-warning/10 rounded-lg p-3">
              <ClockIcon className="w-6 h-6 text-warning mx-auto mb-1" />
              <div className="text-xl font-bold text-warning">{data.estadoPagos.parciales}</div>
              <div className="text-xs text-base-content/60">Parciales</div>
            </div>
            <div className="bg-error/10 rounded-lg p-3">
              <ExclamationTriangleIcon className="w-6 h-6 text-error mx-auto mb-1" />
              <div className="text-xl font-bold text-error">{data.estadoPagos.pendientes}</div>
              <div className="text-xs text-base-content/60">Pendientes</div>
            </div>
          </div>

          {/* Additional info */}
          <div className="mt-4 text-sm text-base-content/60 space-y-1">
            <p>Contratos activos: <span className="font-medium text-base-content">{data.kpis.contratosActivos}</span></p>
            <p>Propiedades totales: <span className="font-medium text-base-content">{data.kpis.totalPropiedades}</span></p>
            <p>Deudas abiertas: <span className="font-medium text-base-content">{data.kpis.deudasAbiertas}</span></p>
          </div>
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
