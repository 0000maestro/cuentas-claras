import type { DraftRow, ReadResult } from './types'

// Cartola Santander en archivo de texto de ancho fijo (.tx1 / .txt):
// DDMM + A/C + código(5) + glosa(31) + documento(10) + monto(14, 2 decimales) + sucursal(3) + nombre sucursal
const ROW = /^(\d{2})(\d{2})([AC])(\d{5})(.{31})(\d{10})(\d{14})(\d{3})(.*)$/

export function looksLikeSantanderTx1(text: string): boolean {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return false
  const sample = lines.slice(1, 12)
  return sample.filter(l => ROW.test(l)).length >= Math.min(3, sample.length)
}

function cleanText(s: string): string {
  return s
    .replace(/Dep�sito/g, 'Depósito').replace(/L�nea/g, 'Línea').replace(/Cr�dito/g, 'Crédito')
    .replace(/Autom�tico/g, 'Automático').replace(/N�/g, 'N°')
    .replace(/[�?]/g, '').replace(/\s+/g, ' ').trim()
}

function fmtRut(digits: string): string {
  const d = digits.replace(/^0+/, '')
  return d.length > 1 ? `${d.slice(0, -1)}-${d.slice(-1)}` : d
}

export function parseSantanderTx1(text: string): ReadResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const header = lines[0]
  const warnings: string[] = []

  const hm = header.match(/^(\d{12})(.{40})\d{3}(\D+?)(\d{12})/)
  const holder = hm ? hm[2].trim() : undefined
  const bank = hm && /SANTANDER/i.test(hm[3]) ? 'Santander' : undefined
  const accountDigits = hm ? hm[4].replace(/^0+/, '') : ''

  const saldos = [...header.matchAll(/(\d{2})(\d{2})(\d{4})([+-])(\d{16})/g)].map(m => ({
    date: `${m[3]}-${m[2]}-${m[1]}`,
    value: (m[4] === '-' ? -1 : 1) * Number(m[5]) / 100,
  }))
  const ini = saldos[0], fin = saldos[1]
  const endYear = fin ? Number(fin.date.slice(0, 4)) : new Date().getFullYear()
  const endMonth = fin ? Number(fin.date.slice(5, 7)) : 12

  const rows: DraftRow[] = []
  let bad = 0
  lines.slice(1).forEach((l, i) => {
    const m = l.match(ROW)
    if (!m) { bad++; return }
    const [, dd, mm, type, code, rawDesc, doc, cents, , branch] = m
    const year = Number(mm) > endMonth ? endYear - 1 : endYear
    let desc = cleanText(rawDesc)
    const rut = desc.match(/^(\d{9}[\dK]) (.*)$/)
    if (rut) desc = `${rut[2].trim()} · RUT ${fmtRut(rut[1])}`.replace(/^ · /, 'Transferencia · ')
    const amount = (type === 'A' ? 1 : -1) * Number(cents) / 100
    rows.push({
      posted_at: `${year}-${mm}-${dd}`,
      description: desc || '(sin descripción)',
      amount,
      meta: { codigo: code, doc, linea: i + 1, sucursal: cleanText(branch), origen: 'Cartola Santander (archivo de texto)' },
    })
  })
  if (bad) warnings.push(`${bad} líneas no tenían el formato esperado y se omitieron.`)

  let check: ReadResult['check']
  if (ini && fin) {
    const sum = rows.reduce((a, r) => a + r.amount, 0)
    const diff = Math.round((ini.value + sum - fin.value) * 100) / 100
    check = diff === 0
      ? { ok: true, text: 'Cuadra al peso con los saldos del banco' }
      : { ok: false, text: `No cuadra con los saldos del banco (diferencia de ${diff.toLocaleString('es-CL')})` }
  }

  return {
    reader: 'Cartola Santander (archivo de texto)',
    docKind: 'cartola',
    rows,
    hint: { bank, holder, last4: accountDigits.slice(-4) || undefined, accountKind: 'corriente', accountLabel: accountDigits ? `Cuenta ${accountDigits.slice(0, -1)}-${accountDigits.slice(-1)}` : undefined },
    check,
    text,
    warnings,
  }
}
