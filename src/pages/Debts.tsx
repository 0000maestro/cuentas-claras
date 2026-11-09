import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { fetchDebts } from '../lib/queries'
import { dateShort, money, pct, seriesColor } from '../lib/format'
import { DEBT_KIND_LABEL, type Debt, type DebtKind, type DebtPayment } from '../lib/types'
import { Chip, Empty, Field, Modal, PageHeader, Spinner, Stat } from '../components/ui'

export default function Debts() {
  const { org, entityId, entities, accounts, canEdit } = useApp()
  const [rows, setRows] = useState<Debt[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Debt | 'new' | null>(null)
  const [detail, setDetail] = useState<Debt | null>(null)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    setRows(await fetchDebts(org.id, entityId))
    setLoading(false)
  }, [org, entityId])
  useEffect(() => { load() }, [load])

  const active = rows.filter(d => d.status !== 'pagada')
  const remaining = active.reduce((a, d) => a + d.remaining_est!, 0)
  const paid = rows.reduce((a, d) => a + (d.paid_total ?? 0), 0)
  const monthly = active.reduce((a, d) => a + (d.monthly_payment ?? 0), 0)
  const interest = active.reduce((a, d) => a + (d.monthly_interest_est ?? 0), 0)
  const withRate = active.filter(d => d.annual_rate != null).length

  if (!org) return null

  return (
    <div>
      <PageHeader
        title="Deudas"
        subtitle="Cada crédito, línea, tarjeta o acreedor: cuánto era, cuánto va pagado, cuánto falta y qué cuesta al mes tenerlo."
        actions={canEdit && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Agregar deuda</button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Saldo total por pagar" value={money(remaining)} sub={`${active.length} deudas activas`} />
        <Stat label="Ya pagado" value={money(paid)} tone="good" sub="incluye lo pagado antes de llevar registro" />
        <Stat label="Cuotas al mes" value={money(monthly)} sub="suma de cuotas de deudas activas" />
        <Stat label="Costo financiero al mes" value={money(interest)} tone="bad" sub={withRate < active.length ? `estimado con tasa en ${withRate} de ${active.length} deudas` : 'intereses estimados sobre el saldo'} />
      </div>

      {loading && rows.length === 0 ? (
        <div className="py-20 text-center"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty
          title="Sin deudas registradas"
          body="Agrega cada crédito, línea o tarjeta con lo que se sepa: monto original, cuota, cuántas cuotas van y la tasa. Después se concilia con los movimientos de la cartola."
          action={canEdit && <button className="btn btn-primary" onClick={() => setEditing('new')}>Agregar deuda</button>}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Acreedor</th><th>Entidad</th><th>Tipo</th><th className="text-right">Monto original</th><th className="text-right">Pagado</th><th className="text-right">Falta</th><th>Avance</th><th className="text-right">Cuota</th><th className="text-right">Tasa</th><th className="text-right">Interés/mes</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const total = d.remaining_est! + (d.paid_total ?? 0)
                const p = total > 0 ? ((d.paid_total ?? 0) / total) * 100 : 0
                const color = seriesColor(entities.find(e => e.id === d.entity_id)?.color_slot ?? 1)
                return (
                  <tr key={d.id} className={d.status === 'pagada' ? 'opacity-60' : ''}>
                    <td className="min-w-[200px]">
                      <button className="font-medium text-left hover:text-accent" onClick={() => setDetail(d)}>{d.creditor}</button>
                      <div className="flex gap-1 mt-0.5">
                        {d.status === 'en_mora' && <Chip tone="bad">En mora</Chip>}
                        {d.status === 'pagada' && <Chip tone="good">Pagada</Chip>}
                        {d.status === 'refinanciada' && <Chip>Refinanciada</Chip>}
                        {d.installments_total && <span className="text-ink-3 text-[12px]">{d.installments_total} cuotas</span>}
                      </div>
                    </td>
                    <td className="text-ink-2">{d.entity_name}</td>
                    <td className="text-ink-2">{DEBT_KIND_LABEL[d.kind]}</td>
                    <td className="num text-right">{money(d.principal)}</td>
                    <td className="num text-right text-income">{money(d.paid_total)}</td>
                    <td className="num text-right font-medium">{money(d.remaining_est)}</td>
                    <td className="w-[120px]">
                      <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} /></div>
                      <div className="text-ink-3 text-[11.5px] mt-0.5 num">{pct(p)}</div>
                    </td>
                    <td className="num text-right">{money(d.monthly_payment)}</td>
                    <td className="num text-right text-ink-2">{d.annual_rate != null ? `${d.annual_rate}%` : '—'}</td>
                    <td className="num text-right text-bad">{money(d.monthly_interest_est)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-ghost btn-sm" onClick={() => setDetail(d)}>Pagos</button>
                      {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(d)}>Editar</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-ink-3 text-[12.5px] mt-4 max-w-[80ch]">
        “Falta” se calcula desde el saldo que informe el banco (si lo cargaste) menos los pagos posteriores; si no, desde el monto original menos lo pagado. El interés mensual es una estimación: saldo × tasa anual ÷ 12. Para el número exacto, usa el saldo de la cartola del crédito.
      </p>

      {editing && <DebtModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {detail && <PaymentsModal debt={detail} onClose={() => setDetail(null)} onChanged={load} canEdit={canEdit} accounts={accounts.length} />}
    </div>
  )
}

function DebtModal({ item, onClose, onSaved }: { item: Debt | null; onClose: () => void; onSaved: () => void }) {
  const { org, entities, accounts } = useApp()
  const [f, setF] = useState({
    creditor: item?.creditor ?? '',
    entity_id: item?.entity_id ?? entities[0]?.id ?? '',
    account_id: item?.account_id ?? '',
    kind: (item?.kind ?? 'credito_consumo') as DebtKind,
    principal: item?.principal?.toString() ?? '',
    start_date: item?.start_date ?? '',
    installments_total: item?.installments_total?.toString() ?? '',
    installment_amount: item?.installment_amount?.toString() ?? '',
    annual_rate: item?.annual_rate?.toString() ?? '',
    balance_manual: item?.balance_manual?.toString() ?? '',
    balance_manual_at: item?.balance_manual_at ?? '',
    paid_before_tracking: item?.paid_before_tracking?.toString() ?? '0',
    status: item?.status ?? 'activa',
    notes: item?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const num = (s: string) => (s === '' ? null : Number(s))

  async function save() {
    if (!org) return
    setBusy(true); setErr(null)
    const payload = {
      org_id: org.id, creditor: f.creditor.trim(), entity_id: f.entity_id, account_id: f.account_id || null, kind: f.kind,
      principal: Number(f.principal), start_date: f.start_date || null,
      installments_total: num(f.installments_total), installment_amount: num(f.installment_amount),
      annual_rate: num(f.annual_rate), balance_manual: num(f.balance_manual), balance_manual_at: f.balance_manual_at || null,
      paid_before_tracking: Number(f.paid_before_tracking || 0), status: f.status, notes: f.notes || null,
    }
    const q = item ? supabase.from('debts').update(payload).eq('id', item.id) : supabase.from('debts').insert(payload)
    const { error } = await q
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }
  async function remove() {
    if (!item || !confirm('¿Eliminar esta deuda y sus pagos registrados?')) return
    const { error } = await supabase.from('debts').delete().eq('id', item.id)
    if (error) return setErr(error.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Editar deuda' : 'Nueva deuda'} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Acreedor"><input className="input" value={f.creditor} onChange={set('creditor')} placeholder="Banco Santander, BCI, proveedor, persona…" /></Field>
        <Field label="Tipo">
          <select className="input" value={f.kind} onChange={set('kind')}>
            {(Object.keys(DEBT_KIND_LABEL) as DebtKind[]).map(k => <option key={k} value={k}>{DEBT_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="A nombre de">
          <select className="input" value={f.entity_id} onChange={set('entity_id')}>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Cuenta desde donde se paga (opcional)">
          <select className="input" value={f.account_id} onChange={set('account_id')}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.bank} · {a.name}{a.last4 ? ` ····${a.last4}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Monto original (CLP)"><input className="input num" type="number" value={f.principal} onChange={set('principal')} /></Field>
        <Field label="Fecha de inicio"><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Cuotas totales"><input className="input num" type="number" value={f.installments_total} onChange={set('installments_total')} /></Field>
        <Field label="Cuota mensual (CLP)"><input className="input num" type="number" value={f.installment_amount} onChange={set('installment_amount')} /></Field>
        <Field label="Tasa anual (%)" hint="Ej: 24.5 — sirve para estimar el costo financiero mensual."><input className="input num" type="number" step="0.01" value={f.annual_rate} onChange={set('annual_rate')} /></Field>
        <Field label="Pagado antes de llevar registro (CLP)" hint="Lo que ya se había pagado antes de importar cartolas."><input className="input num" type="number" value={f.paid_before_tracking} onChange={set('paid_before_tracking')} /></Field>
        <Field label="Saldo informado por el banco (CLP)" hint="Si lo tienes, manda sobre el cálculo."><input className="input num" type="number" value={f.balance_manual} onChange={set('balance_manual')} /></Field>
        <Field label="Fecha de ese saldo"><input className="input" type="date" value={f.balance_manual_at} onChange={set('balance_manual_at')} /></Field>
        <Field label="Estado">
          <select className="input" value={f.status} onChange={set('status')}>
            <option value="activa">Activa</option><option value="en_mora">En mora</option><option value="refinanciada">Refinanciada</option><option value="pagada">Pagada</option>
          </select>
        </Field>
        <div className="col-span-2"><Field label="Notas"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field></div>
      </div>
      {err && <p className="text-bad mt-3">{err}</p>}
      <div className="flex justify-between pt-4">
        <div>{item && <button className="btn btn-ghost text-bad" onClick={remove}>Eliminar</button>}</div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !f.creditor.trim() || !f.principal || !f.entity_id}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  )
}

function PaymentsModal({ debt, onClose, onChanged, canEdit }: { debt: Debt; onClose: () => void; onChanged: () => void; canEdit: boolean; accounts: number }) {
  const [rows, setRows] = useState<DebtPayment[]>([])
  const [linked, setLinked] = useState<{ id: number; posted_at: string; description: string; amount: number }[]>([])
  const [f, setF] = useState({ paid_at: new Date().toISOString().slice(0, 10), amount: '', interest_part: '', notes: '' })
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from('debt_payments').select('*').eq('debt_id', debt.id).order('paid_at', { ascending: false }),
      supabase.from('transactions').select('id, posted_at, description, amount').eq('debt_id', debt.id).order('posted_at', { ascending: false }).limit(50),
    ])
    setRows(((p ?? []) as DebtPayment[]).map(x => ({ ...x, amount: Number(x.amount) })))
    setLinked(((t ?? []) as typeof linked).map(x => ({ ...x, amount: Number(x.amount) })))
  }, [debt.id])
  useEffect(() => { load() }, [load])

  async function add() {
    setErr(null)
    const amount = Number(f.amount)
    const interest = f.interest_part === '' ? null : Number(f.interest_part)
    const { error } = await supabase.from('debt_payments').insert({
      debt_id: debt.id, org_id: debt.org_id, paid_at: f.paid_at, amount,
      interest_part: interest, principal_part: interest == null ? null : amount - interest, notes: f.notes || null,
    })
    if (error) return setErr(error.message)
    setF({ ...f, amount: '', interest_part: '', notes: '' })
    load(); onChanged()
  }
  async function importLinked() {
    // Registrar como pagos los movimientos vinculados a esta deuda que aún no están registrados
    const existingTx = new Set(rows.map(r => r.transaction_id).filter(Boolean))
    const toAdd = linked.filter(t => !existingTx.has(t.id)).map(t => ({
      debt_id: debt.id, org_id: debt.org_id, paid_at: t.posted_at, amount: Math.abs(t.amount), transaction_id: t.id,
    }))
    if (toAdd.length === 0) return alert('No hay movimientos nuevos vinculados a esta deuda.')
    const { error } = await supabase.from('debt_payments').insert(toAdd)
    if (error) return setErr(error.message)
    load(); onChanged()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('debt_payments').delete().eq('id', id)
    if (error) return setErr(error.message)
    load(); onChanged()
  }

  const pendingLinked = linked.filter(t => !rows.some(r => r.transaction_id === t.id)).length

  return (
    <Modal open onClose={onClose} title={`Pagos · ${debt.creditor}`} width="max-w-2xl">
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div><div className="text-ink-3 text-[12.5px]">Pagado</div><div className="num font-semibold text-income">{money(debt.paid_total)}</div></div>
        <div><div className="text-ink-3 text-[12.5px]">Falta</div><div className="num font-semibold">{money(debt.remaining_est)}</div></div>
        <div><div className="text-ink-3 text-[12.5px]">Último pago</div><div className="font-semibold">{dateShort(debt.last_payment_at)}</div></div>
      </div>

      {canEdit && (
        <div className="card bg-paper p-3 mb-4">
          <div className="grid grid-cols-4 gap-2 items-end">
            <Field label="Fecha"><input className="input py-1.5" type="date" value={f.paid_at} onChange={e => setF({ ...f, paid_at: e.target.value })} /></Field>
            <Field label="Monto"><input className="input py-1.5 num" type="number" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="De eso, interés (opcional)"><input className="input py-1.5 num" type="number" value={f.interest_part} onChange={e => setF({ ...f, interest_part: e.target.value })} /></Field>
            <button className="btn btn-primary py-1.5" onClick={add} disabled={!f.amount}>Registrar pago</button>
          </div>
          {pendingLinked > 0 && (
            <div className="flex items-center justify-between mt-3 text-[13px]">
              <span className="text-ink-2">{pendingLinked} movimientos de cartola vinculados a esta deuda aún no están registrados como pago.</span>
              <button className="btn btn-outline btn-sm" onClick={importLinked}>Registrarlos</button>
            </div>
          )}
        </div>
      )}
      {err && <p className="text-bad mb-3">{err}</p>}

      {rows.length === 0 ? (
        <p className="text-ink-2">Sin pagos registrados todavía.</p>
      ) : (
        <table className="data">
          <thead><tr><th>Fecha</th><th className="text-right">Monto</th><th className="text-right">Interés</th><th className="text-right">Capital</th><th>Origen</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{dateShort(r.paid_at)}</td>
                <td className="num text-right">{money(r.amount)}</td>
                <td className="num text-right text-ink-2">{money(r.interest_part)}</td>
                <td className="num text-right text-ink-2">{money(r.principal_part)}</td>
                <td className="text-ink-3 text-[12.5px]">{r.transaction_id ? 'Cartola' : 'Manual'}{r.notes ? ` · ${r.notes}` : ''}</td>
                <td className="text-right">{canEdit && <button className="btn btn-ghost btn-sm text-bad" onClick={() => remove(r.id)}>Quitar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
