// Consorcios: lista de edificios administrados. Cada uno tiene su cuenta
// bancaria (CBU) y su rendición mensual armada desde el extracto del banco.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BuildingOffice2Icon, PlusIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../../stores/authStore'
import { useConsorcios } from '../../hooks/useConsorcios'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import ConsorcioFormModal from './ConsorcioFormModal'
import { useCanEdit } from './permissions'

export default function ConsorciosPage() {
  const groupId = useAuthStore((s) => s.currentGroupId)
  const { consorcios, isLoading, create } = useConsorcios(groupId)
  const [open, setOpen] = useState(false)
  const { canEdit } = useCanEdit()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Consorcios</h1>
          <p className="text-base-content/60 text-sm">
            Subí el extracto del banco de cada mes y armá la rendición de cuentas en Word o PDF.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setOpen(true)}>
            <PlusIcon className="w-5 h-5" /> Nuevo consorcio
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><span className="loading loading-spinner loading-lg" /></div>
      ) : consorcios.length === 0 ? (
        <Card>
          <EmptyState
            icon={BuildingOffice2Icon}
            title="Todavía no hay consorcios"
            description="Creá uno con el CBU de la cuenta del edificio. Se cargan solos los rubros del informe (Ingresos, Limpieza, Vigilancia, …) y los podés cambiar después."
            action={canEdit ? { label: 'Crear consorcio', onClick: () => setOpen(true) } : null}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {consorcios.map((c) => (
            <Link key={c.id} to={`/consorcios/${c.id}`} className="card bg-base-100 shadow-md hover:shadow-lg transition-shadow">
              <div className="card-body">
                <h2 className="card-title">
                  <BuildingOffice2Icon className="w-6 h-6 text-primary" />
                  {c.name}
                  {!c.isActive && <span className="badge badge-ghost">inactivo</span>}
                </h2>
                {c.bankAccountName && <p className="text-sm text-base-content/70">Cuenta: {c.bankAccountName}</p>}
                <p className="text-xs font-mono text-base-content/50">CBU {c.cbu}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <ConsorcioFormModal
        isOpen={open}
        onClose={() => setOpen(false)}
        loading={create.isPending}
        onSubmit={(data) => create.mutate(data, { onSuccess: () => setOpen(false) })}
      />
    </div>
  )
}
