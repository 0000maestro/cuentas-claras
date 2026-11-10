import type { DraftRow, ReadResult } from './types'

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

export function looksLikeSantanderCard(lines: string[]): boolean {
  const head = lines.slice(0, 40).join('\n')
  return /TARJETA DE CR[EÉ]DITO/i.test(head) && /XXXX XXXX XXXX \d{4}/.test(head) && /CUPO TOTAL/i.test(head)
}

/** Estado de cuenta de tarjeta de crédito Santander (nacional o internacional), leído desde el PDF. */
export function parseSantanderCard(lines: string[]): ReadResult {
  const all = lines.join('\n')
  const last4 = all.match(/XXXX XXXX XXXX (\d{4})/)?.[1]
  const holder = all.match(/NOMBRE DEL TITULAR\s+(.+?)(?:\s{2,}|$)/m)?.[1]?.trim()
  const product = all.match(/XXXX XXXX XXXX \d{4}\s+([A-Z][A-Z ]+?)(?:\s{2,}|$)/m)?.[1]?.trim()
  const international = /CUPO TOTAL\s+US\$/i.test(all) || /MONTO US\$/i.test(all)
  const warnings: string[] = []
  const rows: DraftRow[] = []
  let skippedUsdPayments = 0

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    const dm = line.match(/(?:^|\s)(\d{2})\/(\d{2})\/(\d{2})(?!\d)\s+(.+)$/)
    if (!dm) continue
    const date = `20${dm[3]}-${dm[2]}-${dm[1]}`
    const rest = dm[4]

    if (international) {
      // DESCRIPCIÓN  CIUDAD  PAÍS  MONTO MONEDA ORIGEN  MONTO US$
      const m = rest.match(/^(.+?)\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})$/)
      if (!m) continue
      const origin = num(m[2]), usd = num(m[3])
      let desc = m[1].replace(/\s+[A-Z]{2}$/, '').trim()
      if (usd < 0 || origin === 0) { skippedUsdPayments++; continue }
      const ratio = usd > 0 ? origin / usd : 0
      const usdTxt = `US$ ${m[3]}`
      if (ratio > 600 && ratio < 1400) {
        rows.push({ posted_at: date, description: `${desc} (${usdTxt})`, amount: -Math.round(origin), meta: { usd, origen: 'Estado de cuenta internacional Santander' } })
      } else {
        rows.push({ posted_at: date, description: `${desc} (${usdTxt}, valor en pesos estimado)`, amount: -Math.round(usd * 950), uncertain: true, meta: { usd, origen: 'Estado de cuenta internacional Santander' } })
      }
      continue
    }

    // nacional: el último monto con $ es el cargo del mes (o el pago, en negativo)
    const amounts = [...rest.matchAll(/\$\s?(-?[\d.]+)/g)]
    if (amounts.length === 0) continue
    const last = amounts[amounts.length - 1]
    const value = num(last[1])
    if (!Number.isFinite(value) || value === 0) continue
    const desc = rest.slice(0, amounts[0].index).trim()
    if (!desc) continue
    rows.push({ posted_at: date, description: desc, amount: -value, meta: { origen: 'Estado de cuenta Santander' } })
  }

  if (skippedUsdPayments) warnings.push(`Se omitieron ${skippedUsdPayments} pagos o traspasos en dólares: no son gasto nuevo.`)
  if (international) warnings.push('Los cargos en dólares se muestran en pesos según el monto de origen del estado de cuenta.')

  return {
    reader: `Estado de cuenta tarjeta Santander${international ? ' (internacional)' : ''}`,
    docKind: 'tarjeta',
    rows,
    hint: { bank: 'Santander', last4, holder, accountKind: 'tarjeta_credito', accountLabel: product ? product.charAt(0) + product.slice(1).toLowerCase() : 'Tarjeta de crédito' },
    text: all,
    warnings,
  }
}
