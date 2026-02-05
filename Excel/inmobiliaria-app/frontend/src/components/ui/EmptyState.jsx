// Empty State Component
import { FolderOpenIcon } from '@heroicons/react/24/outline'

export const EmptyState = ({
  icon: Icon = FolderOpenIcon,
  title = 'No hay datos',
  description = 'No hay elementos para mostrar',
  action,
}) => {
  return (
    <div className="text-center py-12">
      <Icon className="w-16 h-16 mx-auto text-base-content/30" />
      <h3 className="mt-4 text-lg font-medium text-base-content">{title}</h3>
      <p className="mt-2 text-sm text-base-content/60">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export default EmptyState
