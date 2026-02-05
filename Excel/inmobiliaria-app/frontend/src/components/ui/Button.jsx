// Reusable Button Component
export const Button = ({
  children,
  type = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  ...props
}) => {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    accent: 'btn-accent',
    ghost: 'btn-ghost',
    link: 'btn-link',
    outline: 'btn-outline',
    error: 'btn-error',
    success: 'btn-success',
    warning: 'btn-warning',
  }

  const sizes = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  }

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`btn ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <span className="loading loading-spinner loading-sm"></span>}
      {children}
    </button>
  )
}

export default Button
