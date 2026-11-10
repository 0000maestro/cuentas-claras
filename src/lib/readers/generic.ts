import type { DraftRow } from './types'

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, set: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
}
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function inferYear(m: number, d: number, today: Date): number {
  const y = today.getFullYear()
  const candidate = new Date(y, m - 1, d)
  // una fecha más de 10 días en el futuro es del año pasado
  return candidate.getTime() - today.getTime() > 10 * 86400000 ? y - 1 : y
}

export interface FoundDate { iso: string; rest: string }

export function findDate(s: string, today = new Date()): FoundDate | null {
  let m = s.match(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/)
  if (m && +m[2] <= 12 && +m[3] <= 31) return { iso: iso(+m[1], +m[2], +m[3]), rest: s.replace(m[0], ' ') }
  m = s.match(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/)
  if (m && +m[1] <= 31 && +m[2] <= 12 && +m[1] > 0 && +m[2] > 0) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return { iso: iso(y, +m[2], +m[1]), rest: s.replace(m[0], ' ') }
  }
  m = s.match(/(?<![\d.,$])(\d{1,2})\s*(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t(?:iembre)?)?|set|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\.?(?:\s*(?:de\s+)?(\d{4}))?(?![a-záéíóú])/i)
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    const mo = MONTHS[m[2].toLowerCase()]
    const y = m[3] ? +m[3] : inferYear(mo, +m[1], today)
    return { iso: iso(y, mo, +m[1]), rest: s.replace(m[0], ' ') }
  }
  m = s.match(/(?<![\d.,$/])(\d{1,2})\/(\d{1,2})(?![\d/.,])/)
  if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
    return { iso: iso(inferYear(+m[2], +m[1], today), +m[2], +m[1]), rest: s.replace(m[0], ' ') }
  }
  if (/^\s*hoy\b/i.test(s)) return { iso: iso(today.getFullYear(), today.getMonth() + 1, today.getDate()), rest: s.replace(/^\s*hoy\b/i, ' ') }
  if (/^\s*ayer\b/i.test(s)) {
    const y = new Date(today.getTime() - 86400000)
    return { iso: iso(y.getFullYear(), y.getMonth() + 1, y.getDate()), rest: s.replace(/^\s*ayer\b/i, ' ') }
  }
  return null
}

interface FoundAmount { raw: string; value: number; signed: boolean }

// $ 1.234.567 · -$25.000 · +$ 3.000 · 1.234.567 · $500 · 12.345,67
const MONEY = /(?<![\w.,/])([-+−–]\s?)?(\$\s?)?([-+−–]\s?)?(\d{1,3}(?:\.\d{3})+|\d+)(,\d{1,2})?(?![\d.]|-[\dkK]\b|\/)/g

export function findAmounts(s: string): FoundAmount[] {
  const out: FoundAmount[] = []
  for (const m of s.matchAll(MONEY)) {
    const hasDollar = !!m[2]
    const hasThousands = m[4].includes('.')
    // sin $ y sin separador de miles no es un monto (folios, años, cantidades)
    if (!hasDollar && !hasThousands) continue
    const sign = (m[1] ?? m[3] ?? '').trim()
    const n = Number(m[4].replace(/\./g, '') + (m[5] ? '.' + m[5].slice(1) : ''))
    if (!Number.isFinite(n) || n === 0) continue
    out.push({ raw: m[0], value: /[-−–]/.test(sign) ? -n : n, signed: sign !== '' })
  }
  return out
}

const INCOME_WORDS = /\b(abono|dep[oó]sito|transf(?:erencia)?\.? de|transferencia recibida|recibid[oa]|pago recibido|devoluci[oó]n|reembolso|remuneraci[oó]n|sueldo|reverso|ingreso)\b/i
const SKIP_LINE = /^(saldo|total|cupo|disponible|monto total|pagar hasta|pago m[ií]nimo|monto m[ií]nimo|l[ií]nea de cr[eé]dito disponible|utilizado|resumen|p[aá]gina)\b/i
const WEEKDAYS = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b,?/gi

function cleanDesc(s: string): string {
  return s.replace(WEEKDAYS, ' ').replace(/[|•·>]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–:,.]+|[\s\-–:,]+$/g, '').trim()
}

interface Item { d: FoundDate | null; rest: string; amounts: FoundAmount[]; raw: string }

/**
 * En las apps de banco la fecha puede venir como encabezado del grupo (antes de los movimientos)
 * o debajo de cada movimiento. Se decide mirando qué sigue a cada línea con monto.
 */
function dateComesAfter(items: Item[]): boolean {
  const structural = items.filter(it => it.d || it.amounts.length)
  const isDateOnly = (it: Item) => !!it.d && it.amounts.length === 0
  const bare = structural.filter(it => !it.d && it.amounts.length)
  if (bare.length === 0) return false
  let followed = 0
  structural.forEach((it, i) => { if (!it.d && it.amounts.length && structural[i + 1] && isDateOnly(structural[i + 1])) followed++ })
  if (followed < bare.length * 0.6) return false
  return !isDateOnly(structural[0])
}

/**
 * Lector genérico: recibe líneas de texto (de un PDF, una captura leída por OCR o un archivo de texto)
 * y encuentra movimientos con fecha, descripción y monto.
 */
export function parseGenericLines(lines: string[], today = new Date()): { rows: DraftRow[]; unparsed: number } {
  const items: Item[] = []
  for (const raw of lines) {
    const s = raw.replace(/\s+/g, ' ').trim()
    if (!s) continue
    const d = findDate(s, today)
    const rest = d ? d.rest : s
    const skip = SKIP_LINE.test(cleanDesc(rest))
    items.push({ d, rest, raw: s, amounts: skip ? [] : findAmounts(rest) })
  }
  const after = dateComesAfter(items)

  const rows: DraftRow[] = []
  const waiting: DraftRow[] = [] // movimientos que esperan la fecha que viene debajo
  let currentDate: string | null = null
  let pendingDesc: string | null = null
  let unparsed = 0

  for (const it of items) {
    const { d, rest, amounts } = it
    if (amounts.length === 0) {
      if (d) {
        currentDate = d.iso
        if (after) { for (const w of waiting) w.posted_at = d.iso; waiting.length = 0 }
        const r = cleanDesc(rest); pendingDesc = !after && /[a-záéíóúñ]{3}/i.test(r) ? r : null
      } else if (/[a-záéíóúñ]{3}/i.test(it.raw) && !SKIP_LINE.test(it.raw)) pendingDesc = cleanDesc(it.raw)
      continue
    }
    const date = d?.iso ?? (after ? '' : currentDate)
    if (date === null) { unparsed++; continue }
    if (d) currentDate = d.iso

    let desc = rest
    for (const a of amounts) desc = desc.replace(a.raw, ' ')
    desc = cleanDesc(desc)
    if (!/[a-záéíóúñ]{2}/i.test(desc)) desc = pendingDesc ?? 'Movimiento'

    // con varias cifras en la línea, la primera es el movimiento y la última suele ser el saldo
    const a = amounts[0]
    let value = a.value
    let uncertain = false
    if (!a.signed) {
      value = INCOME_WORDS.test(desc) ? Math.abs(value) : -Math.abs(value)
      uncertain = true
    }
    const row: DraftRow = { posted_at: date, description: desc, amount: value, uncertain }
    rows.push(row)
    if (date === '') waiting.push(row)
    pendingDesc = null
  }
  // movimientos cuya fecha quedó fuera de la imagen: se usa la última fecha vista y se marcan para revisar
  for (const w of waiting) {
    if (currentDate) { w.posted_at = currentDate; w.uncertain = true }
    else { rows.splice(rows.indexOf(w), 1); unparsed++ }
  }
  return { rows, unparsed }
}
