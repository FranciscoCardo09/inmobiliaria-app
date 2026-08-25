import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import './index.css'

const queryClient = new QueryClient({
  // Todos los reportes (queryKey ['report', ...]) son DERIVADOS: el backend los
  // recalcula al vuelo a partir de records, servicios, pagos, deudas y contratos.
  // Ningún hook los invalidaba, así que editar un servicio refrescaba Control
  // Mensual y dejaba la Liquidación mostrando los números viejos hasta que
  // venciera su staleTime (caso Godoy, 2026-08-25: se cambió el ajuste de
  // DESCUENTO a BONIFICACION y el reporte siguió mostrando la cifra anterior,
  // haciendo parecer que la regla de honorarios no distinguía las categorías).
  //
  // Se invalida acá, en un único lugar, en vez de en cada hook: cualquier
  // mutación nueva queda cubierta sin que haya que acordarse de agregarla.
  // Invalidar una query inactiva no dispara ningún request — solo la marca
  // obsoleta para el próximo montaje. Las descargas de reportes no pasan por
  // acá (son funciones async sueltas, no useMutation).
  mutationCache: new MutationCache({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report'] })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes (keep unused cache longer)
      retry: 1,
      // Evita re-disparar los endpoints pesados (dashboard/summary,
      // monthly-records) cada vez que se vuelve a la pestaña. Los datos
      // igual se refrescan por invalidación tras mutaciones.
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1f2937',
              color: '#fff',
            },
            success: {
              iconTheme: {
                primary: '#22c55e',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
