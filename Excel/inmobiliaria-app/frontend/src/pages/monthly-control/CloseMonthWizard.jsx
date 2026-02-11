// Close Month Wizard - Preview and execute month close
import { useState, useEffect } from 'react'
import { useCloseMonth } from '../../hooks/useDebts'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import {
  LockClosedIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '$0'
  return `$${Math.round(amount).toLocaleString('es-AR')}`
}

export default function CloseMonthWizard({ groupId, month, year, onClose, onSuccess }) {
  const [step, setStep] = useState('preview') // preview | confirm | done
  const [result, setResult] = useState(null)

  const { previewClose, isPreviewing, previewData, closeMonth, isClosing } = useCloseMonth(groupId)

  const monthNames = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ]

  const handlePreview = async () => {
    await previewClose({ month, year })
  }

  const handleClose = async () => {
    try {
      const res = await closeMonth({ month, year })
      setResult(res)
      setStep('done')
      if (onSuccess) onSuccess()
    } catch (e) {
      // Handled by hook
    }
  }

  // Load preview on mount
  useEffect(() => {
    handlePreview()
  }, [])

  return (
    <Modal isOpen={true} onClose={onClose} title={`Cerrar Mes: ${monthNames[month]} ${year}`} size="lg">
      {step === 'preview' && (
        <div className="space-y-4">
          {isPreviewing ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : previewData ? (
            <>
              {/* Summary */}
              <div className="alert alert-warning">
                <ExclamationTriangleIcon className="w-5 h-5" />
                <div>
                  <div className="font-bold">Se generaran {previewData.summary.willGenerateDebts} deuda(s)</div>
                  <div className="text-sm">
                    Total: {formatCurrency(previewData.summary.totalDebtAmount)}
                  </div>
                  {previewData.summary.alreadyHaveDebt > 0 && (
                    <div className="text-xs mt-1">
                      {previewData.summary.alreadyHaveDebt} registro(s) ya tienen deuda generada
                    </div>
                  )}
                </div>
              </div>

              {/* Preview table */}
              {previewData.debtsPreview.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table table-xs table-zebra">
                    <thead>
                      <tr className="bg-base-200">
                        <th>Inquilino</th>
                        <th>Propiedad</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Pagado</th>
                        <th className="text-right">Serv. Cubiertos</th>
                        <th className="text-right">Alq. Cubierto</th>
                        <th className="text-right font-bold">Deuda Alquiler</th>
                        <th className="text-center">Genera Deuda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.debtsPreview.map((item) => (
                        <tr key={item.monthlyRecordId}>
                          <td className="text-xs font-medium">{item.tenant?.name}</td>
                          <td className="text-xs">{item.property?.address}</td>
                          <td className="text-xs text-right font-mono">
                            {formatCurrency(item.totalOriginal)}
                          </td>
                          <td className="text-xs text-right font-mono text-success">
                            {formatCurrency(item.amountPaid)}
                          </td>
                          <td className="text-xs text-right font-mono">
                            {formatCurrency(item.servicesCovered)}
                          </td>
                          <td className="text-xs text-right font-mono">
                            {formatCurrency(item.rentCovered)}
                          </td>
                          <td className="text-xs text-right font-mono font-bold text-error">
                            {formatCurrency(item.unpaidRent)}
                          </td>
                          <td className="text-center">
                            {item.willGenerateDebt ? (
                              <span className="badge badge-error badge-xs">Si</span>
                            ) : (
                              <span className="badge badge-ghost badge-xs">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-6">
                  <CheckCircleIcon className="w-10 h-10 text-success mx-auto mb-2" />
                  <p className="font-semibold">No hay registros pendientes para cerrar</p>
                  {previewData.summary.alreadyHaveDebt > 0 ? (
                    <p className="text-sm text-base-content/60 mt-1">
                      Todos los registros impagos ya tienen deuda generada.
                    </p>
                  ) : (
                    <p className="text-sm text-base-content/60 mt-1">
                      Todos los registros del mes est\u00e1n al d\u00eda.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : null}

          <div className="modal-action">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            {previewData?.summary?.willGenerateDebts > 0 && (
              <Button
                variant="error"
                size="sm"
                onClick={() => setStep('confirm')}
              >
                <LockClosedIcon className="w-4 h-4" />
                Cerrar Mes
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="alert alert-error">
            <ExclamationTriangleIcon className="w-5 h-5" />
            <div>
              <div className="font-bold">Confirmar cierre de {monthNames[month]} {year}</div>
              <div className="text-sm mt-1">
                Se generaran {previewData?.summary?.willGenerateDebts} deuda(s) por un total de{' '}
                {formatCurrency(previewData?.summary?.totalDebtAmount)}.
              </div>
              <div className="text-sm mt-1">
                Los inquilinos con deudas abiertas NO podran registrar pagos del mes actual.
              </div>
            </div>
          </div>

          <div className="modal-action">
            <Button variant="ghost" size="sm" onClick={() => setStep('preview')}>
              Volver
            </Button>
            <Button
              variant="error"
              size="sm"
              loading={isClosing}
              onClick={handleClose}
            >
              <LockClosedIcon className="w-4 h-4" />
              Confirmar Cierre
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4 text-center py-4">
          <CheckCircleIcon className="w-16 h-16 text-success mx-auto" />
          <h3 className="text-lg font-bold">Mes Cerrado Exitosamente</h3>
          <p className="text-base-content/60">
            {result?.debtsCreated} deuda(s) generada(s) para {result?.periodLabel}
          </p>
          <div className="modal-action justify-center">
            <Button variant="primary" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
