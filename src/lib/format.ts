import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})

export function money(n: number | null | undefined, opts?: { sign?: boolean }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const s = clp.format(Math.abs(n))
  if (opts?.sign) return n < 0 ? `−${s}` : n > 0 ? `+${s}` : s
  return n < 0 ? `−${s}` : s
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? '−' : ''}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)} M`
  if (abs >= 1_000) return `${n < 0 ? '−' : ''}$${Math.round(abs / 1000)} mil`
  return money(n)
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseISO(iso), 'd MMM yyyy', { locale: es })
}

export function dateDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseISO(iso), 'd MMM', { locale: es })
}

export function monthLabel(iso: string): string {
  const d = parseISO(iso.length === 7 ? `${iso}-01` : iso)
  const s = format(d, 'MMMM yyyy', { locale: es })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function monthKey(d: Date): string {
  return format(d, 'yyyy-MM-01')
}

export function firstDayOfMonth(iso: string): string {
  return iso.slice(0, 7) + '-01'
}

export function lastDayOfMonth(iso: string): string {
  const d = parseISO(iso.slice(0, 7) + '-01')
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return format(end, 'yyyy-MM-dd')
}

export function addMonths(iso: string, n: number): string {
  const d = parseISO(iso.slice(0, 7) + '-01')
  return format(new Date(d.getFullYear(), d.getMonth() + n, 1), 'yyyy-MM-01')
}

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export function seriesColor(slot: number): string {
  return SERIES[(Math.max(1, slot) - 1) % SERIES.length]
}
