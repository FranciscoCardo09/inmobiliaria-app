// ContractAlerts Component - Shows contracts with adjustments this month and next month
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useAdjustmentIndices } from '../hooks/useAdjustmentIndices'
import { ExclamationTriangleIcon, CalendarIcon } from '@heroicons/react/24/outline'
import Card from './ui/Card'
import Button from './ui/Button'

export const ContractAlerts = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]

  const { adjustments, isLoadingAdjustments } = useAdjustmentIndices(currentGroup?.id)

  if (isLoadingAdjustments) {
    return (
      <Card>
        <div className="flex items-center justify-center p-8">
          <span className="loading loading-spinner loading-md"></span>
        </div>
      </Card>
    )
  }

  const { thisMonth, nextMonth, thisMonthCount, nextMonthCount } = adjustments

  if (thisMonthCount === 0 && nextMonthCount === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      {/* This month adjustments */}
      {thisMonthCount > 0 && (
        <Card className="border-l-4 border-warning bg-warning/5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="w-8 h-8 text-warning" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-warning mb-2">
                Ajustes de Alquiler Este Mes
              </h3>
              <p className="text-base-content/70 mb-4">
                {thisMonthCount} {thisMonthCount === 1 ? 'contrato tiene' : 'contratos tienen'}{' '}
                ajuste este mes
              </p>

              <div className="space-y-2">
                {thisMonth.slice(0, 3).map((contract) => (
                  <div
                    key={contract.id}
                    className="flex items-center justify-between p-3 bg-base-100 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{contract.tenant?.name}</p>
                      <p className="text-sm text-base-content/60">
                        {contract.property?.address}
                        {contract.adjustmentIndex && (
                          <span className="ml-2 badge badge-sm badge-warning">
                            {contract.adjustmentIndex.name}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-base-content/50 mt-1">
                        {contract.currentPeriodLabel} - Mes {contract.currentMonth}/{contract.durationMonths}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {thisMonthCount > 3 && (
                <p className="text-sm text-base-content/60 mt-2">
                  Y {thisMonthCount - 3} más...
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/contracts')}
                className="mt-4"
              >
                Ver todos los contratos
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Next month adjustments */}
      {nextMonthCount > 0 && (
        <Card className="border-l-4 border-info bg-info/5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <CalendarIcon className="w-8 h-8 text-info" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-info mb-2">
                Ajustes Próximo Mes
              </h3>
              <p className="text-base-content/70 mb-4">
                {nextMonthCount} {nextMonthCount === 1 ? 'contrato tendrá' : 'contratos tendrán'}{' '}
                ajuste el próximo mes
              </p>

              <div className="space-y-2">
                {nextMonth.slice(0, 3).map((contract) => (
                  <div
                    key={contract.id}
                    className="flex items-center justify-between p-3 bg-base-100 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{contract.tenant?.name}</p>
                      <p className="text-sm text-base-content/60">
                        {contract.property?.address}
                        {contract.adjustmentIndex && (
                          <span className="ml-2 badge badge-sm badge-info">
                            {contract.adjustmentIndex.name}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-base-content/50 mt-1">
                        Próximo mes: Mes {contract.currentMonth + 1}/{contract.durationMonths}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {nextMonthCount > 3 && (
                <p className="text-sm text-base-content/60 mt-2">
                  Y {nextMonthCount - 3} más...
                </p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default ContractAlerts
