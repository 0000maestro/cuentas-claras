import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Camera, Check, ChevronDown, CircleAlert, FileText, FolderUp, Image as ImageIcon, Trash2 } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { dupKey, readAnyFile, type DraftRow, type ReadResult } from '../lib/readers'
import { listDocuments, saveDocument } from '../lib/documents'
import { dateShort, money } from '../lib/format'
import { ACCOUNT_KIND_LABEL, type Account, type AccountKind, type DocumentRow } from '../lib/types'
import { INSTITUTIONS } from '../lib/institutions'
import { Chip, Field, PageHeader, Spinner } from '../components/ui'

interface EditRow extends DraftRow { key: number; include: boolean; touched?: boolean }
interface Item {
  id: string
  file: File
  status: 'leyendo' | 'listo' | 'importando' | 'importado' | 'guardado' | 'error'
  progress?: string
  result?: ReadResult
  rows: EditRow[]
  accountId: string
  existing?: Map<string, number>
  message?: string
  verified?: number
  open: boolean
}

const plural = (n: number) => `${n} movimiento${n === 1 ? '' : 's'}`

export default function Import() {
  const { org, accounts, canEdit, refreshOrg } = useApp()
  const [params] = useSearchParams()
  const presetAccount = params.get('cuenta') ?? ''
  const [items, setItems] = useState<Item[]>([])
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [dragging, setDragging] = useState(false)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts])

  const patch = useCallback((id: string, changes: Partial<Item> | ((it: Item) => Partial<Item>)) => {
    setItems(list => list.map(it => it.id === id ? { ...it, ...(typeof changes === 'function' ? changes(it) : changes) } : it))
  }, [])

  const loadDocs = useCallback(async () => { if (org) setDocs(await listDocuments(org.id)) }, [org])
  useEffect(() => { loadDocs() }, [loadDocs])

  const suggestAccount = useCallback((r: ReadResult): string => {
    if (presetAccount && activeAccounts.some(a => a.id === presetAccount)) return presetAccount
    if (r.hint.last4) {
      const byLast4 = activeAccounts.filter(a => a.last4 === r.hint.last4)
      if (byLast4.length === 1) return byLast4[0].id
    }
    if (activeAccounts.length === 1) return activeAccounts[0].id
    return ''
  }, [activeAccounts, presetAccount])

  function addFiles(files: FileList | File[]) {
    if (!org) return
    const list = Array.from(files)
    const fresh: Item[] = list.map(file => ({ id: crypto.randomUUID(), file, status: 'leyendo', rows: [], accountId: '', open: false, progress: 'En cola…' }))
    setItems(prev => [...fresh, ...prev])
    for (const it of fresh) {
      queue.current = queue.current.then(async () => {
        try {
          const result = await readAnyFile(it.file, {
            onProgress: msg => patch(it.id, { progress: msg }),
            askPassword: wrong => window.prompt(wrong ? 'Clave incorrecta. Escribe la clave del PDF:' : 'Este PDF tiene clave. Escríbela aquí (el banco la indica en el correo donde lo envió):'),
          })
          if (result.rows.length === 0) {
            // nada legible: se guarda igual para no perderlo
            const saved = await saveDocument({ orgId: org.id, file: it.file, kind: result.docKind, status: result.docKind === 'cmf' ? 'recibido' : 'por_revisar', text: result.text })
            patch(it.id, {
              status: 'guardado', result,
              message: result.docKind === 'cmf'
                ? 'Informe de deudas CMF recibido. Queda guardado para cargar las deudas.'
                : saved.stored ? 'No encontramos movimientos que leer. El archivo quedó guardado para revisarlo a mano.' : 'No encontramos movimientos que leer en este archivo.',
            })
            loadDocs()
            return
          }
          const rows: EditRow[] = result.rows.map((r, i) => ({ ...r, key: i, include: true }))
          patch(it.id, { status: 'listo', result, rows, accountId: suggestAccount(result), open: true })
        } catch (e) {
          const saved = await saveDocument({ orgId: org.id, file: it.file, kind: 'otro', status: 'por_revisar', note: (e as Error).message }).catch(() => null)
          patch(it.id, { status: 'error', message: `No se pudo leer: ${(e as Error).message}${saved?.stored ? ' El archivo quedó guardado para revisarlo a mano.' : ''}` })
          loadDocs()
        }
      })
    }
  }

  if (!org) return null
  if (!canEdit) return <PageHeader title="Subir archivos" subtitle="Tu acceso es de solo lectura. Pide permiso para subir archivos a quien administra la organización." />

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Subir archivos"
        subtitle="Cartolas, estados de cuenta de tarjetas o capturas de pantalla de la app del banco. Puedes subir varios a la vez; nada se carga dos veces."
      />

      <label
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
        className={`block rounded-xl border-2 border-dashed px-5 py-8 text-center cursor-pointer transition-colors ${dragging ? 'border-accent bg-accent-soft' : 'border-line-2 bg-sheet hover:border-accent'}`}
      >
        <input type="file" multiple className="sr-only" onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }} />
        <FolderUp className="mx-auto text-accent mb-3" size={28} strokeWidth={1.6} />
        <div className="text-[16px] font-semibold">Elegir archivos o fotos</div>
        <div className="text-ink-2 mt-1">PDF, Excel, CSV, archivos de texto del banco, fotos y capturas de pantalla</div>
        <div className="flex justify-center gap-4 mt-4 text-ink-3 text-[12.5px]">
          <span className="flex items-center gap-1.5"><FileText size={14} /> Cartolas</span>
          <span className="flex items-center gap-1.5"><ImageIcon size={14} /> Capturas</span>
          <span className="flex items-center gap-1.5"><Camera size={14} /> Fotos</span>
        </div>
      </label>

      {activeAccounts.length === 0 && (
        <p className="text-ink-2 mt-3">Todavía no hay cuentas creadas. Puedes crearlas al subir el primer archivo o en <Link className="text-accent hover:underline" to="/bienvenida">la configuración inicial</Link>.</p>
      )}

      <div className="flex flex-col gap-3 mt-5">
        {items.map(it => (
          <ItemCard
            key={it.id} item={it} accounts={activeAccounts}
            onPatch={c => patch(it.id, c)}
            onRemove={() => setItems(list => list.filter(x => x.id !== it.id))}
            onImported={() => { loadDocs(); refreshOrg() }}
          />
        ))}
      </div>

      {items.length === 0 && (
        <div className="card p-5 mt-5">
          <div className="font-medium mb-2">Qué subir y cómo conseguirlo</div>
          <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-ink-2">
            <li><span className="text-ink">Desde el computador:</span> entra al sitio del banco, abre la cuenta, busca “Cartola” o “Movimientos”, elige el mes y descarga. Sirve Excel, PDF o el archivo de texto.</li>
            <li><span className="text-ink">Desde el celular:</span> abre la app del banco, entra a los movimientos y saca capturas de pantalla bajando de a poco. Sube todas juntas.</li>
            <li><span className="text-ink">Tarjetas de crédito:</span> sube el estado de cuenta mensual en PDF.</li>
          </ol>
          <div className="flex flex-wrap gap-2 mt-4">
            {[...new Set(activeAccounts.map(a => a.bank))].map(b => {
              const inst = INSTITUTIONS.find(i => i.name === b)
              return inst ? <a key={b} href={inst.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Abrir {inst.name}</a> : null
            })}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-8">
          <div className="text-ink-2 text-[13px] mb-2">Últimos archivos recibidos</div>
          <div className="card divide-y divide-line">
            {docs.map(d => (
              <div key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate">{d.filename}</div>
                  <div className="text-ink-3 text-[12px]">{dateShort(d.created_at.slice(0, 10))}{d.rows_imported ? ` · ${plural(d.rows_imported)} cargado${d.rows_imported === 1 ? '' : 's'}` : d.status === 'importado' ? ' · sin movimientos nuevos' : ''}</div>
                </div>
                <Chip tone={d.status === 'importado' || d.status === 'procesado' ? 'good' : d.status === 'recibido' ? 'accent' : 'warn'}>
                  {{ importado: 'Cargado', procesado: 'Procesado', recibido: 'Recibido', por_revisar: 'Por revisar a mano' }[d.status]}
                </Chip>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, accounts, onPatch, onRemove, onImported }: {
  item: Item; accounts: Account[]
  onPatch: (c: Partial<Item> | ((it: Item) => Partial<Item>)) => void
  onRemove: () => void; onImported: () => void
}) {
  const { org, entities, refreshOrg } = useApp()
  const [showAll, setShowAll] = useState(false)
  const [creating, setCreating] = useState(false)
  const r = item.result
  const account = accounts.find(a => a.id === item.accountId)
  const needsReview = !!r && (r.rows.some(x => x.uncertain) || !r.check?.ok && r.docKind === 'captura')

  // movimientos que ya existen en la cuenta (misma fecha y mismo monto)
  useEffect(() => {
    if (item.status !== 'listo' || !item.accountId || item.rows.length === 0) return
    let alive = true
    const dates = item.rows.map(x => x.posted_at).sort()
    ;(async () => {
      const map = new Map<string, number>()
      // la API entrega de a 1.000 filas: se recorre completo para no perder repetidos
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from('transactions').select('posted_at, amount').eq('account_id', item.accountId)
          .gte('posted_at', dates[0]).lte('posted_at', dates[dates.length - 1]).order('id').range(from, from + 999)
        for (const t of (data ?? []) as { posted_at: string; amount: number }[]) {
          const k = dupKey({ posted_at: t.posted_at, amount: Number(t.amount) })
          map.set(k, (map.get(k) ?? 0) + 1)
        }
        if (!data || data.length < 1000) break
      }
      if (alive) onPatch(it => ({ existing: map, rows: applyDupDefaults(it.rows, map) }))
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.status, item.accountId, item.rows.length])

  const dupFlags = useMemo(() => computeDups(item.rows, item.existing), [item.rows, item.existing])
  const included = item.rows.filter(x => x.include)
  const dupCount = dupFlags.filter(Boolean).length
  const totalIn = included.filter(x => x.amount > 0).reduce((a, x) => a + x.amount, 0)
  const totalOut = included.filter(x => x.amount < 0).reduce((a, x) => a + x.amount, 0)
  const dates = item.rows.map(x => x.posted_at).sort()

  function editRow(key: number, changes: Partial<EditRow>) {
    onPatch(it => ({ rows: it.rows.map(x => x.key === key ? { ...x, ...changes, touched: true } : x) }))
  }

  async function doImport() {
    if (!org || !account || !r) return
    onPatch({ status: 'importando' })
    try {
      const { data: u } = await supabase.auth.getUser()
      const seq = new Map(item.existing ?? [])
      const payload = included.map(x => {
        const k = dupKey(x)
        const n = (seq.get(k) ?? 0) + 1
        seq.set(k, n)
        return {
          org_id: org.id, account_id: account.id, entity_id: account.entity_id,
          posted_at: x.posted_at, description: x.description.trim() || 'Movimiento', amount: x.amount,
          fingerprint: `v2:${x.posted_at}:${x.amount}:${n}`,
          meta: { ...(x.meta ?? {}), archivo: item.file.name },
        }
      })
      let inserted = 0
      for (let i = 0; i < payload.length; i += 400) {
        const { data, error } = await supabase.from('transactions')
          .upsert(payload.slice(i, i + 400), { onConflict: 'account_id,fingerprint', ignoreDuplicates: true }).select('id')
        if (error) throw error
        inserted += data?.length ?? 0
      }
      await supabase.from('imports').insert({
        org_id: org.id, account_id: account.id, filename: item.file.name, rows_total: item.rows.length,
        rows_inserted: inserted, rows_duplicated: item.rows.length - inserted, created_by: u.user?.id ?? null,
      })
      await saveDocument({
        orgId: org.id, file: item.file, kind: r.docKind, status: 'importado', entityId: account.entity_id, accountId: account.id,
        text: r.text, rowsFound: item.rows.length, rowsImported: inserted,
      })
      // Confirmar ahorros con los movimientos recién cargados (si no hay ahorros pendientes, no hace nada)
      let verified = 0
      if (inserted > 0) {
        const { data: v } = await supabase.rpc('verify_savings', { p_org: org.id })
        verified = Number(v ?? 0)
      }
      onPatch({ status: 'importado', open: false, verified, message: `${inserted === 0 ? 'No había nada nuevo' : `${plural(inserted)} nuevo${inserted === 1 ? '' : 's'}`} en ${account.bank} · ${account.name}.${item.rows.length - inserted > 0 ? ` ${item.rows.length - inserted} ya estaban cargados o los dejaste fuera.` : ''}` })
      onImported()
    } catch (e) {
      onPatch({ status: 'listo', message: `No se pudo cargar: ${(e as Error).message}` })
    }
  }

  const visibleRows = showAll ? item.rows : item.rows.slice(0, needsReview ? 30 : 6)

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className={`mt-0.5 size-8 shrink-0 rounded-lg grid place-items-center ${item.status === 'importado' ? 'bg-income-soft text-income' : item.status === 'error' ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent'}`}>
          {item.status === 'leyendo' || item.status === 'importando' ? <Spinner /> : item.status === 'importado' ? <Check size={16} /> : item.status === 'error' ? <CircleAlert size={16} /> : <FileText size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{item.file.name}</div>
          <div className="text-ink-2 text-[13px]">
            {item.status === 'leyendo' && (item.progress ?? 'Leyendo…')}
            {item.status === 'importando' && 'Cargando movimientos…'}
            {(item.status === 'importado' || item.status === 'guardado' || item.status === 'error') && item.message}
            {item.status === 'importado' && !!item.verified && (
              <> Este archivo confirmó {item.verified} {item.verified === 1 ? 'ahorro' : 'ahorros'}. <Link to="/ahorros" className="text-accent underline">Ver en Ahorros y comisión</Link></>
            )}
            {item.status === 'listo' && r && (
              <>
                {r.reader} · <span className="text-ink">{plural(item.rows.length)}</span>
                {dates.length > 0 && <> · {dateShort(dates[0])} a {dateShort(dates[dates.length - 1])}</>}
              </>
            )}
          </div>
          {item.status === 'listo' && r && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {r.check && <Chip tone={r.check.ok ? 'good' : 'bad'}>{r.check.text}</Chip>}
              {dupCount > 0 && <Chip tone="neutral">{dupCount} ya estaban cargados</Chip>}
              {needsReview && <Chip tone="warn">Revisa antes de cargar</Chip>}
            </div>
          )}
          {item.status === 'listo' && item.message && <div className="text-bad text-[13px] mt-1">{item.message}</div>}
        </div>
        {item.status !== 'leyendo' && item.status !== 'importando' && (
          <button className="btn btn-ghost btn-sm -mr-2" onClick={onRemove} aria-label="Quitar de la lista"><Trash2 size={15} /></button>
        )}
      </div>

      {item.status === 'listo' && r && (
        <div className="border-t border-line px-4 py-3 flex flex-col gap-3">
          {r.warnings.map(w => <p key={w} className="text-[13px] text-[#8a5c00] bg-warn-soft rounded-md px-3 py-2">{w}</p>)}

          <Field label="¿De qué cuenta es este archivo?">
            <select className="input" value={item.accountId} onChange={e => { if (e.target.value === '__new') setCreating(true); else onPatch({ accountId: e.target.value, existing: undefined }) }}>
              <option value="">Elegir cuenta…</option>
              {entities.map(en => {
                const list = accounts.filter(a => a.entity_id === en.id)
                return list.length ? (
                  <optgroup key={en.id} label={en.name}>
                    {list.map(a => <option key={a.id} value={a.id}>{a.bank} · {a.name}{a.last4 ? ` ····${a.last4}` : ''}</option>)}
                  </optgroup>
                ) : null
              })}
              <option value="__new">+ Crear una cuenta nueva</option>
            </select>
          </Field>
          {!item.accountId && r.hint.last4 && !creating && (
            <button className="btn btn-outline self-start" onClick={() => setCreating(true)}>
              Crear {r.hint.accountLabel ?? 'cuenta'} ····{r.hint.last4}{r.hint.bank ? ` en ${r.hint.bank}` : ''}
            </button>
          )}
          {creating && org && (
            <NewAccount
              hint={r.hint}
              onCancel={() => setCreating(false)}
              onCreated={async id => { await refreshOrg(); setCreating(false); onPatch({ accountId: id, existing: undefined }) }}
            />
          )}

          <div>
            <div className="flex items-center justify-between text-[13px] mb-1.5">
              <span className="text-ink-2">{included.length} para cargar</span>
              <span className="num"><span className="text-income">{money(totalIn, { sign: true })}</span> <span className="text-ink-3">/</span> {money(totalOut, { sign: true })}</span>
            </div>
            <ul className="rounded-lg border border-line divide-y divide-line/70">
              {visibleRows.map(x => {
                const idx = item.rows.indexOf(x)
                const dup = dupFlags[idx]
                return (
                  <li key={x.key} className={`px-3 py-2 flex items-start gap-2.5 ${!x.include ? 'bg-paper' : ''}`}>
                    <input type="checkbox" className="mt-1.5 size-4 shrink-0" checked={x.include} onChange={e => editRow(x.key, { include: e.target.checked })} aria-label="Incluir" />
                    <div className={`min-w-0 flex-1 ${!x.include ? 'opacity-50' : ''}`}>
                      <input className="w-full bg-transparent outline-none focus:bg-paper rounded px-1 -mx-1 truncate" value={x.description} onChange={e => editRow(x.key, { description: e.target.value })} aria-label="Descripción" />
                      <div className="flex items-center gap-2 mt-0.5 text-[12.5px] text-ink-2">
                        <input type="date" className="bg-transparent outline-none focus:bg-paper rounded" value={x.posted_at} onChange={e => e.target.value && editRow(x.key, { posted_at: e.target.value })} aria-label="Fecha" />
                        {dup && <span className="text-ink-3">· Ya está cargado</span>}
                        {x.uncertain && !x.touched && <span className="text-[#8a5c00]">· Revisar</span>}
                      </div>
                    </div>
                    <div className={`shrink-0 text-right ${!x.include ? 'opacity-50' : ''}`}>
                      <div className={`num font-medium ${x.amount > 0 ? 'text-income' : ''}`}>{money(x.amount, { sign: true })}</div>
                      <button className="text-[12px] text-accent hover:underline" onClick={() => editRow(x.key, { amount: -x.amount, uncertain: false })}>
                        {x.amount > 0 ? 'Cambiar a salida' : 'Cambiar a entrada'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {item.rows.length > visibleRows.length && (
              <button className="btn btn-ghost btn-sm mt-1.5" onClick={() => setShowAll(true)}><ChevronDown size={14} /> Ver los {item.rows.length} movimientos</button>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button className="btn btn-primary w-full sm:w-auto" disabled={!account || included.length === 0 || (!!item.accountId && !item.existing)} onClick={doImport}>
              {!account ? 'Elige la cuenta para continuar' : included.length === 0 ? 'No hay nada nuevo que cargar' : `Cargar ${plural(included.length)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function computeDups(rows: EditRow[], existing?: Map<string, number>): boolean[] {
  if (!existing) return rows.map(() => false)
  const seen = new Map<string, number>()
  return rows.map(x => {
    const k = dupKey(x)
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return n <= (existing.get(k) ?? 0)
  })
}

function applyDupDefaults(rows: EditRow[], existing: Map<string, number>): EditRow[] {
  const flags = computeDups(rows, existing)
  return rows.map((x, i) => (x.touched ? x : { ...x, include: !flags[i] }))
}

function NewAccount({ hint, onCancel, onCreated }: { hint: ReadResult['hint']; onCancel: () => void; onCreated: (id: string) => void }) {
  const { org, entities } = useApp()
  const guessEntity = hint.holder ? entities.find(e => hint.holder!.toLowerCase().includes(e.name.toLowerCase().split(' (')[0])) : undefined
  const [entityId, setEntityId] = useState(guessEntity?.id ?? entities[0]?.id ?? '')
  const [bank, setBank] = useState(hint.bank ?? 'Santander')
  const [kind, setKind] = useState<AccountKind>(hint.accountKind ?? 'corriente')
  const [last4, setLast4] = useState(hint.last4 ?? '')
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!org) return
    const { data, error } = await supabase.from('accounts').insert({
      org_id: org.id, entity_id: entityId, bank, kind, last4: last4 || null,
      name: hint.accountLabel ?? ACCOUNT_KIND_LABEL[kind],
    }).select('id').single()
    if (error) return setErr(error.message)
    onCreated((data as { id: string }).id)
  }
  return (
    <div className="rounded-lg bg-paper p-3 grid grid-cols-2 gap-2.5">
      <Field label="De quién es">
        <select className="input" value={entityId} onChange={e => setEntityId(e.target.value)}>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <Field label="Banco o institución">
        <input className="input" list="bancos" value={bank} onChange={e => setBank(e.target.value)} />
        <datalist id="bancos">{INSTITUTIONS.map(i => <option key={i.id} value={i.name} />)}</datalist>
      </Field>
      <Field label="Tipo">
        <select className="input" value={kind} onChange={e => setKind(e.target.value as AccountKind)}>
          {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map(k => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <Field label="Últimos 4 dígitos"><input className="input num" value={last4} maxLength={4} onChange={e => setLast4(e.target.value.replace(/\D/g, ''))} /></Field>
      {err && <p className="text-bad col-span-2">{err}</p>}
      <div className="col-span-2 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={!entityId || !bank.trim()}>Crear cuenta</button>
      </div>
    </div>
  )
}
