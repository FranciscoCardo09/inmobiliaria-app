// Adjustment Index List - Simple CRUD
import { useNavigate } from 'react-router-dom'
import { PlusIcon, CalendarIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useAdjustmentIndices } from '../../hooks/useAdjustmentIndices'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { LoadingPage } from '../../components/ui/Loading'
import toast from 'react-hot-toast'

export const AdjustmentIndexList = () => {
  const navigate = useNavigate()
  const { groups } = useAuthStore()
  const currentGroup = groups[0]

  const {
    indices,
    isLoading,
    deleteIndex,
    isDeleting,
  } = useAdjustmentIndices(currentGroup?.id)

  const handleDelete = async (index) => {
    const contractCount = index._count?.contracts || 0

    if (contractCount > 0) {
      toast.error(
        `No se puede eliminar "${index.name}" porque tiene ${contractCount} contrato(s) asignado(s)`,
        { duration: 4000 }
      )
      return
    }

    const confirmResult = window.confirm(
      `¿Eliminar el índice "${index.name}"?\n\nEsta acción no se puede deshacer.`
    )

    if (!confirmResult) return

    deleteIndex(index.id, {
      onSuccess: () => {
        toast.success(`Índice "${index.name}" eliminado`)
      },
    })
  }

  if (isLoading) {
    return <LoadingPage />
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Índices de Ajuste</h1>
          <p className="text-base-content/60 mt-1">{currentGroup?.name}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/adjustments/new')}>
          <PlusIcon className="w-5 h-5" />
          Nuevo Índice
        </Button>
      </div>

      {indices.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarIcon}
            title="No hay índices de ajuste"
            description="Crea índices de ajuste para aplicar aumentos periódicos a los contratos"
            action={{
              label: 'Crear Índice',
              onClick: () => navigate('/adjustments/new'),
            }}
          />
        </Card>
      ) : (
        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Índices Registrados</h2>

            <div className="space-y-3">
              {indices.map((index) => (
                <div
                  key={index.id}
                  className="flex items-center justify-between p-4 bg-base-200 rounded-lg hover:bg-base-300 transition-colors"
                >
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{index.name}</h3>
                    <div className="flex gap-4 mt-1 text-sm text-base-content/60">
                      <span>
                        Cada {index.frequencyMonths}{' '}
                        {index.frequencyMonths === 1 ? 'mes' : 'meses'}
                      </span>
                      <span>•</span>
                      <span>{index._count?.contracts || 0} contratos</span>
                      {index.lastUpdated && (
                        <>
                          <span>•</span>
                          <span>
                            Último ajuste:{' '}
                            {new Date(index.lastUpdated).toLocaleDateString('es-AR')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/adjustments/${index.id}`)}
                    >
                      <PencilIcon className="w-4 h-4" />
                      Editar
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(index)}
                      loading={isDeleting}
                      className="text-error hover:text-error hover:bg-error/10"
                    >
                      <TrashIcon className="w-4 h-4" />
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default AdjustmentIndexList
