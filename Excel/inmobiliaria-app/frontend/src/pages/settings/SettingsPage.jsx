// Settings Page - Group company configuration
import { useState, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useSettings } from '../../hooks/useSettings'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { LoadingPage } from '../../components/ui/Loading'
import EmptyState from '../../components/ui/EmptyState'
import {
  Cog6ToothIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

const MAX_LOGO_SIZE = 2 * 1024 * 1024 // 2MB

export default function SettingsPage() {
  const currentGroupId = useAuthStore((s) => s.currentGroupId)
  const { settings, isLoading, updateSettings, isUpdating } = useSettings(currentGroupId)

  const [form, setForm] = useState({
    companyName: '',
    address: '',
    phone: '',
    email: '',
    cuit: '',
    localidad: '',
    logo: '',
    ingBrutos: '',
    fechaInicioAct: '',
    ivaCondicion: '',
    subtitulo: '',
    bankName: '',
    bankHolder: '',
    bankCuit: '',
    bankAccountType: '',
    bankAccountNumber: '',
    bankCbu: '',
  })
  const [logoPreview, setLogoPreview] = useState('')
  const [logoError, setLogoError] = useState('')

  // Sync form when settings load
  useEffect(() => {
    if (settings) {
      setForm({
        companyName: settings.companyName || '',
        address: settings.address || '',
        phone: settings.phone || '',
        email: settings.email || '',
        cuit: settings.cuit || '',
        localidad: settings.localidad || '',
        logo: settings.logo || '',
        ingBrutos: settings.ingBrutos || '',
        fechaInicioAct: settings.fechaInicioAct || '',
        ivaCondicion: settings.ivaCondicion || '',
        subtitulo: settings.subtitulo || '',
        bankName: settings.bankName || '',
        bankHolder: settings.bankHolder || '',
        bankCuit: settings.bankCuit || '',
        bankAccountType: settings.bankAccountType || '',
        bankAccountNumber: settings.bankAccountNumber || '',
        bankCbu: settings.bankCbu || '',
      })
      if (settings.logo) {
        setLogoPreview(settings.logo)
      }
    }
  }, [settings])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLogoError('')

    if (file.size > MAX_LOGO_SIZE) {
      setLogoError('El logo no puede superar 2MB')
      return
    }

    if (!file.type.startsWith('image/')) {
      setLogoError('Solo se permiten archivos de imagen')
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const base64 = ev.target.result
      setForm((prev) => ({ ...prev, logo: base64 }))
      setLogoPreview(base64)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    setForm((prev) => ({ ...prev, logo: '' }))
    setLogoPreview('')
    setLogoError('')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    updateSettings(form)
  }

  if (!currentGroupId) {
    return <EmptyState title="Sin grupo" description="Selecciona un grupo para configurar" />
  }

  if (isLoading) return <LoadingPage />

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Cog6ToothIcon className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Configuracion</h1>
          <p className="text-sm text-base-content/60">Datos de la inmobiliaria para reportes y documentos</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Company Info */}
        <Card title="Datos de la Empresa">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div className="sm:col-span-2">
              <label className="label"><span className="label-text font-medium">Nombre de la Empresa</span></label>
              <input
                type="text"
                name="companyName"
                className="input input-bordered w-full"
                value={form.companyName}
                onChange={handleChange}
                placeholder="Inmobiliaria Ejemplo S.R.L."
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">CUIT</span></label>
              <input
                type="text"
                name="cuit"
                className="input input-bordered w-full"
                value={form.cuit}
                onChange={handleChange}
                placeholder="20-12345678-9"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">Localidad</span></label>
              <input
                type="text"
                name="localidad"
                className="input input-bordered w-full"
                value={form.localidad}
                onChange={handleChange}
                placeholder="Ciudad, Provincia"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label"><span className="label-text font-medium">Direccion</span></label>
              <input
                type="text"
                name="address"
                className="input input-bordered w-full"
                value={form.address}
                onChange={handleChange}
                placeholder="Av. Ejemplo 1234, Piso 2"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">Telefono</span></label>
              <input
                type="text"
                name="phone"
                className="input input-bordered w-full"
                value={form.phone}
                onChange={handleChange}
                placeholder="+54 11 1234-5678"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">Email</span></label>
              <input
                type="email"
                name="email"
                className="input input-bordered w-full"
                value={form.email}
                onChange={handleChange}
                placeholder="contacto@inmobiliaria.com"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label"><span className="label-text font-medium">Subtitulo (para reportes)</span></label>
              <input
                type="text"
                name="subtitulo"
                className="input input-bordered w-full"
                value={form.subtitulo}
                onChange={handleChange}
                placeholder="Asesores Inmobiliarios"
              />
            </div>
          </div>
        </Card>

        {/* Fiscal Data */}
        <Card title="Datos Fiscales" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="label"><span className="label-text font-medium">Ingresos Brutos</span></label>
              <input
                type="text"
                name="ingBrutos"
                className="input input-bordered w-full"
                value={form.ingBrutos}
                onChange={handleChange}
                placeholder="N° Ingresos Brutos"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">Fecha Inicio Actividad</span></label>
              <input
                type="text"
                name="fechaInicioAct"
                className="input input-bordered w-full"
                value={form.fechaInicioAct}
                onChange={handleChange}
                placeholder="01/01/2020"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label"><span className="label-text font-medium">Condicion IVA</span></label>
              <input
                type="text"
                name="ivaCondicion"
                className="input input-bordered w-full"
                value={form.ivaCondicion}
                onChange={handleChange}
                placeholder="IVA Responsable Monotributo"
              />
            </div>
          </div>
        </Card>

        {/* Bank Account */}
        <Card title="Datos Bancarios (para reportes)" className="mt-4">
          <p className="text-sm text-base-content/50 mt-1">Estos datos se usan por defecto en los reportes de impuestos cuando el propietario no tiene datos bancarios propios.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div>
              <label className="label"><span className="label-text font-medium">Banco</span></label>
              <input
                type="text"
                name="bankName"
                className="input input-bordered w-full"
                value={form.bankName}
                onChange={handleChange}
                placeholder="Banco Nacion"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">Titular</span></label>
              <input
                type="text"
                name="bankHolder"
                className="input input-bordered w-full"
                value={form.bankHolder}
                onChange={handleChange}
                placeholder="Nombre del titular"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">CUIT Titular</span></label>
              <input
                type="text"
                name="bankCuit"
                className="input input-bordered w-full"
                value={form.bankCuit}
                onChange={handleChange}
                placeholder="20-12345678-9"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">Tipo de Cuenta</span></label>
              <input
                type="text"
                name="bankAccountType"
                className="input input-bordered w-full"
                value={form.bankAccountType}
                onChange={handleChange}
                placeholder="Caja de Ahorro"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">N° de Cuenta</span></label>
              <input
                type="text"
                name="bankAccountNumber"
                className="input input-bordered w-full"
                value={form.bankAccountNumber}
                onChange={handleChange}
                placeholder="1234567890"
              />
            </div>
            <div>
              <label className="label"><span className="label-text font-medium">CBU</span></label>
              <input
                type="text"
                name="bankCbu"
                className="input input-bordered w-full"
                value={form.bankCbu}
                onChange={handleChange}
                placeholder="0000000000000000000000"
              />
            </div>
          </div>
        </Card>

        {/* Logo */}
        <Card title="Logo" className="mt-4">
          <div className="mt-3">
            {logoPreview ? (
              <div className="flex items-start gap-4">
                <div className="border border-base-300 rounded-lg p-2 bg-base-200">
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="max-h-32 max-w-[200px] object-contain"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="btn btn-sm btn-ghost btn-circle"
                  title="Quitar logo"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-base-300 rounded-lg cursor-pointer hover:bg-base-200 transition-colors">
                <PhotoIcon className="w-10 h-10 text-base-content/30 mb-2" />
                <span className="text-sm text-base-content/50">Click para subir logo (max 2MB)</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </label>
            )}
            {logoPreview && (
              <label className="btn btn-sm btn-ghost mt-2 gap-1">
                <PhotoIcon className="w-4 h-4" />
                Cambiar logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </label>
            )}
            {logoError && (
              <p className="text-error text-sm mt-2">{logoError}</p>
            )}
          </div>
        </Card>

        {/* Submit */}
        <div className="mt-6 flex justify-end">
          <Button
            type="submit"
            className="btn-primary"
            disabled={isUpdating}
          >
            {isUpdating ? 'Guardando...' : 'Guardar Configuracion'}
          </Button>
        </div>
      </form>
    </div>
  )
}
