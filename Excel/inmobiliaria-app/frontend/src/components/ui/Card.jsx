// Reusable Card Component
export const Card = ({
  children,
  title,
  subtitle,
  actions,
  className = '',
  compact = false,
}) => {
  return (
    <div className={`card bg-base-100 shadow-md ${compact ? 'card-compact' : ''} ${className}`}>
      <div className="card-body">
        {(title || subtitle) && (
          <div className="flex items-start justify-between">
            <div>
              {title && <h2 className="card-title">{title}</h2>}
              {subtitle && <p className="text-sm text-base-content/60">{subtitle}</p>}
            </div>
            {actions && <div className="card-actions">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export default Card
