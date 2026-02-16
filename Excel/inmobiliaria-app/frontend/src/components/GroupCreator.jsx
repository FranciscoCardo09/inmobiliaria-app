// Group Creator Component
import { useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { useGroups } from '../hooks/useGroups'
import Modal from './ui/Modal'
import Input from './ui/Input'
import Button from './ui/Button'

export const GroupCreator = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  })
  const [errors, setErrors] = useState({})
  const { createGroup, isCreating } = useGroups()

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }))
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.name || formData.name.length < 2) {
      newErrors.name = 'Nombre debe tener al menos 2 caracteres'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (validate()) {
      createGroup(formData, {
        onSuccess: () => {
          setIsOpen(false)
          setFormData({ name: '', description: '' })
        },
      })
    }
  }

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="primary"
        className="gap-2"
      >
        <PlusIcon className="w-5 h-5" />
        Crear Grupo
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Crear Nuevo Grupo"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre del Grupo"
            name="name"
            placeholder="Ej: Gestion Alquileres"
            value={formData.name}
            onChange={handleChange}
            error={errors.name}
          />

          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Descripcion (opcional)</span>
            </label>
            <textarea
              name="description"
              className="textarea textarea-bordered h-24"
              placeholder="Describe tu inmobiliaria..."
              value={formData.description}
              onChange={handleChange}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={isCreating}>
              Crear Grupo
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

export default GroupCreator
