// Invite User Component
import { useState } from 'react'
import { UserPlusIcon } from '@heroicons/react/24/outline'
import { useGroups } from '../hooks/useGroups'
import { useAuthStore } from '../stores/authStore'
import Modal from './ui/Modal'
import Input from './ui/Input'
import Button from './ui/Button'

export const InviteUser = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    role: 'VIEWER',
  })
  const [errors, setErrors] = useState({})
  const { inviteUser, isInviting } = useGroups()
  const { currentGroupId, groups } = useAuthStore()

  const currentGroup = groups.find((g) => g.id === currentGroupId)
  const canInvite = currentGroup?.role === 'ADMIN'

  if (!canInvite || !currentGroupId) {
    return null
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }))
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.email) {
      newErrors.email = 'Email es requerido'
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email invalido'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (validate()) {
      inviteUser(
        { groupId: currentGroupId, data: formData },
        {
          onSuccess: () => {
            setIsOpen(false)
            setFormData({ email: '', role: 'VIEWER' })
          },
        }
      )
    }
  }

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="gap-2"
      >
        <UserPlusIcon className="w-5 h-5" />
        Invitar Usuario
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`Invitar a ${currentGroup?.name}`}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email del Usuario"
            type="email"
            name="email"
            placeholder="usuario@email.com"
            value={formData.email}
            onChange={handleChange}
            error={errors.email}
          />

          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Rol</span>
            </label>
            <select
              name="role"
              className="select select-bordered w-full"
              value={formData.role}
              onChange={handleChange}
            >
              <option value="VIEWER">Viewer - Solo ver</option>
              <option value="OPERATOR">Operador - Ver y editar</option>
              <option value="ADMIN">Admin - Control total</option>
            </select>
          </div>

          <div className="alert alert-info">
            <span className="text-sm">
              Se enviara un link de invitacion al email proporcionado.
              El usuario tiene 7 dias para aceptar.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={isInviting}>
              Enviar Invitacion
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

export default InviteUser
