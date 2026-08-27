/**
 * Invalidación compartida de todo lo que muestra plata de un grupo.
 *
 * Existe porque la lista estaba duplicada y DIVERGIDA en varios hooks/componentes, y esa
 * deriva era un bug real: `useMonthlyServices` invalidaba `monthlyRecords`/`monthlyRecord`/
 * `monthlyServices` pero NINGUNA key de deuda, aunque el backend sincroniza la `Debt` del mes
 * en cada alta/edición/borrado de servicio (`monthlyServiceService.settleRecordsWithDebt`).
 * Resultado: se borraba un DESCUENTO de un mes ya cerrado en deuda y la ficha de Deuda, el
 * modal de pago de deuda y "Pagar varias" seguían mostrando el monto viejo (caso Ciuro,
 * mayo 2026). El toggle de IVA sí las invalidaba — de ahí se sacó la lista completa.
 *
 * Se usa `invalidateQueries`, NO `removeQueries`: con un modal de pago abierto, borrar la
 * entrada de `punitoryPreview` deja el dato en `undefined` y el modal cae a 0, mostrando un
 * total equivocado por un instante. Invalidar conserva el dato previo mientras refetchea.
 */
export const invalidateMoneyQueries = (queryClient, groupId) => Promise.all([
  // Control Mensual: grilla, detalle, servicios y la variante de la pantalla de Pago
  queryClient.invalidateQueries({ queryKey: ['monthlyRecords', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['monthlyRecord', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['monthlyServices', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['punitoryPreview', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['canPayCurrentMonth', groupId] }),
  // Deudas: ficha, listado, resumen y los dos previews de pago
  queryClient.invalidateQueries({ queryKey: ['debt', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['debts', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['debtsSummary', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['debtPunitoryPreview', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['bulkDebtPreview', groupId] }),
  // Historial y tablero
  queryClient.invalidateQueries({ queryKey: ['paymentTransactions', groupId] }),
  queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary', groupId] }),
])
