// ContractsExpiring - Dashboard detail page
import { useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useContracts } from '../../hooks/useContracts'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { LoadingPage } from '../../components/ui/Loading'

export const ContractsExpiring = () => {
  const navigate = useNavigate()
  const { groups, currentGroupId } = useAuthStore()
  const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0]
  const { expiringContracts, isLoadingExpiring } = useContracts(currentGroup?.id)

  if (isLoadingExpiring) return <LoadingPage />

  const contracts = expiringContracts || []

  return (
    <div className="p-6 space-y-6">
      <div>
        <Button variant="ghost" onClick={() => navigate('/dashboard')} className="mb-4">
          <ArrowLeftIcon className="w-4 h-4" /> Volver al Dashboard
        </Button>
        <h1 className="text-3xl font-bold">Contratos por Vencer</h1>
        <p className="text-base-content/60 mt-1">
          {contracts.length} contrato(s) vencen en los proximos 2 meses
        </p>
      </div>

      {contracts.length === 0 ? (
        <Card>
          <EmptyState
            icon={ExclamationTriangleIcon}
            title="Sin contratos por vencer"
            description="No hay contratos que venzan en los proximos 2 meses"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => (
            <Card key={contract.id}>
              <div className="flex items-center justify-between p-4">
                <div>
                  <h3 className="font-semibold text-lg">{contract.tenant?.name}</h3>
                  <p className="text-sm text-base-content/60">
                    {contract.property?.address}{' '}
                    {contract.property?.code && `(${contract.property.code})`}
                  </p>
                  <div className="flex gap-3 mt-2">
                    <span className="text-xs text-base-content/60">
                      Mes {contract.currentMonth}/{contract.durationMonths}
                    </span>
                    <span className="badge badge-error badge-sm">
                      {contract.remainingMonths === 0
                        ? 'Vence este mes'
                        : `${contract.remainingMonths} mes(es) restante(s)`}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">
                    ${contract.baseRent?.toLocaleString('es-AR')}
                  </div>
                  <div className="text-xs text-base-content/60">Alquiler actual</div>
                  {contract.endDate && (
                    <div className="text-xs text-error mt-1">
                      Vence: {new Date(contract.endDate).toLocaleDateString('es-AR')}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default ContractsExpiring
