import { useMemo } from 'react'

export function useMonthlyFiltering(allRecords = [], filters = {}) {
  const { statusFilter, contractTypeFilter, searchFilter, sortColumn, sortDirection } = filters;

  const filteredRecords = useMemo(() => {
    let filtered = allRecords

    // Debt filter
    if (statusFilter === 'HAS_DEBT') {
      filtered = filtered.filter((r) => r.debtInfo && r.debtInfo.status !== 'PAID')
    }

    // Contract type filter
    if (contractTypeFilter) {
      filtered = filtered.filter((r) => (r.contractType || 'INQUILINO') === contractTypeFilter)
    }

    // Text search filter (client-side, instant)
    if (searchFilter?.trim()) {
      const term = searchFilter.toLowerCase().trim()
      filtered = filtered.filter((r) => {
        const tenant = (r.tenants?.length > 0 ? r.tenants.map(t => t.name).join(' / ') : r.tenant?.name || '').toLowerCase()
        const address = (r.property?.address || '').toLowerCase()
        const owner = (r.owner?.name || '').toLowerCase()
        return tenant.includes(term) || address.includes(term) || owner.includes(term)
      })
    }

    // Apply sorting
    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let valA, valB
        switch (sortColumn) {
          case 'propiedad':
            valA = (a.property?.address || '').toLowerCase()
            valB = (b.property?.address || '').toLowerCase()
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          case 'dueno':
            valA = (a.owner?.name || '').toLowerCase()
            valB = (b.owner?.name || '').toLowerCase()
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          case 'inquilino': {
            const tenantA = a.tenants?.length > 0 ? a.tenants.map(t => t.name).join(' / ') : a.tenant?.name || ''
            const tenantB = b.tenants?.length > 0 ? b.tenants.map(t => t.name).join(' / ') : b.tenant?.name || ''
            valA = tenantA.toLowerCase()
            valB = tenantB.toLowerCase()
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          }
          case 'mes':
            valA = a.monthNumber || 0
            valB = b.monthNumber || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          case 'alquiler':
            valA = a.rentAmount || 0
            valB = b.rentAmount || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          case 'total':
            valA = a.totalHistorico || a.liveTotalDue || a.totalDue || 0
            valB = b.totalHistorico || b.liveTotalDue || b.totalDue || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          case 'pagado':
            valA = a.amountPaid || 0
            valB = b.amountPaid || 0
            return sortDirection === 'asc' ? valA - valB : valB - valA
          default:
            return 0
        }
      })
    }

    return filtered
  }, [allRecords, statusFilter, searchFilter, contractTypeFilter, sortColumn, sortDirection])

  const showIvaColumn = useMemo(() => {
    return allRecords.some(
      (r) => r.ivaAmount > 0 || r.includeIva || r.contract?.pagaIva || ['LOCAL COMERCIAL', 'LOCAL'].includes(r.property?.category?.name)
    )
  }, [allRecords])

  return { filteredRecords, showIvaColumn }
}
