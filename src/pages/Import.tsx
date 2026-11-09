import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { applyMapping, detectHeaderRow, guessMapping, headersAt, readFileToGrid, type Grid, type ParsedRow } from '../lib/importer'
import { dateShort, money } from '../lib/format'
import type { ImportMapping } from '../lib/types'
import { Field, PageHeader, Spinner } from '../components/ui'

type Step = 'archivo' | 'columnas' | 'listo'

export default function Import() {
  const { org, entities, accounts, canEdit, refreshOrg } = useApp()
  const [accountId, setAccountId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [mapping, setMapping] = useState<ImportMapping | null>(null)
  const [step, setStep] = useState<Step>('archivo')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ inserted: number; duplicated: number; total: number } | null>(null)

  const account = accounts.find(a => a.id === accountId)
  const headers = useMemo(() => (grid && mapping ? headersAt(grid, mapping.headerRow) : []), [grid, mapping])
  const parsed = useMemo(() => (grid && mapping && headers.length ? applyMapping(grid, headers, mapping) : null), [grid, mapping, headers])

  if (!org) return null
  if (!canEdit) return <PageHeader title="Importar cartolas" subtitle="Solo quienes administran la organización pueden importar." />

  async function onFile(f: File) {
    setErr(null); setFile(f); setResult(null)
    try {
      const g = await readFileToGrid(f)
      if (g.length < 2) throw new Error('El archivo está vacío o no se pudo leer.')
      const headerRow = detectHeaderRow(g)
      const hs = headersAt(g, headerRow)
      const saved = account?.import_mapping
      const base = saved && hs.includes(saved.date) && hs.includes(saved.description) ? saved : guessMapping(hs)
      setGrid(g)
      setMapping({ ...base, headerRow })
      setStep('columnas')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function confirm() {
    if (!grid || !mapping || !parsed || !account || !org) return
    setBusy(true); setErr(null)
    try {
      const { data: imp, error: e1 } = await supabase.from('imports').insert({
        org_id: org.id, account_id: account.id, filename: file?.name ?? null, rows_total: parsed.rows.length,
      }).select('id').single()
      if (e1) throw e1
      const importId = (imp as { id: string }).id

      // Evitar duplicados: traer fingerprints existentes de la cuenta en el rango de fechas
      const dates = parsed.rows.map(r => r.posted_at).sort()
      const { data: existing } = await supabase.from('transactions').select('fingerprint')
        .eq('account_id', account.id).gte('posted_at', dates[0]).lte('posted_at', dates[dates.length - 1])
      const have = new Set((existing ?? []).map(x => (x as { fingerprint: string }).fingerprint))
      const fresh = parsed.rows.filter(r => !have.has(r.fingerprint))

      const payload = fresh.map(r => ({
        org_id: org.id, account_id: account.id, entity_id: account.entity_id,
        posted_at: r.posted_at, description: r.description, amount: r.amount,
        balance_after: r.balance_after, fingerprint: r.fingerprint, import_id: importId,
      }))
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from('transactions').insert(payload.slice(i, i + 500))
        if (error) throw error
      }
      await supabase.from('imports').update({ rows_inserted: fresh.length, rows_duplicated: parsed.rows.length - fresh.length }).eq('id', importId)
      await supabase.from('accounts').update({ import_mapping: mapping }).eq('id', account.id)
      await refreshOrg()
      setResult({ inserted: fresh.length, duplicated: parsed.rows.length - fresh.length, total: parsed.rows.length })
      setStep('listo')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function reset() { setFile(null); setGrid(null); setMapping(null); setStep('archivo'); setResult(null); setErr(null) }

  return (
    <div>
      <PageHeader
        title="Importar cartolas"
        subtitle="Sube la cartola (Excel o CSV) tal como la descargas del banco. El sistema reconoce las columnas, evita duplicados y aplica tus reglas de clasificación."
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="card p-5">
            <Field label="Cuenta de la cartola">
              <select className="input" value={accountId} onChange={e => { setAccountId(e.target.value); reset() }}>
                <option value="">Elegir cuenta…</option>
                {entities.map(en => (
                  <optgroup key={en.id} label={en.name}>
                    {accounts.filter(a => a.entity_id === en.id && a.is_active).map(a => (
                      <option key={a.id} value={a.id}>{a.bank} · {a.name}{a.last4 ? ` ····${a.last4}` : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {accounts.length === 0 && (
              <p className="text-ink-2 mt-3">Primero crea las cuentas en <Link className="text-accent hover:underline" to="/configuracion">Configuración</Link>.</p>
            )}
            {account?.import_mapping && <p className="text-ink-3 text-[12.5px] mt-3">Esta cuenta ya tiene un formato de cartola guardado; se usará automáticamente.</p>}
          </div>

          <label className={`card p-6 border-dashed text-center cursor-pointer block ${!accountId ? 'opacity-50 pointer-events-none' : 'hover:border-accent'}`}>
            <input type="file" className="sr-only" accept=".xlsx,.xls,.csv,.txt" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} disabled={!accountId} />
            <Upload className="mx-auto text-ink-3 mb-2" size={22} />
            <div className="font-medium">{file ? file.name : 'Elegir archivo'}</div>
            <div className="text-ink-3 text-[12.5px] mt-1">Excel (.xlsx) o CSV descargado del banco</div>
          </label>
          {err && <p className="text-bad">{err}</p>}
        </div>

        <div className="lg:col-span-2">
          {step === 'archivo' && (
            <div className="card p-8 text-ink-2">
              <FileSpreadsheet className="text-ink-3 mb-3" size={22} />
              <p className="font-medium text-ink mb-1">Cómo obtener la cartola</p>
              <ol className="list-decimal pl-5 flex flex-col gap-1 text-[13.5px]">
                <li>En el sitio del banco, entra a la cuenta y busca “Cartola” o “Movimientos”.</li>
                <li>Elige el período (ideal: desde octubre) y descarga en Excel. Si solo hay PDF, avísanos: lo convertimos.</li>
                <li>Súbelo aquí. Puedes repetir la carga cuantas veces quieras: los movimientos ya cargados no se duplican.</li>
              </ol>
            </div>
          )}

          {step === 'columnas' && grid && mapping && parsed && (
            <div className="card">
              <div className="px-5 pt-5 pb-3 border-b border-line">
                <h2 className="font-semibold">Revisar columnas</h2>
                <p className="text-ink-2 text-[13px] mt-0.5">Confirma qué columna es cada cosa. Normalmente ya viene bien detectado.</p>
              </div>
              <div className="p-5 grid grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Fila de encabezados">
                  <input className="input num" type="number" min={0} value={mapping.headerRow + 1} onChange={e => {
                    const hr = Math.max(0, Number(e.target.value) - 1)
                    const hs = headersAt(grid, hr)
                    setMapping({ ...guessMapping(hs), headerRow: hr })
                  }} />
                </Field>
                <ColSelect label="Fecha" value={mapping.date} headers={headers} onChange={v => setMapping({ ...mapping, date: v })} />
                <ColSelect label="Descripción" value={mapping.description} headers={headers} onChange={v => setMapping({ ...mapping, description: v })} />
                <ColSelect label="Cargos (salidas)" value={mapping.debit ?? ''} headers={headers} allowNone onChange={v => setMapping({ ...mapping, debit: v || undefined, amount: v ? undefined : mapping.amount })} />
                <ColSelect label="Abonos (entradas)" value={mapping.credit ?? ''} headers={headers} allowNone onChange={v => setMapping({ ...mapping, credit: v || undefined, amount: v ? undefined : mapping.amount })} />
                <ColSelect label="Monto único con signo" value={mapping.amount ?? ''} headers={headers} allowNone onChange={v => setMapping({ ...mapping, amount: v || undefined, debit: v ? undefined : mapping.debit, credit: v ? undefined : mapping.credit })} />
                <ColSelect label="Saldo (opcional)" value={mapping.balance ?? ''} headers={headers} allowNone onChange={v => setMapping({ ...mapping, balance: v || undefined })} />
                <Field label="Formato de fecha">
                  <select className="input" value={mapping.dateFormat} onChange={e => setMapping({ ...mapping, dateFormat: e.target.value as ImportMapping['dateFormat'] })}>
                    <option value="dmy">día/mes/año</option>
                    <option value="mdy">mes/día/año</option>
                    <option value="ymd">año-mes-día</option>
                  </select>
                </Field>
              </div>

              <div className="px-5 pb-2 flex items-center justify-between">
                <div className="text-[13px] text-ink-2">
                  <span className="font-medium text-ink">{parsed.rows.length}</span> movimientos leídos
                  {parsed.skipped > 0 && <> · {parsed.skipped} filas sin fecha o monto (se ignoran)</>}
                  {parsed.rows.length > 0 && <> · del {dateShort(minDate(parsed.rows))} al {dateShort(maxDate(parsed.rows))}</>}
                </div>
                <div className="text-[13px] num">
                  <span className="text-income">{money(parsed.rows.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0), { sign: true })}</span>
                  <span className="text-ink-3 mx-1">/</span>
                  {money(parsed.rows.filter(r => r.amount < 0).reduce((a, r) => a + r.amount, 0), { sign: true })}
                </div>
              </div>
              <div className="max-h-[320px] overflow-auto border-t border-line">
                <table className="data">
                  <thead><tr><th>Fecha</th><th>Descripción</th><th className="text-right">Monto</th><th className="text-right">Saldo</th></tr></thead>
                  <tbody>
                    {parsed.rows.slice(0, 40).map(r => (
                      <tr key={r.fingerprint}>
                        <td className="whitespace-nowrap text-ink-2">{dateShort(r.posted_at)}</td>
                        <td className="max-w-[360px] truncate" title={r.description}>{r.description}</td>
                        <td className={`num text-right whitespace-nowrap ${r.amount > 0 ? 'text-income' : ''}`}>{money(r.amount, { sign: true })}</td>
                        <td className="num text-right text-ink-3 whitespace-nowrap">{money(r.balance_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 40 && <div className="px-3 py-2 text-ink-3 text-[12.5px]">… y {parsed.rows.length - 40} más</div>}
              </div>
              <div className="p-4 border-t border-line flex justify-end gap-2">
                <button className="btn btn-ghost" onClick={reset}>Cancelar</button>
                <button className="btn btn-primary" onClick={confirm} disabled={busy || parsed.rows.length === 0 || !mapping.date || !mapping.description}>
                  {busy ? <><Spinner /> Importando…</> : `Importar ${parsed.rows.length} movimientos`}
                </button>
              </div>
            </div>
          )}

          {step === 'listo' && result && (
            <div className="card p-6">
              <h2 className="font-semibold text-lg">Cartola importada</h2>
              <p className="text-ink-2 mt-1">
                {result.inserted} movimientos nuevos en {account?.bank} · {account?.name}.
                {result.duplicated > 0 && <> {result.duplicated} ya estaban cargados y se omitieron.</>}
              </p>
              <div className="flex gap-2 mt-5">
                <Link to="/movimientos" className="btn btn-primary">Ver movimientos</Link>
                <button className="btn btn-outline" onClick={reset}>Importar otra cartola</button>
              </div>
              <p className="text-ink-3 text-[12.5px] mt-5">Siguiente paso recomendado: en Movimientos, categoriza los que quedaron “Sin categoría” y crea reglas para que no vuelva a pasar. Luego usa “Detectar recurrentes”.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ColSelect({ label, value, headers, onChange, allowNone }: { label: string; value: string; headers: string[]; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        {allowNone && <option value="">—</option>}
        {!allowNone && !headers.includes(value) && <option value="">Elegir…</option>}
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </Field>
  )
}

function minDate(rows: ParsedRow[]) { return rows.reduce((a, r) => (r.posted_at < a ? r.posted_at : a), rows[0].posted_at) }
function maxDate(rows: ParsedRow[]) { return rows.reduce((a, r) => (r.posted_at > a ? r.posted_at : a), rows[0].posted_at) }
