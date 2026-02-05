// Loading Components
export const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizes = {
    xs: 'loading-xs',
    sm: 'loading-sm',
    md: 'loading-md',
    lg: 'loading-lg',
  }

  return (
    <span className={`loading loading-spinner ${sizes[size]} ${className}`}></span>
  )
}

export const LoadingPage = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200">
      <div className="text-center">
        <LoadingSpinner size="lg" className="text-primary" />
        <p className="mt-4 text-base-content/60">Cargando...</p>
      </div>
    </div>
  )
}

export const LoadingSkeleton = ({ lines = 3, className = '' }) => {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-4 w-full"
          style={{ width: `${100 - i * 15}%` }}
        ></div>
      ))}
    </div>
  )
}

export default LoadingSpinner
