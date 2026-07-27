// Gastos Alquiler Tab - Recibo de gastos de ingreso cobrados al inquilino
// nuevo (informes, apto eléctrico, honorarios inmobiliarios, etc.) con
// descuento de reserva. Genera un PDF con el mismo formato que los recibos
// de Pago Efectivo, y guarda historial con numeración propia (GA-######).
import { useMemo, useState } from 'react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { numeroATexto } from '../../utils/formatters'
import { useTenants } from '../../hooks/useTenants'
import { useProperties } from '../../hooks/useProperties'
import { useContracts } from '../../hooks/useContracts'
import {
  useRentExpenseConcepts,
  useRentExpenseReceipts,
  useCreateRentExpenseReceipt,
  useDeleteRentExpenseReceipt,
  useDownloadRentExpenseReceipt,
} from '../../hooks/useRentExpenses'
import { PlusIcon, TrashIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return '$0,00'
  return `$${Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('es-AR', { timeZone: 'UTC' })
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const emptyItem = () => ({
  id: `${Date.now()}-${Math.random()}`,
  concepto: '',
  importe: '',
  enCuotas: false,
  cuotaNumber: '',
  cuotaTotal: '',
})

function conceptoLabel(item) {
  if (item.enCuotas && item.cuotaNumber && item.cuotaTotal) {
    return `${item.concepto} (cuota ${item.cuotaNumber} de ${item.cuotaTotal})`
  }
  return item.concepto
}

function GastosAlquilerTab({ groupId }) {
  const [fecha, setFecha] = useState(todayISO())
  const [ivaCondicion, setIvaCondicion] = useState('consumidor final')
  const [tenantName, setTenantName] = useState('')
  const [address, setAddress] = useState('')
  const [addressTouched, setAddressTouched] = useState(false)
  const [porCuentaYOrdenDe, setPorCuentaYOrdenDe] = useState('')
  const [reserva, setReserva] = useState('')
  const [items, setItems] = useState([emptyItem()])

  const { tenants } = useTenants(groupId)
  const { properties } = useProperties(groupId)
  const { contracts } = useContracts(groupId)
  const { concepts } = useRentExpenseConcepts(groupId)
  const { receipts, isLoading: isLoadingReceipts } = useRentExpenseReceipts(groupId)
  const { createReceipt, isCreating } = useCreateRentExpenseReceipt(groupId)
  const { deleteReceipt } = useDeleteRentExpenseReceipt(groupId)
  const { download } = useDownloadRentExpenseReceipt(groupId)

  const addItem = () => setItems((prev) => [...prev, emptyItem()])
  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)))
  const removeItem = (id) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev))

  const total = useMemo(
    () => items.reduce((sum, it) => sum + (parseFloat(it.importe) || 0), 0),
    [items]
  )
  const reservaNum = parseFloat(reserva) || 0
  const saldo = total - reservaNum

  const validItems = items.filter(
    (it) => it.concepto.trim() && it.importe !== '' && !Number.isNaN(parseFloat(it.importe))
  )
  const canSubmit = tenantName.trim() && address.trim() && validItems.length > 0 && !isCreating

  const resetForm = () => {
    setFecha(todayISO())
    setIvaCondicion('consumidor final')
    setTenantName('')
    setAddress('')
    setAddressTouched(false)
    setPorCuentaYOrdenDe('')
    setReserva('')
    setItems([emptyItem()])
  }

  // Al elegir un inquilino con contrato activo, sugerir la dirección de su
  // propiedad (solo si el campo dirección todavía no fue editado a mano).
  const handleTenantChange = (value) => {
    setTenantName(value)
    if (addressTouched) return
    const match = contracts.find((c) => {
      if (c.tenant?.name === value) return true
      return c.contractTenants?.some((ct) => ct.tenant?.name === value)
    })
    if (match?.property?.address) setAddress(match.property.address)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    const payload = {
      fecha,
      tenantName: tenantName.trim(),
      address: address.trim(),
      ivaCondicion: ivaCondicion.trim() || null,
      porCuentaYOrdenDe: porCuentaYOrdenDe.trim() || null,
      reserva: reservaNum,
      items: validItems.map((it) => ({
        concepto: it.concepto.trim(),
        importe: parseFloat(it.importe),
        cuotaNumber: it.enCuotas && it.cuotaNumber ? parseInt(it.cuotaNumber, 10) : null,
        cuotaTotal: it.enCuotas && it.cuotaTotal ? parseInt(it.cuotaTotal, 10) : null,
      })),
    }

    try {
      const receipt = await createReceipt(payload)
      await download(receipt.id, receipt.receiptNumber)
      resetForm()
    } catch (e) {
      // el toast de error ya lo maneja el hook de creación
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* ── Formulario ── */}
      <Card title="Nuevo recibo de Gastos Alquiler" subtitle="Gastos de ingreso cobrados al inquilino, con descuento de reserva">
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label"><span className="label-text text-xs">Fecha</span></label>
              <input
                type="date"
                className="input input-bordered input-sm w-full"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div>
              <label className="label"><span className="label-text text-xs">Condición IVA</span></label>
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                value={ivaCondicion}
                onChange={(e) => setIvaCondicion(e.target.value)}
                placeholder="consumidor final"
              />
            </div>
          </div>

          <div>
            <label className="label"><span className="label-text text-xs">Nombre del Inquilino</span></label>
            <input
              type="text"
              list="ga-tenant-names"
              className="input input-bordered input-sm w-full"
              value={tenantName}
              onChange={(e) => handleTenantChange(e.target.value)}
              placeholder="Apellido, Nombre"
            />
            <datalist id="ga-tenant-names">
              {tenants.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="label"><span className="label-text text-xs">Dirección</span></label>
            <input
              type="text"
              list="ga-addresses"
              className="input input-bordered input-sm w-full"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setAddressTouched(true) }}
              placeholder="Calle N°, piso, depto."
            />
            <datalist id="ga-addresses">
              {properties.map((p) => (
                <option key={p.id} value={p.address} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="label"><span className="label-text text-xs">Este recibo se emite por Cuenta y Orden de <span className="opacity-50">(opcional)</span></span></label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              value={porCuentaYOrdenDe}
              onChange={(e) => setPorCuentaYOrdenDe(e.target.value)}
              placeholder="Nombre del propietario"
            />
          </div>

          <div className="divider my-1">Conceptos</div>

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-base-300 p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="ga-concepts"
                    className="input input-bordered input-xs flex-1"
                    placeholder="Concepto (ej: Informes personales)"
                    value={item.concepto}
                    onChange={(e) => updateItem(item.id, 'concepto', e.target.value)}
                  />
                  <input
                    type="number"
                    className="input input-bordered input-xs w-28"
                    placeholder="Importe"
                    value={item.importe}
                    onChange={(e) => updateItem(item.id, 'importe', e.target.value)}
                    min="0"
                    step="0.01"
                  />
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-error"
                    onClick={() => removeItem(item.id)}
                    title="Quitar concepto"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>

                <label className="flex items-center gap-1.5 text-xs cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={item.enCuotas}
                    onChange={(e) => updateItem(item.id, 'enCuotas', e.target.checked)}
                  />
                  En cuotas
                </label>

                {item.enCuotas && (
                  <div className="flex items-center gap-2 text-xs">
                    <span>Cuota</span>
                    <input
                      type="number"
                      className="input input-bordered input-xs w-14"
                      min="1"
                      value={item.cuotaNumber}
                      onChange={(e) => updateItem(item.id, 'cuotaNumber', e.target.value)}
                    />
                    <span>de</span>
                    <input
                      type="number"
                      className="input input-bordered input-xs w-14"
                      min="1"
                      value={item.cuotaTotal}
                      onChange={(e) => updateItem(item.id, 'cuotaTotal', e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
            <datalist id="ga-concepts">
              {concepts.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>

            <button type="button" className="btn btn-xs btn-ghost text-primary gap-1" onClick={addItem}>
              <PlusIcon className="w-3.5 h-3.5" /> Agregar concepto
            </button>
          </div>

          <div className="divider my-1"></div>

          <div>
            <label className="label"><span className="label-text text-xs">Reserva</span></label>
            <input
              type="number"
              className="input input-bordered input-sm w-full"
              value={reserva}
              onChange={(e) => setReserva(e.target.value)}
              min="0"
              step="0.01"
              placeholder="0"
            />
          </div>

          <div className="bg-base-200 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-base-content/70">Total</span>
              <span className="font-medium">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-base-content/70">Reserva</span>
              <span className="font-medium">- {formatCurrency(reservaNum)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t border-base-300 pt-1 mt-1">
              <span>Saldo</span>
              <span>{formatCurrency(saldo)}</span>
            </div>
            <p className="text-xs text-base-content/60 italic pt-1">
              Son: {numeroATexto(Math.max(saldo, 0))}.-
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={isCreating}
              className="btn-primary btn-sm flex-1 gap-1.5"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Guardar y generar PDF
            </Button>
            <Button onClick={resetForm} variant="ghost" size="sm">
              Limpiar
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Vista previa + historial ── */}
      <div className="space-y-4">
        <Card title="Vista previa">
          <div className="mt-2 border-2 border-base-300 rounded-xl p-4 bg-base-100 text-sm space-y-2">
            <div className="flex justify-between items-start">
              <span className="font-semibold">{formatDate(fecha)}</span>
              <span className="badge badge-outline">RECIBO</span>
            </div>
            <p className="text-center font-medium">{ivaCondicion || 'consumidor final'}</p>
            <div className="pt-2">
              <p><span className="text-base-content/60">Señor/es:</span> <span className="font-medium">{tenantName || '—'}</span></p>
              <p><span className="text-base-content/60">Domicilio:</span> <span className="font-medium">{address || '—'}</span></p>
            </div>
            <p className="text-base-content/60 text-xs pt-1">
              Este recibo se emite por Cuenta y Orden de:{' '}
              {porCuentaYOrdenDe && <span className="font-medium text-base-content">{porCuentaYOrdenDe}</span>}
            </p>
            <div className="pt-2 border-t border-base-300">
              <p className="text-xs text-base-content/60 mb-1">En concepto de:</p>
              {items.filter((it) => it.concepto.trim()).length === 0 && (
                <p className="text-xs text-base-content/40 italic">Sin conceptos cargados</p>
              )}
              {items.filter((it) => it.concepto.trim()).map((it) => (
                <div key={it.id} className="flex justify-between text-xs py-0.5">
                  <span>{conceptoLabel(it)}</span>
                  <span>{formatCurrency(parseFloat(it.importe) || 0)}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-base-300 space-y-0.5">
              <div className="flex justify-between font-semibold text-xs"><span>Total</span><span>{formatCurrency(total)}</span></div>
              <div className="flex justify-between font-semibold text-xs"><span>Reserva</span><span>{formatCurrency(reservaNum)}</span></div>
              <div className="flex justify-between font-bold"><span>Saldo</span><span>{formatCurrency(saldo)}</span></div>
            </div>
            <p className="text-xs italic pt-1">Son: {numeroATexto(Math.max(saldo, 0))}.-</p>
          </div>
        </Card>

        <Card title="Recibos emitidos">
          {isLoadingReceipts && <p className="text-sm text-base-content/60">Cargando...</p>}
          {!isLoadingReceipts && receipts.length === 0 && (
            <p className="text-sm text-base-content/60 text-center py-4">Todavía no se generó ningún recibo</p>
          )}
          {receipts.length > 0 && (
            <div className="overflow-x-auto mt-2">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Fecha</th>
                    <th>Inquilino</th>
                    <th className="text-right">Saldo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.receiptNumber}</td>
                      <td>{formatDate(r.fecha)}</td>
                      <td>{r.tenantName}</td>
                      <td className="text-right font-medium">{formatCurrency(r.saldo)}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost gap-1"
                            onClick={() => download(r.id, r.receiptNumber)}
                            title="Reimprimir PDF"
                          >
                            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> PDF
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost text-error"
                            onClick={() => {
                              if (window.confirm(`¿Eliminar el recibo ${r.receiptNumber}?`)) deleteReceipt(r.id)
                            }}
                            title="Eliminar"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default GastosAlquilerTab
