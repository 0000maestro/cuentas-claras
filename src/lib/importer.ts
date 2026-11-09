import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import type { ImportMapping } from './types'

export type Grid = (string | number | null)[][]

export async function readFileToGrid(file: File): Promise<Grid> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text()
    const res = Papa.parse<string[]>(text, { skipEmptyLines: true })
    return res.data.map(r => r.map(c => (c === '' ? null : c)))
  }
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, { header: 1, raw: true, defval: null })
  return rows.map(r => r.map(c => (c instanceof Date ? toISODate(c) : c)))
}

function toISODate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const HEADER_HINTS = {
  date: ['fecha', 'date', 'fec'],
  description: ['descripci', 'detalle', 'glosa', 'movimiento', 'concepto', 'description', 'transacci'],
  debit: ['cargo', 'débito', 'debito', 'giro', 'egreso', 'salida', 'debit'],
  credit: ['abono', 'crédito', 'credito', 'depósito', 'deposito', 'ingreso', 'entrada', 'credit'],
  amount: ['monto', 'importe', 'valor', 'amount', 'total'],
  balance: ['saldo', 'balance'],
}

export function detectHeaderRow(grid: Grid): number {
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const cells = grid[i].filter(c => c !== null && String(c).trim() !== '').map(c => String(c).toLowerCase())
    if (cells.length < 3) continue
    const hasDate = cells.some(c => HEADER_HINTS.date.some(h => c.includes(h)))
    const hasDesc = cells.some(c => HEADER_HINTS.description.some(h => c.includes(h)))
    const hasAmt = cells.some(c => [...HEADER_HINTS.debit, ...HEADER_HINTS.credit, ...HEADER_HINTS.amount].some(h => c.includes(h)))
    if (hasDate && (hasDesc || hasAmt)) return i
  }
  return 0
}

export function headersAt(grid: Grid, row: number): string[] {
  return (grid[row] ?? []).map((c, i) => (c === null || String(c).trim() === '' ? `Columna ${i + 1}` : String(c).trim()))
}

export function guessMapping(headers: string[]): ImportMapping {
  const find = (hints: string[]) => headers.find(h => hints.some(k => h.toLowerCase().includes(k))) ?? ''
  const debit = find(HEADER_HINTS.debit)
  const credit = find(HEADER_HINTS.credit)
  const m: ImportMapping = {
    date: find(HEADER_HINTS.date),
    description: find(HEADER_HINTS.description),
    balance: find(HEADER_HINTS.balance) || undefined,
    dateFormat: 'dmy',
    headerRow: 0,
    debitIsPositive: true,
  }
  if (debit || credit) { m.debit = debit || undefined; m.credit = credit || undefined }
  else m.amount = find(HEADER_HINTS.amount) || undefined
  return m
}

export function parseNumber(v: string | number | null): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '').replace(/CLP/i, '')
  if (!s || s === '-') return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[()-]/g, '')
  // formato chileno: 1.234.567,89 — si hay coma la tomamos como decimal
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '')
  else if (/\.\d{3}$/.test(s)) s = s.replace('.', '') // 12.500 → 12500
  const n = Number(s)
  if (Number.isNaN(n)) return null
  return neg ? -n : n
}

export function parseDate(v: string | number | null, fmt: ImportMapping['dateFormat']): string | null {
  if (v === null || v === '') return null
  if (typeof v === 'number') {
    // serial de Excel
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    let a = Number(m[1]), b = Number(m[2]), y = Number(m[3])
    if (y < 100) y += 2000
    const [d, mo] = fmt === 'mdy' ? [b, a] : [a, b]
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const m2 = s.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`
  return null
}

export interface ParsedRow {
  posted_at: string
  description: string
  amount: number
  balance_after: number | null
  fingerprint: string
  raw: number // índice de fila original
}

export function applyMapping(grid: Grid, headers: string[], m: ImportMapping): { rows: ParsedRow[]; skipped: number } {
  const idx = (name?: string) => (name ? headers.indexOf(name) : -1)
  const iDate = idx(m.date), iDesc = idx(m.description), iAmt = idx(m.amount), iDeb = idx(m.debit), iCre = idx(m.credit), iBal = idx(m.balance)
  const rows: ParsedRow[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  for (let r = m.headerRow + 1; r < grid.length; r++) {
    const row = grid[r]
    if (!row || row.every(c => c === null || String(c).trim() === '')) continue
    const date = iDate >= 0 ? parseDate(row[iDate], m.dateFormat) : null
    const desc = iDesc >= 0 && row[iDesc] != null ? String(row[iDesc]).trim() : ''
    let amount: number | null = null
    if (iAmt >= 0) amount = parseNumber(row[iAmt])
    else {
      const deb = iDeb >= 0 ? parseNumber(row[iDeb]) : null
      const cre = iCre >= 0 ? parseNumber(row[iCre]) : null
      if (deb != null && deb !== 0) amount = -Math.abs(deb) * (m.debitIsPositive ? 1 : -1)
      if (cre != null && cre !== 0) amount = (amount ?? 0) + Math.abs(cre)
      if (deb != null && !m.debitIsPositive && deb < 0) amount = deb
    }
    if (!date || amount === null || Number.isNaN(amount)) { skipped++; continue }
    const balance = iBal >= 0 ? parseNumber(row[iBal]) : null
    const key = `${date}|${desc.toLowerCase()}|${amount}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    rows.push({ posted_at: date, description: desc || '(sin descripción)', amount, balance_after: balance, fingerprint: hash(`${key}|${n}`), raw: r })
  }
  return { rows, skipped }
}

function hash(s: string): string {
  // FNV-1a 32 bits, suficiente para detectar duplicados por cuenta
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16)
}
