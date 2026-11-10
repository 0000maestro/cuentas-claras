import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Wand2 } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { fetchDebts, fetchTransactions } from '../lib/queries'
import { dateDay, money, monthLabel } from '../lib/format'
import type { Debt, Transaction } from '../lib/types'
import { Chip, Empty, Field, Modal, PageHeader, Spinner } from '../components/ui'

type Filter = 'todos' | 'sin_categoria' | 'salidas' | 'entradas' | 'traspasos'

export default function Transactions() {
  const { org, entityId, entities, accounts, categories, month, canEdit, refreshOrg } = useApp()
  const [rows, setRows] = useState<Transaction[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')
  const [accountId, setAccountId] = useState<string>('')
  const [ruleFor, setRuleFor] = useState<Transaction | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const [t, d] = await Promise.all([
      fetchTransactions(org.id, { month, entityId, accountId: accountId || null, search: search || undefined, limit: 1000 }),
      fetchDebts(org.id, null),
    ])
    setRows(t); setDebts(d); setLoading(false)
  }, [org, month, entityId, accountId, search])

  useEffect(() => { const id = setTimeout(load, search ? 250 : 0); return () => clearTimeout(id) }, [load, search])

  const visible = useMemo(() => rows.filter(t => {
    if (filter === 'sin_categoria') return !t.category_id && !t.is_transfer
    if (filter === 'salidas') return t.amount < 0 && !t.is_transfer
    if (filter === 'entradas') return t.amount > 0 && !t.is_transfer
    if (filter === 'traspasos') return t.is_transfer
    return true
  }), [rows, filter])

  const totals = useMemo(() => ({
    in: visible.filter(t => t.amount > 0 && !t.is_transfer).reduce((a, t) => a + t.amount, 0),
    out: visible.filter(t => t.amount < 0 && !t.is_transfer).reduce((a, t) => a + t.amount, 0),
    uncat: rows.filter(t => !t.category_id && !t.is_transfer).length,
  }), [visible, rows])

  const visibleAccounts = useMemo(() => entityId ? accounts.filter(a => a.entity_id === entityId) : accounts, [accounts, entityId])

  async function patch(t: Transaction, changes: Partial<Transaction>) {
    setRows(rs => rs.map(r => r.id === t.id ? { ...r, ...changes } : r))
    const { error } = await supabase.from('transactions').update(changes).eq('id', t.id)
    if (error) { alert(error.message); load() }
  }

  async function runDetect() {
    if (!org) return
    setBusy(true)
    const { data, error } = await supabase.rpc('detect_recurring', { p_org: org.id })
    setBusy(false)
    if (error) return alert(error.message)
    alert(data > 0 ? `Se detectaron ${data} cargos recurrentes nuevos. Revísalos en “Costos recurrentes”.` : 'No aparecieron cargos recurrentes nuevos.')
    load()
  }

  if (!org) return null

  return (
    <div>
      <PageHeader
        title="Movimientos"
        subtitle={`${monthLabel(month)} · ${rows.length} movimientos${totals.uncat ? ` · ${totals.uncat} sin categoría` : ''}`}
        actions={canEdit && (
          <>
            <button className="btn btn-outline" onClick={runDetect} disabled={busy}>
              {busy ? <Spinner /> : <Wand2 size={15} />} Detectar recurrentes
            </button>
            <Link to="/importar" className="btn btn-primary hidden sm:inline-flex">Subir archivos</Link>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative w-full sm:w-auto">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-8 w-full sm:w-[260px] py-1.5" placeholder="Buscar en descripción" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-full sm:w-[320px] py-1.5" value={accountId} onChange={e => setAccountId(e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {visibleAccounts.map(a => <option key={a.id} value={a.id}>{entities.find(e => e.id === a.entity_id)?.name} · {a.bank} {a.last4 ? `····${a.last4}` : ''}</option>)}
        </select>
        <div className="flex rounded-md border border-line-2 overflow-x-auto max-w-full sm:ml-auto [&>button]:shrink-0">
          {(['todos', 'sin_categoria', 'salidas', 'entradas', 'traspasos'] as Filter[]).map(f => (
            <button
              key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-[13px] ${filter === f ? 'bg-ink text-white' : 'bg-sheet text-ink-2 hover:bg-paper'}`}
            >
              {{ todos: 'Todos', sin_categoria: 'Sin categoría', salidas: 'Salidas', entradas: 'Entradas', traspasos: 'Traspasos' }[f]}
            </button>
          ))}
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="py-20 text-center text-ink-3"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty
          title={`Sin movimientos en ${monthLabel(month).toLowerCase()}`}
          body="Cambia de mes arriba o sube archivos de este período."
          action={canEdit && <Link to="/importar" className="btn btn-primary">Subir archivos</Link>}
        />
      ) : (
        <>
        <ul className="lg:hidden card divide-y divide-line/70">
          {visible.map(t => {
            const acc = accounts.find(a => a.id === t.account_id)
            const cat = categories.find(c => c.id === t.category_id)?.name
            return (
              <li key={t.id}>
                <button className={`w-full text-left px-4 py-3 flex items-start justify-between gap-3 ${t.is_transfer ? 'opacity-60' : ''}`} onClick={() => canEdit && setRuleFor(t)}>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.counterparty ?? t.description}</div>
                    {t.counterparty && <div className="text-ink-3 text-[12px] truncate">{t.description}</div>}
                    <div className="text-[12.5px] mt-0.5 truncate">
                      <span className="text-ink-3">{dateDay(t.posted_at)} · {acc?.bank ?? ''} · </span>
                      {t.is_transfer ? <span className="text-ink-3">Traspaso propio</span> : cat ? <span className="text-ink-2">{cat}</span> : <span className="text-[#8a5c00]">Sin explicar: toca para decir qué es</span>}
                    </div>
                  </div>
                  <div className={`num shrink-0 font-medium ${t.amount > 0 && !t.is_transfer ? 'text-income' : ''}`}>{money(t.amount, { sign: true })}</div>
                </button>
              </li>
            )
          })}
          <li className="px-4 py-3 bg-paper flex justify-between text-[13px]">
            <span className="text-ink-2">Total visible</span>
            <span className="num font-medium"><span className="text-income">{money(totals.in, { sign: true })}</span> <span className="text-ink-3">/</span> {money(totals.out, { sign: true })}</span>
          </li>
        </ul>
        <div className="hidden lg:block card overflow-x-auto">
          <table className="data table-fixed">
            <colgroup>
              <col className="w-[60px]" /><col /><col className="w-[150px]" /><col className="w-[128px]" /><col className="w-[190px]" /><col className="w-[124px]" /><col className="w-[112px]" /><col className="w-[136px]" />
            </colgroup>
            <thead>
              <tr>
                <th>Fecha</th><th>Descripción</th><th>Entidad</th><th>Cuenta</th><th>Categoría</th><th>Deuda</th><th className="text-right">Monto</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(t => {
                const acc = accounts.find(a => a.id === t.account_id)
                return (
                  <tr key={t.id} className={t.is_transfer ? 'opacity-60' : ''}>
                    <td className="text-ink-2 whitespace-nowrap">{dateDay(t.posted_at)}</td>
                    <td>
                      <div className="truncate" title={t.description}>{t.description}</div>
                      <div className="flex gap-2 text-[11.5px] truncate">
                        {t.counterparty && <span className="text-ink-2 truncate" title={t.notes ?? ''}>{t.counterparty}{t.notes ? ` · ${t.notes}` : ''}</span>}
                        {t.recurring_id && <span className="text-accent shrink-0">Recurrente</span>}
                      </div>
                    </td>
                    <td>
                      {canEdit ? (
                        <select className="input py-1 text-[13px] w-full" value={t.entity_id} onChange={e => patch(t, { entity_id: e.target.value })}>
                          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                      ) : entities.find(e => e.id === t.entity_id)?.name}
                    </td>
                    <td className="text-ink-2 truncate" title={acc ? `${acc.bank} ${acc.name}` : ''}>{acc ? <>{acc.bank}{acc.last4 && <span className="text-ink-3 text-[12px]"> ·{acc.last4}</span>}</> : '—'}</td>
                    <td>
                      {t.is_transfer ? (
                        <Chip>Traspaso propio</Chip>
                      ) : canEdit ? (
                        <select
                          className={`input py-1 text-[13px] w-full ${!t.category_id ? 'border-warn' : ''}`}
                          value={t.category_id ?? ''}
                          onChange={e => patch(t, { category_id: e.target.value || null })}
                        >
                          <option value="">Sin categoría</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : categories.find(c => c.id === t.category_id)?.name ?? '—'}
                    </td>
                    <td>
                      {canEdit && t.amount < 0 && !t.is_transfer ? (
                        <select className="input py-1 text-[13px] w-full" value={t.debt_id ?? ''} onChange={e => patch(t, { debt_id: e.target.value || null })}>
                          <option value="">—</option>
                          {debts.map(d => <option key={d.id} value={d.id}>{d.creditor}</option>)}
                        </select>
                      ) : debts.find(d => d.id === t.debt_id)?.creditor ?? ''}
                    </td>
                    <td className={`num text-right whitespace-nowrap font-medium ${t.amount > 0 && !t.is_transfer ? 'text-income' : ''}`}>{money(t.amount, { sign: true })}</td>
                    <td className="whitespace-nowrap">
                      {canEdit && (
                        <div className="flex gap-0.5 justify-end -mr-2">
                          <button className="btn btn-ghost btn-sm" title={t.is_transfer ? 'Quitar marca de traspaso' : 'Marcar como traspaso entre cuentas propias'} onClick={() => patch(t, { is_transfer: !t.is_transfer })}>
                            {t.is_transfer ? 'No es traspaso' : 'Traspaso'}
                          </button>
                          <button className="btn btn-ghost btn-sm" title="Explicar qué es este gasto y recordarlo" onClick={() => setRuleFor(t)}>Explicar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-paper">
                <td colSpan={6} className="text-ink-2 text-[13px]">Total visible</td>
                <td className="num text-right font-medium whitespace-nowrap">
                  <span className="text-income">{money(totals.in, { sign: true })}</span>
                  <span className="text-ink-3 mx-1">/</span>
                  {money(totals.out, { sign: true })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      {ruleFor && (
        <RuleModal tx={ruleFor} onClose={() => setRuleFor(null)} onSaved={() => { setRuleFor(null); load(); refreshOrg() }} />
      )}
    </div>
  )
}

function RuleModal({ tx, onClose, onSaved }: { tx: Transaction; onClose: () => void; onSaved: () => void }) {
  const { org, entities, categories } = useApp()
  const [counterparty, setCounterparty] = useState(tx.counterparty ?? '')
  const [notes, setNotes] = useState(tx.notes ?? '')
  const [categoryId, setCategoryId] = useState(tx.category_id ?? '')
  const [entityId, setEntityId] = useState(tx.entity_id)
  const [isTransfer, setIsTransfer] = useState(tx.is_transfer)
  const [remember, setRemember] = useState(true)
  const [pattern, setPattern] = useState(tx.description_norm)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!org) return
    setBusy(true); setErr(null)
    const { error } = await supabase.from('transactions').update({
      counterparty: counterparty || null, notes: notes || null, category_id: categoryId || null,
      entity_id: entityId, is_transfer: isTransfer, reviewed: true,
    }).eq('id', tx.id)
    if (error) { setErr(error.message); setBusy(false); return }
    if (remember && pattern.trim()) {
      const { error: e1 } = await supabase.from('rules').insert({
        org_id: org.id, pattern: pattern.trim().toLowerCase(),
        category_id: categoryId || null, entity_id: entityId !== tx.entity_id ? entityId : null,
        counterparty: counterparty || null, mark_transfer: isTransfer,
      })
      if (e1) { setErr(e1.message); setBusy(false); return }
      const { error: e2 } = await supabase.rpc('reapply_rules', { p_org: org.id })
      if (e2) { setErr(e2.message); setBusy(false); return }
    }
    setBusy(false); onSaved()
  }

  return (
    <Modal open onClose={onClose} title="¿Qué es este movimiento?">
      <div className="rounded-md bg-paper px-3 py-2 mb-4 text-[13px]">
        <div className="font-medium truncate">{tx.description}</div>
        <div className="text-ink-2 num">{dateDay(tx.posted_at)} · {money(tx.amount, { sign: true })}</div>
      </div>
      <div className="flex flex-col gap-3">
        <Field label="Qué es (nombre claro)" hint="Ej: Luz del local, Seguro de la camioneta, Plan de celulares del equipo.">
          <input className="input" value={counterparty} onChange={e => setCounterparty(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="De quién es el gasto">
            <select className="input" value={entityId} onChange={e => setEntityId(e.target.value)}>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Nota (opcional)" hint="Contexto que ayude después: contrato, vencimiento, con quién se negocia, si se puede cortar.">
          <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={isTransfer} onChange={e => setIsTransfer(e.target.checked)} />
          Es un traspaso entre cuentas propias (no es ingreso ni gasto)
        </label>
        <div className="border-t border-line pt-3">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            Recordarlo para todos los cobros parecidos
          </label>
          {remember && (
            <div className="mt-2">
              <Field label="Cuando la descripción contenga" hint="Deja solo la parte que se repite cada mes, sin números ni fechas.">
                <input className="input" value={pattern} onChange={e => setPattern(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  )
}
