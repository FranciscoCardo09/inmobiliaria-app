import { useMemo } from 'react'

const DISCOUNT_CATEGORIES = ['DESCUENTO', 'BONIFICACION']

export function useMonthlyFiltering(allRecords = [], filters = {}) {
  const {
    statusFilter,
    contractTypeFilter,
    searchFilter,
    sortColumn,
    sortDirection,
    serviceFilter,
    serviceMode,
    mesOperator,
    mesValue,
    ivaFilter,
  } = filters;

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

    // Service filter (paga este servicio / solo paga este servicio)
    if (serviceFilter) {
      filtered = filtered.filter((r) => {
        const services = (r.services || []).filter(
          (s) => !DISCOUNT_CATEGORIES.includes(s.conceptType?.category)
        )
        if (serviceMode === 'ONLY') {
          return services.length > 0 && services.every((s) => s.conceptType?.id === serviceFilter)
        }
        return services.some((s) => s.conceptType?.id === serviceFilter)
      })
    }

    // Month-of-contract filter (compares against the "Mes N" shown in periodLabel)
    if (mesValue !== '' && mesValue != null && !Number.isNaN(Number(mesValue))) {
      const target = Number(mesValue)
      filtered = filtered.filter((r) => {
        const match = /Mes\s+(\d+)/.exec(r.periodLabel || '')
        if (!match) return false
        const mesNum = Number(match[1])
        switch (mesOperator) {
          case 'gt': return mesNum > target
          case 'lt': return mesNum < target
          case 'gte': return mesNum >= target
          case 'lte': return mesNum <= target
          case 'eq':
          default: return mesNum === target
        }
      })
    }

    // IVA filter
    if (ivaFilter) {
      filtered = filtered.filter((r) => {
        const hasIva = !!(r.includeIva || r.ivaAmount > 0)
        return ivaFilter === 'CON' ? hasIva : !hasIva
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
  }, [
    allRecords,
    statusFilter,
    searchFilter,
    contractTypeFilter,
    sortColumn,
    sortDirection,
    serviceFilter,
    serviceMode,
    mesOperator,
    mesValue,
    ivaFilter,
  ])

  const showIvaColumn = useMemo(() => {
    return allRecords.some(
      (r) => r.ivaAmount > 0 || r.includeIva || r.contract?.pagaIva || ['LOCAL COMERCIAL', 'LOCAL'].includes(r.property?.category?.name)
    )
  }, [allRecords])

  return { filteredRecords, showIvaColumn }
}
