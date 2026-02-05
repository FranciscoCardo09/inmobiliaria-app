// Reusable Modal Component
import { XMarkIcon } from '@heroicons/react/24/outline'

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  actions,
  size = 'md',
}) => {
  if (!isOpen) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-4xl',
  }

  return (
    <dialog className="modal modal-open">
      <div className={`modal-box ${sizes[size]}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{title}</h3>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div>{children}</div>
        {actions && (
          <div className="modal-action">
            {actions}
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  )
}

export default Modal
