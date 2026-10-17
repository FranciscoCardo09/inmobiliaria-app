// Permisos del grupo actual: VIEWER sólo mira; OPERATOR clasifica y genera;
// ADMIN además reabre meses cerrados y borra.
import { useAuthStore } from '../../stores/authStore'

export function useCanEdit() {
  const role = useAuthStore((s) => s.groups.find((g) => g.id === s.currentGroupId)?.role)
  return { canEdit: role === 'ADMIN' || role === 'OPERATOR', isAdmin: role === 'ADMIN' }
}
