import Papa from 'papaparse'
import { applyMapping, detectHeaderRow, guessMapping, headersAt, readFileToGrid, type Grid } from '../importer'
import { parseGenericLines } from './generic'
import { looksLikeSantanderTx1, parseSantanderTx1 } from './santanderTx1'
import { looksLikeSantanderCard, parseSantanderCard } from './santanderCard'
import type { DraftRow, ReadOptions, ReadResult } from './types'

export type { DraftRow, ReadResult } from './types'

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '')

async function decodeText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) }
  catch { return new TextDecoder('windows-1252').decode(buf) }
}

function gridToResult(grid: Grid, label: string): ReadResult | null {
  if (grid.length < 2) return null
  const headerRow = detectHeaderRow(grid)
  const headers = headersAt(grid, headerRow)
  const mapping = { ...guessMapping(headers), headerRow }
  if (!mapping.date || (!mapping.amount && !mapping.debit && !mapping.credit)) return null
  const { rows } = applyMapping(grid, headers, mapping)
  if (rows.length === 0) return null
  const signed = !!(mapping.debit || mapping.credit) || rows.some(r => r.amount < 0)
  return {
    reader: label, docKind: 'cartola',
    rows: rows.map(r => ({ posted_at: r.posted_at, description: r.description, amount: signed ? r.amount : -Math.abs(r.amount), uncertain: !signed, meta: { saldo: r.balance_after, origen: label } })),
    hint: {}, text: grid.slice(0, 400).map(r => r.join(' | ')).join('\n'), warnings: signed ? [] : ['El archivo no distingue entradas de salidas: revisa el signo de cada movimiento.'],
  }
}

function genericResult(lines: string[], reader: string, docKind: ReadResult['docKind']): ReadResult {
  const { rows, unparsed } = parseGenericLines(lines)
  const warnings: string[] = []
  if (rows.some(r => r.uncertain)) warnings.push('Algunos montos no traían signo: revisa si son entrada o salida antes de importar.')
  if (unparsed) warnings.push(`${unparsed} líneas tenían montos pero no fecha y quedaron fuera.`)
  return { reader, docKind, rows: rows.map(r => ({ ...r, meta: { origen: reader } })), hint: {}, text: lines.join('\n'), warnings }
}

function isCmf(lines: string[]): boolean {
  const head = lines.slice(0, 60).join(' ')
  return /informe de deudas/i.test(head) && /(CMF|Comisi[oó]n para el Mercado Financiero)/i.test(head)
}

export async function readAnyFile(file: File, opts: ReadOptions = {}): Promise<ReadResult> {
  const e = ext(file.name)
  const type = file.type

  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif', 'bmp'].includes(e)) {
    const { ocrLines } = await import('./ocr')
    const lines = await ocrLines(file, opts.onProgress)
    return genericResult(lines, 'Captura o foto (texto leído de la imagen)', 'captura')
  }

  if (type === 'application/pdf' || e === 'pdf') {
    const { readPdf } = await import('./pdf')
    const pdf = await readPdf(file, opts)
    let lines = pdf.lines
    let scanned = false
    if (!pdf.hasText) {
      scanned = true
      const { ocrLines } = await import('./ocr')
      lines = []
      const pages = await pdf.pageImages()
      for (let i = 0; i < pages.length; i++) {
        opts.onProgress?.(`PDF escaneado: leyendo página ${i + 1} de ${pages.length}…`)
        lines.push(...await ocrLines(pages[i]))
      }
    }
    if (isCmf(lines)) {
      return { reader: 'Informe de deudas CMF', docKind: 'cmf', rows: [], hint: {}, text: lines.join('\n'), warnings: [] }
    }
    if (looksLikeSantanderCard(lines)) return parseSantanderCard(lines)
    return genericResult(lines, scanned ? 'PDF escaneado (texto leído de la imagen)' : 'PDF (lectura general)', 'cartola')
  }

  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(e)) {
    const grid = await readFileToGrid(file)
    const r = gridToResult(grid, 'Planilla Excel')
    if (r) return r
    return genericResult(grid.map(row => row.filter(c => c !== null).join('  ')), 'Planilla Excel (lectura general)', 'cartola')
  }

  // cualquier otro archivo se intenta leer como texto
  const text = await decodeText(file)
  // un binario desconocido no es texto
  const weird = (text.slice(0, 4000).match(/[\u0000-\u0008\u000e-\u001f]/g) ?? []).length
  if (weird > 20) return { reader: 'Archivo no reconocido', docKind: 'otro', rows: [], hint: {}, text: '', warnings: ['No es un formato que podamos leer todavía.'] }
  if (looksLikeSantanderTx1(text)) return parseSantanderTx1(text)

  const firstLines = text.split(/\r?\n/).slice(0, 30)
  const delimited = firstLines.filter(l => (l.match(/[;\t]/g) ?? []).length >= 2 || (l.match(/,/g) ?? []).length >= 3).length > firstLines.length / 2
  if (e === 'csv' || delimited) {
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
    const grid: Grid = parsed.data.map(r => r.map(c => (c === '' ? null : c)))
    const r = gridToResult(grid, 'Archivo CSV')
    if (r) return r
  }
  return genericResult(text.split(/\r?\n/), 'Archivo de texto (lectura general)', 'cartola')
}

/** Clave para detectar repetidos: misma cuenta, misma fecha y mismo monto. */
export const dupKey = (r: Pick<DraftRow, 'posted_at' | 'amount'>) => `${r.posted_at}:${r.amount}`
