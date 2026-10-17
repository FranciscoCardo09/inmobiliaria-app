// Campo para el texto de una línea del informe, con variables y vista previa:
// "Honorarios Administración ({mesAnterior})" → "Honorarios Administración (Junio - 26)".
import { LABEL_VARIABLES, renderLabelPreview } from '../../utils/consorcio'

export default function LabelInput({ value, onChange, year, month, options = [], label = 'Texto en el informe', id = 'label-input' }) {
  const now = new Date()
  const preview = renderLabelPreview(value, year || now.getFullYear(), month || now.getMonth() + 1)
  return (
    <div className="form-control w-full">
      <label className="label" htmlFor={id}><span className="label-text font-medium">{label}</span></label>
      <input id={id} list={`${id}-options`} className="input input-bordered w-full" value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-options`}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
      <div className="mt-1 text-xs space-y-1">
        {value && (
          <div>
            Se imprime: <span className="font-medium">“{preview.text}”</span>
          </div>
        )}
        {preview.unknown.length > 0 && (
          <div className="text-error">No existe {preview.unknown.map((u) => `{${u}}`).join(', ')}.</div>
        )}
        <div className="flex flex-wrap gap-1 text-base-content/60">
          Variables:
          {LABEL_VARIABLES.map((v) => (
            <button key={v.name} type="button" className="badge badge-ghost badge-sm" title={v.help} onClick={() => onChange(`${value || ''}{${v.name}}`)}>
              {`{${v.name}}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
