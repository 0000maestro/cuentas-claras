import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LayoutGrid, List, Repeat, Landmark, Upload, Settings, LogOut, Menu, X, PiggyBank } from 'lucide-react'
import { useApp } from '../state/AppContext'
import Wordmark from './Wordmark'
import { addMonths, monthLabel, seriesColor } from '../lib/format'

const nav = [
  { to: '/', label: 'Panel', icon: LayoutGrid, end: true },
  { to: '/movimientos', label: 'Movimientos', icon: List },
  { to: '/recurrentes', label: 'Costos recurrentes', icon: Repeat },
  { to: '/deudas', label: 'Deudas', icon: Landmark },
  { to: '/ahorros', label: 'Ahorros y comisión', icon: PiggyBank },
  { to: '/importar', label: 'Importar cartolas', icon: Upload },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]

export default function Layout() {
  const { org, orgs, setOrgId, entities, entityId, setEntityId, month, setMonth, session, signOut } = useApp()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname, entityId])

  return (
    <div className="min-h-full flex">
      {open && <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`w-[232px] shrink-0 border-r border-line bg-sheet flex-col h-screen z-40 ${open ? 'flex fixed top-0 left-0 shadow-xl' : 'hidden'} lg:flex lg:sticky lg:top-0`}>
        <div className="px-4 h-14 flex items-center justify-between border-b border-line">
          <Wordmark />
          <button className="btn btn-ghost btn-sm -mr-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X size={16} /></button>
        </div>
        <div className="px-3 pt-3">
          {orgs.length > 1 ? (
            <select
              className="input text-[13px] py-1.5"
              value={org?.id ?? ''}
              onChange={e => setOrgId(e.target.value)}
              aria-label="Organización"
            >
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <div className="px-1 text-[13px] text-ink-2 font-medium truncate">{org?.name}</div>
          )}
        </div>
        <nav className="px-2 pt-3 flex flex-col gap-0.5">
          {nav.map(n => (
            <NavLink
              key={n.to} to={n.to} end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] ${
                  isActive ? 'bg-accent-soft text-accent font-medium' : 'text-ink-2 hover:bg-paper hover:text-ink'
                }`
              }
            >
              <n.icon size={16} strokeWidth={1.75} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pt-6">
          <div className="text-[12px] text-ink-3 px-1 mb-1.5">Ver</div>
          <div className="flex flex-col gap-0.5">
            <EntityButton active={entityId === null} onClick={() => setEntityId(null)} label="Todo" color={null} />
            {entities.map(e => (
              <EntityButton
                key={e.id} active={entityId === e.id} onClick={() => setEntityId(e.id)}
                label={e.name} color={seriesColor(e.color_slot)} kind={e.kind}
              />
            ))}
          </div>
        </div>

        <div className="mt-auto p-3 border-t border-line">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] text-ink-3 truncate" title={session?.user.email ?? ''}>{session?.user.email}</div>
            <button className="btn btn-ghost btn-sm -mr-1" onClick={() => signOut()} title="Salir">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-line bg-sheet/80 backdrop-blur sticky top-0 z-10 flex items-center justify-between px-3 lg:px-6 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button className="btn btn-ghost btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu size={18} /></button>
            <div className="text-ink-2 text-[13px] truncate">
              {entityId ? entities.find(e => e.id === entityId)?.name : 'Todas las entidades'}
            </div>
          </div>
          <div className="flex items-center gap-0.5 lg:gap-1 shrink-0">
            <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mes anterior">
              <ChevronLeft size={16} />
            </button>
            <div className="w-28 lg:w-40 text-center font-medium text-[13px] lg:text-[14px]">{monthLabel(month)}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente">
              <ChevronRight size={16} />
            </button>
          </div>
        </header>
        <main className="flex-1 p-3 lg:p-6 max-w-[1280px] w-full min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function EntityButton({ active, onClick, label, color, kind }: {
  active: boolean; onClick: () => void; label: string; color: string | null; kind?: 'persona' | 'empresa'
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-left ${
        active ? 'bg-paper text-ink font-medium' : 'text-ink-2 hover:bg-paper'
      }`}
    >
      <span
        className="inline-block size-2.5 shrink-0"
        style={{
          background: color ?? '#8a9097',
          borderRadius: kind === 'persona' ? '999px' : '2px',
        }}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </button>
  )
}
