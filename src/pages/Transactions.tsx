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
            <Link to="/importar" className="btn btn-primary">Importar cartola</Link>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-8 w-[260px] py-1.5" placeholder="Buscar en descripción" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-[320px] py-1.5" value={accountId} onChange={e => setAccountId(e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {visibleAccounts.map(a => <option key={a.id} value={a.id}>{entities.find(e => e.id === a.entity_id)?.name} · {a.bank} {a.last4 ? `····${a.last4}` : ''}</option>)}
        </select>
        <div className="flex rounded-md border border-line-2 overflow-hidden ml-auto">
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
          body="Cambia de mes arriba a la derecha o importa una cartola para este período."
          action={canEdit && <Link to="/importar" className="btn btn-primary">Importar cartola</Link>}
        />
      ) : (
        <div className="card overflow-x-auto">
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
                      {t.recurring_id && <span className="text-accent text-[11.5px]">Recurrente</span>}
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
                          <button className="btn btn-ghost btn-sm" title="Crear regla para movimientos parecidos" onClick={() => setRuleFor(t)}>Regla</button>
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
      )}

      {ruleFor && (
        <RuleModal tx={ruleFor} onClose={() => setRuleFor(null)} onSaved={() => { setRuleFor(null); load(); refreshOrg() }} />
      )}
    </div>
  )
}

function RuleModal({ tx, onClose, onSaved }: { tx: Transaction; onClose: () => void; onSaved: () => void }) {
  const { org, entities, categories } = useApp()
  const [pattern, setPattern] = useState(tx.description_norm)
  const [categoryId, setCategoryId] = useState(tx.category_id ?? '')
  const [entityId, setEntityId] = useState('')
  const [counterparty, setCounterparty] = useState(tx.counterparty ?? '')
  const [markTransfer, setMarkTransfer] = useState(false)
  const [applyExisting, setApplyExisting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!org) return
    setBusy(true); setErr(null)
    const { error } = await supabase.from('rules').insert({
      org_id: org.id, pattern: pattern.trim().toLowerCase(),
      category_id: categoryId || null, entity_id: entityId || null,
      counterparty: counterparty || null, mark_transfer: markTransfer,
    })
    if (error) { setErr(error.message); setBusy(false); return }
    if (applyExisting) {
      const { error: e2 } = await supabase.rpc('reapply_rules', { p_org: org.id })
      if (e2) { setErr(e2.message); setBusy(false); return }
    }
    setBusy(false); onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Nueva regla de clasificación">
      <p className="text-ink-2 mb-4">
        Cada movimiento futuro (y los existentes, si marcas la opción) cuya descripción contenga el texto se clasificará solo.
      </p>
      <div className="flex flex-col gap-3">
        <Field label="Si la descripción contiene" hint="Acorta el texto a la parte que se repite, sin números de folio ni fechas.">
          <input className="input" value={pattern} onChange={e => setPattern(e.target.value)} />
        </Field>
        <Field label="Categoría">
          <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">No cambiar</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Asignar a entidad" hint="Útil cuando un gasto de la empresa se paga desde una cuenta personal.">
          <select className="input" value={entityId} onChange={e => setEntityId(e.target.value)}>
            <option value="">No cambiar</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Nombre de la contraparte (opcional)">
          <input className="input" value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder="Ej: Enel, Movistar, Banco Santander" />
        </Field>
        <label className="flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={markTransfer} onChange={e => setMarkTransfer(e.target.checked)} />
          Es un traspaso entre cuentas propias (no cuenta como ingreso ni gasto)
        </label>
        <label className="flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={applyExisting} onChange={e => setApplyExisting(e.target.checked)} />
          Aplicar también a los movimientos ya importados
        </label>
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !pattern.trim()}>{busy ? 'Guardando…' : 'Guardar regla'}</button>
        </div>
      </div>
    </Modal>
  )
}
