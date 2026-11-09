import { useCallback, useEffect, useMemo, useState } from 'react'
import { PiggyBank, Plus, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { fetchRecurring } from '../lib/queries'
import { dateShort, money, pct } from '../lib/format'
import { CADENCE_LABEL, RECURRING_STATUS_LABEL, type Cadence, type Recurring, type RecurringStatus } from '../lib/types'
import { Chip, Empty, Field, Modal, PageHeader, Spinner, Stat } from '../components/ui'

const STATUS_TONE: Record<RecurringStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  revisar: 'warn', mantener: 'good', negociar: 'accent', cancelar: 'bad', cancelado: 'neutral',
}

export default function Recurring() {
  const { org, entityId, entities, canEdit } = useApp()
  const [rows, setRows] = useState<Recurring[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null)
  const [saving, setSaving] = useState<Recurring | null>(null)
  const [statusFilter, setStatusFilter] = useState<RecurringStatus | 'todos'>('todos')

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    setRows(await fetchRecurring(org.id, entityId))
    setLoading(false)
  }, [org, entityId])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => statusFilter === 'todos' ? rows : rows.filter(r => r.status === statusFilter), [rows, statusFilter])

  const sum = (f: (r: Recurring) => boolean) => rows.filter(f).reduce((a, r) => a + (r.monthly_equivalent ?? 0), 0)
  const total = sum(r => r.status !== 'cancelado')
  const keep = sum(r => r.status === 'mantener')
  const cut = sum(r => r.status === 'cancelar' || r.status === 'cancelado')
  const review = sum(r => r.status === 'revisar')
  const original = total + sum(r => r.status === 'cancelado')
  const varied = rows.filter(r => r.last_amount != null && (r.expected_amount ?? r.avg_amount) && Math.abs((r.last_amount - (r.expected_amount ?? r.avg_amount)!) / (r.expected_amount ?? r.avg_amount)!) >= 0.1).length
  const counts = Object.fromEntries((Object.keys(RECURRING_STATUS_LABEL) as RecurringStatus[]).map(s => [s, rows.filter(r => r.status === s).length]))

  async function setStatus(r: Recurring, status: RecurringStatus) {
    const changes: Partial<Recurring> = { status }
    if (status === 'cancelado' && !r.cancelled_at) changes.cancelled_at = new Date().toISOString().slice(0, 10)
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...changes } : x))
    const { error } = await supabase.from('recurring_charges').update(changes).eq('id', r.id)
    if (error) { alert(error.message); load() }
  }

  async function runDetect() {
    if (!org) return
    setBusy(true)
    const { data, error } = await supabase.rpc('detect_recurring', { p_org: org.id })
    setBusy(false)
    if (error) return alert(error.message)
    alert(data > 0 ? `Se detectaron ${data} cargos recurrentes nuevos.` : 'No aparecieron cargos recurrentes nuevos.')
    load()
  }

  if (!org) return null

  return (
    <div>
      <PageHeader
        title="Costos recurrentes"
        subtitle={`Suscripciones, arriendos, seguros, planes y todo lo que se cobra solo cada mes. Decide uno por uno qué se mantiene, qué se negocia y qué se corta.${varied ? ` · ${varied} con el último cobro distinto al esperado (±10%).` : ''}`}
        actions={canEdit && (
          <>
            <button className="btn btn-outline" onClick={runDetect} disabled={busy}>{busy ? <Spinner /> : <Wand2 size={15} />} Detectar en movimientos</button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Agregar a mano</button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Comprometido al mes" value={money(total)} sub={`${rows.filter(r => r.status !== 'cancelado').length} cargos activos`} />
        <Stat label="Por revisar" value={money(review)} sub={`${counts.revisar} sin decisión`} />
        <Stat label="Se mantiene" value={money(keep)} tone="neutral" sub={`${counts.mantener} confirmados`} />
        <Stat label="Recorte decidido" value={money(cut)} tone="good" sub={original > 0 ? `${pct((cut / original) * 100, 1)} del total original` : undefined} />
      </div>

      <div className="flex gap-1 mb-3 flex-wrap">
        <FilterBtn active={statusFilter === 'todos'} onClick={() => setStatusFilter('todos')}>Todos ({rows.length})</FilterBtn>
        {(Object.keys(RECURRING_STATUS_LABEL) as RecurringStatus[]).map(s => (
          <FilterBtn key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{RECURRING_STATUS_LABEL[s]} ({counts[s]})</FilterBtn>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <div className="py-20 text-center"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty
          title="Todavía no hay cargos recurrentes"
          body="Importa al menos dos meses de cartolas y usa “Detectar en movimientos”: el sistema encuentra los cobros que se repiten con monto parecido. También puedes agregarlos a mano."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Cargo</th><th>Entidad</th><th>Categoría</th><th>Frecuencia</th><th className="text-right">Equivale al mes</th><th className="text-right">Último cobro</th><th>Visto</th><th>Decisión</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium">{r.name}</div>
                    {r.decision_note && <div className="text-ink-3 text-[12.5px] truncate max-w-[300px]" title={r.decision_note}>{r.decision_note}</div>}
                  </td>
                  <td className="text-ink-2">{r.entity_name ?? entities.find(e => e.id === r.entity_id)?.name ?? '—'}</td>
                  <td className="text-ink-2">{r.category_name ?? '—'}</td>
                  <td className="text-ink-2">{CADENCE_LABEL[r.cadence]}</td>
                  <td className="num text-right font-medium">{money(r.monthly_equivalent)}</td>
                  <td className="num text-right whitespace-nowrap"><Variation last={r.last_amount} expected={r.expected_amount ?? r.avg_amount} /></td>
                  <td className="text-ink-2 whitespace-nowrap text-[13px]">
                    {r.months_seen ? `${r.months_seen} ${r.months_seen === 1 ? 'mes' : 'meses'}` : '—'}
                    {r.last_seen && <div className="text-ink-3 text-[12px]">último {dateShort(r.last_seen)}</div>}
                  </td>
                  <td>
                    {canEdit ? (
                      <select
                        className="input py-1 text-[13px] w-[130px]"
                        value={r.status}
                        onChange={e => setStatus(r, e.target.value as RecurringStatus)}
                      >
                        {(Object.keys(RECURRING_STATUS_LABEL) as RecurringStatus[]).map(s => <option key={s} value={s}>{RECURRING_STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : <Chip tone={STATUS_TONE[r.status]}>{RECURRING_STATUS_LABEL[r.status]}</Chip>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {canEdit && (r.expected_amount ?? 0) > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setSaving(r)} title="Registrar un ahorro sobre este cargo"><PiggyBank size={14} /> Ahorro</button>
                    )}
                    {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>Editar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RecurringModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
      {saving && <RegisterSavingModal item={saving} onClose={() => setSaving(null)} onSaved={() => { setSaving(null); load() }} />}
      <p className="text-ink-3 text-[12.5px] mt-4 max-w-[80ch]">
        “Equivale al mes” prorratea los cargos anuales o trimestrales. El recorte decidido suma lo marcado como “Cancelar” y “Cancelado”; el panel principal solo cuenta como logrado lo ya “Cancelado”.
      </p>
    </div>
  )
}

function Variation({ last, expected }: { last: number | null | undefined; expected: number | null | undefined }) {
  if (last == null) return <span className="text-ink-3">—</span>
  if (!expected) return <span>{money(last)}</span>
  const delta = (last - expected) / expected
  const pctTxt = `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`
  const tone = Math.abs(delta) < 0.03 ? 'text-ink-3' : delta > 0 ? 'text-bad' : 'text-income'
  return (
    <span>
      {money(last)} <span className={`text-[12px] ${tone}`} title="Diferencia respecto al monto esperado">{Math.abs(delta) < 0.03 ? '=' : pctTxt}</span>
    </span>
  )
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-[13px] ${active ? 'bg-ink text-white' : 'bg-sheet border border-line-2 text-ink-2 hover:bg-paper'}`}>{children}</button>
  )
}

function RecurringModal({ item, onClose, onSaved }: { item: Recurring | null; onClose: () => void; onSaved: () => void }) {
  const { org, entities, categories } = useApp()
  const [name, setName] = useState(item?.name ?? '')
  const [pattern, setPattern] = useState(item?.match_pattern ?? '')
  const [entityId, setEntityId] = useState(item?.entity_id ?? '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [cadence, setCadence] = useState<Cadence>(item?.cadence ?? 'mensual')
  const [amount, setAmount] = useState(item?.expected_amount?.toString() ?? '')
  const [status, setStatus] = useState<RecurringStatus>(item?.status ?? 'revisar')
  const [note, setNote] = useState(item?.decision_note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!org) return
    setBusy(true); setErr(null)
    const payload = {
      org_id: org.id, name: name.trim(), match_pattern: (pattern || name).trim().toLowerCase(),
      entity_id: entityId || null, category_id: categoryId || null, cadence,
      expected_amount: amount ? Number(amount) : null, status, decision_note: note || null,
    }
    const q = item ? supabase.from('recurring_charges').update(payload).eq('id', item.id) : supabase.from('recurring_charges').insert(payload)
    const { error } = await q
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  async function remove() {
    if (!item || !confirm('¿Eliminar este cargo recurrente? Los movimientos quedan, solo se desvinculan.')) return
    const { error } = await supabase.from('recurring_charges').delete().eq('id', item.id)
    if (error) return setErr(error.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Editar cargo recurrente' : 'Nuevo cargo recurrente'}>
      <div className="flex flex-col gap-3">
        <Field label="Nombre"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Netflix, Arriendo local, Seguro camioneta" /></Field>
        <Field label="Texto que lo identifica en la cartola" hint="Los movimientos que contengan este texto se vincularán a este cargo.">
          <input className="input" value={pattern} onChange={e => setPattern(e.target.value)} placeholder={name.toLowerCase()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entidad">
            <select className="input" value={entityId} onChange={e => setEntityId(e.target.value)}>
              <option value="">—</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Categoría">
            <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {categories.filter(c => c.kind !== 'ingreso').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Frecuencia">
            <select className="input" value={cadence} onChange={e => setCadence(e.target.value as Cadence)}>
              {(Object.keys(CADENCE_LABEL) as Cadence[]).map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Monto por cobro (CLP)"><input className="input num" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        </div>
        <Field label="Decisión">
          <select className="input" value={status} onChange={e => setStatus(e.target.value as RecurringStatus)}>
            {(Object.keys(RECURRING_STATUS_LABEL) as RecurringStatus[]).map(s => <option key={s} value={s}>{RECURRING_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Nota"><textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Por qué se mantiene, con quién negociar, cuándo se cancela…" /></Field>
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-between pt-2">
          <div>{item && <button className="btn btn-ghost text-bad" onClick={remove}>Eliminar</button>}</div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function RegisterSavingModal({ item, onClose, onSaved }: { item: Recurring; onClose: () => void; onSaved: () => void }) {
  const navigate = useNavigate()
  const [action, setAction] = useState<'cancelado' | 'renegociado' | 'rebajado'>('cancelado')
  const [after, setAfter] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const before = item.expected_amount ?? 0
  const afterN = action === 'cancelado' ? 0 : Number(after.replace(/\./g, '') || 0)
  const savingN = before - afterN
  const valid = savingN > 0 && afterN >= 0 && (action === 'cancelado' || after !== '')

  async function save() {
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('register_saving', {
      p_recurring: item.id, p_action: action, p_amount_after: afterN, p_note: note || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
    navigate('/ahorros')
  }

  return (
    <Modal open onClose={onClose} title={`Registrar ahorro · ${item.name}`}>
      <p className="text-ink-2 text-[13px] mb-3">
        Hoy cuesta <b className="num">{money(before)}</b> por cobro. El ahorro quedará <b>esperando la cartola</b>: se confirma solo cuando el próximo cobro no aparezca, o aparezca rebajado.
      </p>
      <div className="flex flex-col gap-3">
        <Field label="Qué se hizo">
          <select className="input" value={action} onChange={e => setAction(e.target.value as typeof action)}>
            <option value="cancelado">Se canceló</option>
            <option value="renegociado">Se renegoció</option>
            <option value="rebajado">Se rebajó (cambio de plan, etc.)</option>
          </select>
        </Field>
        {action !== 'cancelado' && (
          <Field label="Nuevo monto por cobro (CLP)"><input className="input num" inputMode="numeric" value={after} onChange={e => setAfter(e.target.value)} /></Field>
        )}
        <Field label="Detalle" hint="Con quién se habló, número de solicitud, desde cuándo rige…">
          <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        {valid && (
          <div className="rounded-md bg-paper border border-line px-3 py-2 text-[13px] num">
            Ahorro mensual: <b>{money(savingN)}</b> · Comisión única si se verifica: <b>{money(Math.round(savingN / 2))}</b>
          </div>
        )}
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !valid}>{busy ? 'Guardando…' : 'Registrar ahorro'}</button>
        </div>
      </div>
    </Modal>
  )
}
