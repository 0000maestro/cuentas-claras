import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4 mb-5 lg:mb-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-ink-2 mt-1 max-w-[70ch]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="font-medium">{title}</div>
      {body && <p className="text-ink-2 mt-1 max-w-[52ch] mx-auto">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className={`relative card w-full ${width} shadow-xl max-h-[84vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-ink-2 mb-1 text-[13px]">{label}</span>
      {children}
      {hint && <span className="block text-ink-3 text-[12px] mt-1">{hint}</span>}
    </label>
  )
}

export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  const cls = {
    neutral: 'bg-line/60 text-ink-2',
    good: 'bg-income-soft text-income',
    warn: 'bg-warn-soft text-[#8a5c00]',
    bad: 'bg-bad-soft text-bad',
    accent: 'bg-accent-soft text-accent',
  }[tone]
  return <span className={`chip ${cls}`}>{children}</span>
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-income' : tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <div className="card px-5 py-4">
      <div className="text-ink-2 text-[13px]">{label}</div>
      <div className={`num text-[24px] font-semibold tracking-tight mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-ink-3 text-[12.5px] mt-1">{sub}</div>}
    </div>
  )
}

export function Spinner() {
  return <span className="inline-block size-3.5 rounded-full border-2 border-line-2 border-t-accent animate-spin" aria-label="Cargando" />
}
