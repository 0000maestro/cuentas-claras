import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Circle, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { fetchAgreement, fetchProcessOperations, fetchSavings, fetchSavingsSummary, fetchTransactions } from '../lib/queries'
import { dateShort, money } from '../lib/format'
import {
  COMMISSION_STATUS_LABEL, SAVING_ACTION_LABEL, SAVING_STATUS_LABEL,
  type Agreement, type CommissionStatus, type ProcessOperation, type SavingEvent, type SavingStatus, type SavingsSummary, type Transaction,
} from '../lib/types'
import { Chip, Empty, Field, Modal, PageHeader, Spinner, Stat } from '../components/ui'

const STATUS_TONE: Record<SavingStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  pendiente: 'warn', verificado: 'good', no_logrado: 'neutral', reaparecio: 'good',
}
const COMMISSION_TONE: Record<CommissionStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'accent'> = {
  pendiente: 'neutral', devengada: 'accent', pagada: 'good', anulada: 'neutral',
}

const rate = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const units = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 })

export default function Savings() {
  const { org, role, canEdit } = useApp()
  const [rows, setRows] = useState<SavingEvent[]>([])
  const [summary, setSummary] = useState<SavingsSummary | null>(null)
  const [agreement, setAgreement] = useState<Agreement | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<SavingEvent | null>(null)
  const [newProcess, setNewProcess] = useState(false)
  const [showTerms, setShowTerms] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const [s, sm, a] = await Promise.all([fetchSavings(org.id), fetchSavingsSummary(org.id), fetchAgreement(org.id)])
    setRows(s); setSummary(sm); setAgreement(a)
    setLoading(false)
  }, [org])
  useEffect(() => { load() }, [load])

  async function verifyNow() {
    if (!org) return
    setBusy(true)
    const { data, error } = await supabase.rpc('verify_savings', { p_org: org.id })
    setBusy(false)
    if (error) return alert(error.message)
    alert(data > 0 ? `Se verificaron ${data} ahorros con las cartolas cargadas.` : 'No hay ahorros nuevos para verificar todavía: faltan cartolas que cubran sus fechas.')
    load()
  }

  if (!org) return null
  const pct = agreement?.commission_pct ?? 50
  const keepPct = summary && summary.ahorro_proyectado_12m > 0
    ? 100 - ((summary.comision_devengada + summary.comision_pagada) / summary.ahorro_proyectado_12m) * 100
    : null

  return (
    <div>
      <PageHeader
        title="Ahorros y comisión"
        subtitle={`Cada ahorro se registra antes de ocurrir y se confirma solo cuando la cartola lo demuestra. La comisión es el ${pct}% del ahorro de un mes, una sola vez por ítem.`}
        actions={canEdit && (
          <>
            <button className="btn btn-outline" onClick={verifyNow} disabled={busy}>{busy ? <Spinner /> : <RefreshCw size={15} />} Verificar con cartolas</button>
            <button className="btn btn-primary" onClick={() => setNewProcess(true)}><Plus size={15} /> Ahorro de proceso</button>
          </>
        )}
      />

      <AgreementBanner agreement={agreement} role={role} onOpen={() => setShowTerms(true)} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Ahorro mensual verificado" value={money(summary?.ahorro_mensual_total ?? 0)} tone="good"
          sub={`${summary?.verificados ?? 0} verificados · ${summary?.pendientes ?? 0} esperando cartola`} />
        <Stat label="Ahorro proyectado a 12 meses" value={money(summary?.ahorro_proyectado_12m ?? 0)}
          sub={keepPct != null ? `El cliente conserva el ${keepPct.toFixed(0)}%` : 'Si el ahorro se mantiene'} />
        <Stat label="Comisión por pagar" value={money(summary?.comision_devengada ?? 0)} sub="Devengada al verificarse" />
        <Stat label="Comisión pagada" value={money(summary?.comision_pagada ?? 0)} />
      </div>

      {loading && rows.length === 0 ? (
        <div className="py-20 text-center"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty
          title="Todavía no hay ahorros registrados"
          body={<>Hay dos formas de registrar uno: en <b>Costos recurrentes</b>, con “Registrar ahorro” sobre un cargo que se canceló o se rebajó; o aquí, con <b>Ahorro de proceso</b>, cuando lo que cambia es la forma de pagar algo (por ejemplo, comprar USDT por P2P).</>}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Ahorro</th><th>Antes → después</th><th>Período</th><th>Estado</th>
                <th className="text-right">Ahorro del mes</th><th className="text-right">Comisión</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="cursor-pointer hover:bg-paper" onClick={() => setDetail(s)}>
                  <td>
                    <div className="font-medium">{s.title}</div>
                    <div className="text-ink-3 text-[12.5px]">
                      {SAVING_ACTION_LABEL[s.action]}{s.entity_name ? ` · ${s.entity_name}` : ''}
                    </div>
                  </td>
                  <td className="num whitespace-nowrap text-[13px]">
                    {s.kind === 'proceso'
                      ? <>{rate(s.rate_before)} → {rate(s.rate_after)} <span className="text-ink-3">por {s.unit_label}</span></>
                      : <>{money(s.amount_before)} → {money(s.status === 'pendiente' ? s.amount_after_expected : s.amount_after_actual)} <span className="text-ink-3">/mes</span></>}
                  </td>
                  <td className="text-ink-2 text-[13px] whitespace-nowrap">
                    {dateShort(s.window_start)} – {dateShort(s.window_end)}
                    {s.kind === 'proceso' && <div className="text-ink-3 text-[12px]">{s.ops_linked}/{s.ops_total} operaciones cruzadas</div>}
                  </td>
                  <td><Chip tone={STATUS_TONE[s.status]}>{SAVING_STATUS_LABEL[s.status]}</Chip></td>
                  <td className="num text-right font-medium">{money(s.monthly_saving)}</td>
                  <td className="num text-right">
                    <div>{money(s.commission_amount)}</div>
                    <div className="text-[12px]"><Chip tone={COMMISSION_TONE[s.commission_status]}>{COMMISSION_STATUS_LABEL[s.commission_status]}</Chip></div>
                  </td>
                  <td className="text-right"><button className="btn btn-ghost btn-sm">Detalle</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-ink-3 text-[12.5px] mt-4 max-w-[85ch]">
        Un ahorro verificado no se puede editar ni borrar. Si un cargo ahorrado vuelve a aparecer más adelante, queda marcado como “reapareció” para que se vea, pero la comisión ya ganada se mantiene.
      </p>

      {detail && <SavingDetail saving={detail} onClose={() => setDetail(null)} onChanged={() => { load() }} />}
      {newProcess && <NewProcessModal onClose={() => setNewProcess(false)} onSaved={() => { setNewProcess(false); load() }} />}
      {showTerms && agreement && <TermsModal agreement={agreement} role={role} onClose={() => setShowTerms(false)} onAccepted={() => { setShowTerms(false); load() }} />}
    </div>
  )
}

function AgreementBanner({ agreement, role, onOpen }: { agreement: Agreement | null; role: string | null; onOpen: () => void }) {
  if (!agreement) {
    return <div className="card px-5 py-3.5 mb-5 text-ink-2">Esta organización no tiene un acuerdo de ahorro compartido.</div>
  }
  const accepted = !!agreement.accepted_at
  return (
    <div className="card px-5 py-3.5 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <FileText size={18} className="text-accent mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">
            Acuerdo de ahorro compartido · {agreement.commission_pct}% {agreement.payout === 'unico' ? 'pago único por ítem' : 'recurrente'}
          </div>
          <div className="text-ink-2 text-[13px]">
            {accepted
              ? <>Aceptado por {agreement.accepted_email ?? 'el cliente'} el {dateShort(agreement.accepted_at!.slice(0, 10))}. Los términos ya no se pueden modificar.</>
              : role === 'owner'
                ? 'Esperando que el cliente lo lea y lo acepte desde su cuenta.'
                : 'Pendiente de tu aceptación. Léelo antes de aceptar.'}
          </div>
        </div>
      </div>
      <button className={`btn ${!accepted && role !== 'owner' ? 'btn-primary' : 'btn-outline'} btn-sm shrink-0`} onClick={onOpen}>
        {!accepted && role !== 'owner' ? 'Leer y aceptar' : 'Ver acuerdo'}
      </button>
    </div>
  )
}

function TermsModal({ agreement, role, onClose, onAccepted }: { agreement: Agreement; role: string | null; onClose: () => void; onAccepted: () => void }) {
  const [busy, setBusy] = useState(false)
  const canAccept = !agreement.accepted_at && role !== 'owner'
  async function accept() {
    setBusy(true)
    const { error } = await supabase.rpc('accept_agreement', { p_agreement: agreement.id })
    setBusy(false)
    if (error) return alert(error.message)
    onAccepted()
  }
  return (
    <Modal open onClose={onClose} title="Acuerdo de ahorro compartido" width="max-w-2xl">
      <Markdown text={agreement.terms_md} />
      {agreement.accepted_at && (
        <p className="mt-4 text-[13px] text-income">Aceptado por {agreement.accepted_email} el {dateShort(agreement.accepted_at.slice(0, 10))}.</p>
      )}
      {canAccept && (
        <div className="flex justify-end gap-2 pt-5 mt-4 border-t border-line">
          <button className="btn btn-ghost" onClick={onClose}>Ahora no</button>
          <button className="btn btn-primary" onClick={accept} disabled={busy}>{busy ? 'Guardando…' : 'Acepto este acuerdo'}</button>
        </div>
      )}
    </Modal>
  )
}

/** Markdown mínimo: títulos (#), listas numeradas y **negritas**. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p)
  return (
    <div className="flex flex-col gap-2 text-[14px] leading-relaxed">
      {text.split('\n').filter(l => l.trim()).map((l, i) => {
        if (l.startsWith('# ')) return <h3 key={i} className="font-semibold text-[16px]">{l.slice(2)}</h3>
        const m = l.match(/^(\d+)\.\s+(.*)$/)
        if (m) return <div key={i} className="flex gap-2"><span className="text-ink-3 num">{m[1]}.</span><span>{inline(m[2])}</span></div>
        return <p key={i}>{inline(l)}</p>
      })}
    </div>
  )
}

function SavingDetail({ saving, onClose, onChanged }: { saving: SavingEvent; onClose: () => void; onChanged: () => void }) {
  const { org, canEdit, accounts } = useApp()
  const [s, setS] = useState(saving)
  const [ops, setOps] = useState<ProcessOperation[]>([])
  const [linked, setLinked] = useState<Record<number, Transaction>>({})
  const [err, setErr] = useState<string | null>(null)
  const [payOpen, setPayOpen] = useState(false)

  const loadOps = useCallback(async () => {
    if (s.kind !== 'proceso') return
    const o = await fetchProcessOperations(s.id)
    setOps(o)
    const ids = o.map(x => x.transaction_id).filter((x): x is number => x != null)
    if (ids.length) {
      const { data } = await supabase.from('transactions').select('*').in('id', ids)
      setLinked(Object.fromEntries(((data as Transaction[]) ?? []).map(t => [t.id, t])))
    }
  }, [s.id, s.kind])
  useEffect(() => { loadOps() }, [loadOps])

  async function refresh() {
    const { data } = await supabase.from('v_savings').select('*').eq('id', s.id).single()
    if (data) setS({ ...(data as SavingEvent), monthly_saving: data.monthly_saving == null ? null : Number(data.monthly_saving), commission_amount: data.commission_amount == null ? null : Number(data.commission_amount) })
    await loadOps(); onChanged()
  }

  async function removeSaving() {
    if (!confirm('¿Eliminar este ahorro? Solo se puede mientras no esté verificado.')) return
    const { error } = await supabase.from('savings_events').delete().eq('id', s.id)
    if (error) return setErr(error.message)
    onChanged(); onClose()
  }

  async function removeOp(id: string) {
    const { error } = await supabase.from('process_operations').delete().eq('id', id)
    if (error) return setErr(error.message)
    refresh()
  }

  const open = s.status === 'pendiente'
  const before = ops.filter(o => o.phase === 'antes')
  const after = ops.filter(o => o.phase === 'despues')
  const r = (list: ProcessOperation[]) => {
    const u = list.reduce((a, o) => a + o.units, 0)
    return u ? list.reduce((a, o) => a + o.clp_amount, 0) / u : null
  }
  const rb = r(before), ra = r(after)
  const afterUnits = after.filter(o => o.op_date >= s.window_start && o.op_date <= s.window_end).reduce((a, o) => a + o.units, 0)
  const estSaving = rb != null && ra != null ? Math.round(afterUnits * (rb - ra)) : null

  return (
    <Modal open onClose={onClose} title={s.title} width="max-w-3xl">
      <div className="flex flex-wrap gap-2 mb-4">
        <Chip tone={STATUS_TONE[s.status]}>{SAVING_STATUS_LABEL[s.status]}</Chip>
        <Chip>{SAVING_ACTION_LABEL[s.action]}</Chip>
        <Chip tone={COMMISSION_TONE[s.commission_status]}>Comisión: {COMMISSION_STATUS_LABEL[s.commission_status]}</Chip>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mb-4 text-[13px]">
        {s.kind === 'cargo' ? (
          <>
            <Def label="Costaba al mes">{money(s.amount_before)}</Def>
            <Def label={open ? 'Debería quedar en' : 'Quedó en'}>{money(open ? s.amount_after_expected : s.amount_after_actual)}</Def>
            <Def label="Próximo cobro esperado">{dateShort(s.window_start)} – {dateShort(s.window_end)}</Def>
            <Def label="Texto en la cartola">{s.match_pattern}</Def>
          </>
        ) : (
          <>
            <Def label={`Costo por ${s.unit_label} antes`}>{rate(s.rate_before ?? rb)}</Def>
            <Def label={`Costo por ${s.unit_label} después`}>{rate(s.rate_after ?? ra)}</Def>
            <Def label="Mes que se mide">{dateShort(s.window_start)} – {dateShort(s.window_end)}</Def>
            <Def label={`Volumen (${s.unit_label})`}>{units(s.volume_units ?? afterUnits)}</Def>
          </>
        )}
        <Def label="Ahorro del mes">{money(s.monthly_saving ?? (open && s.kind === 'proceso' ? estSaving : null))}{open && s.kind === 'proceso' && estSaving != null && <span className="text-ink-3"> (estimado)</span>}</Def>
        <Def label={`Comisión (${s.commission_pct}%)`}>{money(s.commission_amount ?? (open && estSaving != null && s.kind === 'proceso' ? Math.round(estSaving * s.commission_pct / 100) : null))}</Def>
        {s.commission_paid_at && <Def label="Comisión pagada el">{dateShort(s.commission_paid_at)}</Def>}
        {s.reappeared_at && <Def label="Reapareció el">{dateShort(s.reappeared_at)}</Def>}
      </dl>

      {s.action_note && <p className="text-ink-2 text-[13px] mb-3"><b className="text-ink">Qué se hizo:</b> {s.action_note}</p>}

      <div className={`rounded-md px-4 py-3 text-[13px] mb-4 ${s.status === 'pendiente' ? 'bg-warn-soft' : s.status === 'no_logrado' ? 'bg-line/60' : 'bg-income-soft'}`}>
        <b>Verificación: </b>
        {s.verification_detail ?? (s.kind === 'cargo'
          ? `Se confirmará sola cuando se cargue una cartola de la cuenta donde se cobraba que llegue al ${dateShort(s.window_end)} más ${s.grace_days} días de margen.`
          : `Se confirmará sola cuando todas las operaciones estén cruzadas con la cartola y las cartolas cubran hasta el ${dateShort(s.window_end)} más ${s.grace_days} días.`)}
      </div>

      {s.kind === 'proceso' && (
        <div className="mb-4">
          <OpsTable title="Antes (línea base)" ops={before} linked={linked} canDelete={canEdit && open} onDelete={removeOp} />
          <OpsTable title="Después (proceso nuevo)" ops={after} linked={linked} canDelete={canEdit && open} onDelete={removeOp} />
          {canEdit && open && org && <AddOperation saving={s} accounts={accounts} onAdded={refresh} />}
        </div>
      )}

      {err && <p className="text-bad mb-3">{err}</p>}

      {canEdit && (
        <div className="flex justify-between pt-3 border-t border-line">
          <div>{open && <button className="btn btn-ghost text-bad" onClick={removeSaving}>Eliminar</button>}</div>
          <div>
            {s.commission_status === 'devengada' && <button className="btn btn-primary" onClick={() => setPayOpen(true)}>Marcar comisión pagada</button>}
          </div>
        </div>
      )}
      {payOpen && <PayCommission saving={s} onClose={() => setPayOpen(false)} onSaved={() => { setPayOpen(false); refresh() }} />}
    </Modal>
  )
}

function Def({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-ink-3 text-[12px]">{label}</dt>
      <dd className="num font-medium">{children}</dd>
    </div>
  )
}

function OpsTable({ title, ops, linked, canDelete, onDelete }: {
  title: string; ops: ProcessOperation[]; linked: Record<number, Transaction>; canDelete: boolean; onDelete: (id: string) => void
}) {
  return (
    <div className="mb-3">
      <div className="text-[13px] font-medium mb-1.5">{title}</div>
      {ops.length === 0 ? (
        <div className="text-ink-3 text-[13px] border border-dashed border-line-2 rounded-md px-3 py-2.5">Sin operaciones todavía.</div>
      ) : (
        <div className="border border-line rounded-md overflow-x-auto">
          <table className="data">
            <thead><tr><th>Fecha</th><th>Referencia</th><th className="text-right">Pesos</th><th className="text-right">Unidades</th><th className="text-right">Costo unitario</th><th>Cartola</th><th></th></tr></thead>
            <tbody>
              {ops.map(o => {
                const t = o.transaction_id != null ? linked[o.transaction_id] : undefined
                return (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap">{dateShort(o.op_date)}</td>
                    <td className="text-ink-2">{o.reference ?? '—'}</td>
                    <td className="num text-right">{money(o.clp_amount)}</td>
                    <td className="num text-right">{units(o.units)}</td>
                    <td className="num text-right">{rate(o.clp_amount / o.units)}</td>
                    <td className="text-[12.5px]">
                      {o.transaction_id
                        ? <span className="inline-flex items-center gap-1 text-income" title={t ? `${t.description} · ${dateShort(t.posted_at)}` : ''}><CheckCircle2 size={14} /> {t ? `${dateShort(t.posted_at)} · ${t.description.slice(0, 22)}` : 'Cruzada'}</span>
                        : <span className="inline-flex items-center gap-1 text-ink-3"><Circle size={14} /> Falta la cartola</span>}
                    </td>
                    <td className="text-right">{canDelete && <button className="btn btn-ghost btn-sm" onClick={() => onDelete(o.id)} aria-label="Eliminar"><Trash2 size={14} /></button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AddOperation({ saving, accounts, onAdded }: { saving: SavingEvent; accounts: { id: string; name: string; bank: string }[]; onAdded: () => void }) {
  const [phase, setPhase] = useState<'antes' | 'despues'>('despues')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [clp, setClp] = useState('')
  const [u, setU] = useState('')
  const [ref, setRef] = useState('')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const clpN = Number(clp.replace(/\./g, '')), uN = Number(u.replace(',', '.'))

  async function add() {
    setBusy(true); setErr(null)
    const { error } = await supabase.from('process_operations').insert({
      org_id: saving.org_id, saving_id: saving.id, phase, op_date: date,
      clp_amount: clpN, units: uN, reference: ref || null, account_id: account || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setClp(''); setU(''); setRef('')
    onAdded()
  }

  return (
    <div className="card p-4 mt-2 bg-paper">
      <div className="text-[13px] font-medium mb-2">Agregar operación</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Tipo">
          <select className="input" value={phase} onChange={e => setPhase(e.target.value as 'antes' | 'despues')}>
            <option value="despues">Después (proceso nuevo)</option>
            <option value="antes">Antes (línea base)</option>
          </select>
        </Field>
        <Field label="Fecha"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Cuenta de donde salieron los pesos">
          <select className="input" value={account} onChange={e => setAccount(e.target.value)}>
            <option value="">Cualquiera</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.bank} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Pesos pagados (CLP)" hint="Exactamente como aparecerá en la cartola">
          <input className="input num" inputMode="numeric" value={clp} onChange={e => setClp(e.target.value)} placeholder="4.760.000" />
        </Field>
        <Field label={`${saving.unit_label ?? 'Unidades'} recibidos`}>
          <input className="input num" inputMode="decimal" value={u} onChange={e => setU(e.target.value)} placeholder="5000" />
        </Field>
        <Field label="Referencia" hint="Nº de orden P2P o comprobante">
          <input className="input" value={ref} onChange={e => setRef(e.target.value)} />
        </Field>
      </div>
      {clpN > 0 && uN > 0 && <p className="text-ink-2 text-[13px] mt-2">Costo unitario: <b className="num">{rate(clpN / uN)}</b> por {saving.unit_label}</p>}
      {err && <p className="text-bad mt-2">{err}</p>}
      <div className="flex justify-end mt-3">
        <button className="btn btn-primary btn-sm" onClick={add} disabled={busy || !(clpN > 0) || !(uN > 0)}>{busy ? 'Guardando…' : 'Agregar'}</button>
      </div>
    </div>
  )
}

function PayCommission({ saving, onClose, onSaved }: { saving: SavingEvent; onClose: () => void; onSaved: () => void }) {
  const { org } = useApp()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [txId, setTxId] = useState('')
  const [candidates, setCandidates] = useState<Transaction[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!org || !saving.commission_amount) return
    const from = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10)
    fetchTransactions(org.id, { from, limit: 1000 }).then(ts => {
      const c = saving.commission_amount!
      setCandidates(ts.filter(t => t.amount < 0 && Math.abs(Math.abs(t.amount) - c) <= c * 0.02))
    })
  }, [org, saving.commission_amount])

  async function save() {
    setBusy(true); setErr(null)
    const tx = candidates.find(t => String(t.id) === txId)
    const { error } = await supabase.from('savings_events').update({
      commission_status: 'pagada',
      commission_paid_at: tx?.posted_at ?? date,
      commission_payment_tx: tx ? tx.id : null,
    }).eq('id', saving.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Registrar pago de comisión">
      <p className="text-ink-2 mb-3">Comisión de <b className="num">{money(saving.commission_amount)}</b> por “{saving.title}”.</p>
      <div className="flex flex-col gap-3">
        <Field label="Transferencia en la cartola (recomendado)" hint={candidates.length ? 'Movimientos con un monto parecido a la comisión en los últimos 120 días.' : 'No hay movimientos con un monto parecido. Puedes registrar solo la fecha y enlazarla después.'}>
          <select className="input" value={txId} onChange={e => setTxId(e.target.value)}>
            <option value="">Sin enlazar</option>
            {candidates.map(t => <option key={t.id} value={t.id}>{dateShort(t.posted_at)} · {t.description} · {money(t.amount)}</option>)}
          </select>
        </Field>
        {!txId && <Field label="Fecha de pago"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>}
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Confirmar pago'}</button>
        </div>
      </div>
    </Modal>
  )
}

function NewProcessModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { org, entities, month } = useApp()
  const [title, setTitle] = useState('Compra de USDT para proveedores vía P2P')
  const [unit, setUnit] = useState('USDT')
  const [entityId, setEntityId] = useState(entities.find(e => /genio/i.test(e.name))?.id ?? '')
  const monthStart = month.slice(0, 10)
  const d = new Date(monthStart + 'T00:00:00')
  const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
  const [start, setStart] = useState(monthStart)
  const [end, setEnd] = useState(monthEnd)
  const [note, setNote] = useState('Antes: Santander (pesos a dólares) → tarjeta de crédito → compra de USDT en Binance con tarjeta. Ahora: P2P en Binance, transferencia en pesos y USDT directo.')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!org) return
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('register_process_saving', {
      p_org: org.id, p_title: title.trim(), p_unit_label: unit.trim(),
      p_measure_start: start, p_measure_end: end, p_entity: entityId || null, p_note: note || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Nuevo ahorro de proceso">
      <p className="text-ink-2 text-[13px] mb-3">
        Para cambios en la forma de pagar algo. Se compara el costo real por unidad antes y después; el ahorro del mes que se mide es la base de la comisión. Después de crearlo, abre el detalle y agrega las operaciones de antes y de después.
      </p>
      <div className="flex flex-col gap-3">
        <Field label="Nombre"><input className="input" value={title} onChange={e => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unidad que se compra" hint="Ej.: USDT, USD, litros"><input className="input" value={unit} onChange={e => setUnit(e.target.value)} /></Field>
          <Field label="Entidad">
            <select className="input" value={entityId} onChange={e => setEntityId(e.target.value)}>
              <option value="">—</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Mes que se mide: desde"><input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Qué cambió"><textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field>
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !title.trim() || !unit.trim()}>{busy ? 'Guardando…' : 'Crear'}</button>
        </div>
      </div>
    </Modal>
  )
}
