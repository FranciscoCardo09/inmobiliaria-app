// Reusable Input Component
export const Input = ({
  label,
  type = 'text',
  error,
  className = '',
  ...props
}) => {
  return (
    <div className="form-control w-full">
      {label && (
        <label className="label">
          <span className="label-text font-medium">{label}</span>
        </label>
      )}
      <input
        type={type}
        className={`input input-bordered w-full ${error ? 'input-error' : ''} ${className}`}
        {...props}
      />
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  )
}

export default Input
