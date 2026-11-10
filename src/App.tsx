import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useApp } from './state/AppContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Recurring from './pages/Recurring'
import Debts from './pages/Debts'
import Import from './pages/Import'
import Savings from './pages/Savings'
import Settings from './pages/Settings'
import Welcome from './pages/Welcome'

export default function App() {
  const { session, loadingSession, orgs, org, canEdit } = useApp()
  const loc = useLocation()

  if (loadingSession) return <Splash />
  if (!session) return <Login />
  if (orgs.length === 0) return <NoAccess />
  if (!org) return <Splash />
  if (loc.pathname === '/' && canEdit && !org.onboarding?.done && !sessionStorage.getItem('cc.skipWelcome')) {
    return <Navigate to="/bienvenida" replace />
  }

  return (
    <Routes>
      <Route path="bienvenida" element={<Welcome />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="movimientos" element={<Transactions />} />
        <Route path="recurrentes" element={<Recurring />} />
        <Route path="deudas" element={<Debts />} />
        <Route path="ahorros" element={<Savings />} />
        <Route path="importar" element={<Import />} />
        <Route path="configuracion" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function Splash() {
  return (
    <div className="h-full grid place-items-center text-ink-3">
      <div className="flex items-center gap-3">
        <span className="inline-block size-2 rounded-full bg-accent animate-pulse" />
        Cargando…
      </div>
    </div>
  )
}
