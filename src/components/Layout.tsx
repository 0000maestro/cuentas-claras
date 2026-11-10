import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LayoutGrid, List, Repeat, Landmark, Upload, Settings, LogOut, Ellipsis, X, Sparkles, PiggyBank } from 'lucide-react'
import { useApp } from '../state/AppContext'
import Wordmark from './Wordmark'
import { addMonths, monthLabel, seriesColor } from '../lib/format'

const nav = [
  { to: '/', label: 'Panel', icon: LayoutGrid, end: true },
  { to: '/movimientos', label: 'Movimientos', icon: List },
  { to: '/recurrentes', label: 'Costos recurrentes', icon: Repeat },
  { to: '/deudas', label: 'Deudas', icon: Landmark },
  { to: '/ahorros', label: 'Ahorros y comisión', icon: PiggyBank },
  { to: '/importar', label: 'Subir archivos', icon: Upload },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]

export default function Layout() {
  const { org, orgs, setOrgId, entities, entityId, setEntityId, month, setMonth, session, signOut, canEdit } = useApp()
  const [more, setMore] = useState(false)
  const loc = useLocation()
  useEffect(() => { setMore(false) }, [loc.pathname, entityId])

  const orgPicker = orgs.length > 1 ? (
    <select className="input text-[13px] py-1.5" value={org?.id ?? ''} onChange={e => setOrgId(e.target.value)} aria-label="Organización">
      {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  ) : <div className="px-1 text-[13px] text-ink-2 font-medium truncate">{org?.name}</div>

  return (
    <div className="min-h-full flex">
      {/* Escritorio: barra lateral */}
      <aside className="hidden lg:flex w-[232px] shrink-0 border-r border-line bg-sheet flex-col h-screen sticky top-0">
        <div className="px-4 h-14 flex items-center border-b border-line"><Wordmark /></div>
        <div className="px-3 pt-3">{orgPicker}</div>
        <nav className="px-2 pt-3 flex flex-col gap-0.5">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] ${isActive ? 'bg-accent-soft text-accent font-medium' : 'text-ink-2 hover:bg-paper hover:text-ink'}`}>
              <n.icon size={16} strokeWidth={1.75} />{n.label}
            </NavLink>
          ))}
          {canEdit && !org?.onboarding?.done && (
            <NavLink to="/bienvenida" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-ink-2 hover:bg-paper hover:text-ink">
              <Sparkles size={16} strokeWidth={1.75} />Configuración inicial
            </NavLink>
          )}
        </nav>
        <div className="px-3 pt-6">
          <div className="text-[12px] text-ink-3 px-1 mb-1.5">Ver</div>
          <div className="flex flex-col gap-0.5">
            <EntityButton active={entityId === null} onClick={() => setEntityId(null)} label="Todo" color={null} />
            {entities.map(e => (
              <EntityButton key={e.id} active={entityId === e.id} onClick={() => setEntityId(e.id)} label={e.name} color={seriesColor(e.color_slot)} kind={e.kind} />
            ))}
          </div>
        </div>
        <div className="mt-auto p-3 border-t border-line">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] text-ink-3 truncate" title={session?.user.email ?? ''}>{session?.user.email}</div>
            <button className="btn btn-ghost btn-sm -mr-1" onClick={() => signOut()} title="Salir"><LogOut size={14} /></button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="border-b border-line bg-sheet/90 backdrop-blur sticky top-0 z-10">
          <div className="h-14 flex items-center justify-between px-3 lg:px-6 gap-2">
            <div className="lg:hidden"><Wordmark compact /></div>
            <div className="hidden lg:block text-ink-2 text-[13px] truncate">{entityId ? entities.find(e => e.id === entityId)?.name : 'Todas las entidades'}</div>
            {/* Celular: a quién estoy mirando */}
            <select className="lg:hidden input py-1.5 text-[13px] min-w-0 flex-1 max-w-[190px]" value={entityId ?? ''} onChange={e => setEntityId(e.target.value || null)} aria-label="Ver">
              <option value="">Todo junto</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <div className="flex items-center shrink-0">
              <button className="btn btn-ghost btn-sm px-1.5" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
              <div className="w-[92px] lg:w-40 text-center font-medium text-[13px] lg:text-[14px] leading-tight">{monthLabel(month)}</div>
              <button className="btn btn-ghost btn-sm px-1.5" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
            </div>
          </div>
        </header>
        <main className="flex-1 p-3 pb-28 lg:p-6 lg:pb-6 max-w-[1280px] w-full min-w-0 overflow-x-clip">
          <Outlet />
        </main>
      </div>

      {/* Celular: barra inferior */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-sheet border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5 items-end h-[60px]">
          <Tab to="/" end icon={LayoutGrid} label="Panel" />
          <Tab to="/movimientos" icon={List} label="Movimientos" />
          <NavLink to="/importar" className="relative h-full flex flex-col items-center justify-end pb-[9px]" aria-label="Subir archivos">
            <span className="absolute -top-5 size-[50px] rounded-full bg-accent text-white grid place-items-center shadow-lg shadow-accent/30 ring-4 ring-sheet"><Upload size={21} /></span>
            <span className="text-[10.5px] leading-none text-ink-2">Subir</span>
          </NavLink>
          <Tab to="/deudas" icon={Landmark} label="Deudas" />
          <button onClick={() => setMore(true)} className="h-full flex flex-col items-center justify-center gap-0.5 text-ink-3">
            <Ellipsis size={20} strokeWidth={1.75} /><span className="text-[10.5px]">Más</span>
          </button>
        </div>
      </nav>

      {more && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setMore(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-sheet rounded-t-2xl p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">{org?.name}</div>
              <button className="btn btn-ghost btn-sm -mr-2" onClick={() => setMore(false)} aria-label="Cerrar"><X size={18} /></button>
            </div>
            {orgs.length > 1 && <div className="mb-3">{orgPicker}</div>}
            <div className="flex flex-col">
              <SheetLink to="/recurrentes" icon={Repeat} label="Costos recurrentes" />
              <SheetLink to="/ahorros" icon={PiggyBank} label="Ahorros y comisión" />
              <SheetLink to="/configuracion" icon={Settings} label="Configuración" />
              {canEdit && !org?.onboarding?.done && <SheetLink to="/bienvenida" icon={Sparkles} label="Configuración inicial" />}
              <button onClick={() => signOut()} className="flex items-center gap-3 py-3 text-ink-2"><LogOut size={18} strokeWidth={1.75} /> Salir <span className="text-ink-3 text-[12px] truncate">({session?.user.email})</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Tab({ to, icon: Icon, label, end }: { to: string; icon: typeof LayoutGrid; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `h-full flex flex-col items-center justify-center gap-0.5 ${isActive ? 'text-accent' : 'text-ink-3'}`}>
      <Icon size={20} strokeWidth={1.75} /><span className="text-[10.5px]">{label}</span>
    </NavLink>
  )
}

function SheetLink({ to, icon: Icon, label }: { to: string; icon: typeof LayoutGrid; label: string }) {
  return <NavLink to={to} className="flex items-center gap-3 py-3 border-b border-line/70"><Icon size={18} strokeWidth={1.75} className="text-ink-2" /> {label}</NavLink>
}

function EntityButton({ active, onClick, label, color, kind }: { active: boolean; onClick: () => void; label: string; color: string | null; kind?: 'persona' | 'empresa' }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-left ${active ? 'bg-paper text-ink font-medium' : 'text-ink-2 hover:bg-paper'}`}>
      <span className="inline-block size-2.5 shrink-0" style={{ background: color ?? '#8a9097', borderRadius: kind === 'persona' ? '999px' : '2px' }} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  )
}
