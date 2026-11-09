import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../state/AppContext'
import { fetchDebts, fetchMonthlySummary, fetchRecurring, fetchTransactions, monthsBack } from '../lib/queries'
import { compact, dateDay, money, monthLabel, pct, seriesColor } from '../lib/format'
import type { Debt, MonthlySummary, Recurring, Transaction } from '../lib/types'
import { Empty, PageHeader, Stat } from '../components/ui'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export default function Dashboard() {
  const { org, entityId, entities, month, categories, accounts } = useApp()
  const [summary, setSummary] = useState<MonthlySummary[]>([])
  const [recurring, setRecurring] = useState<Recurring[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [recent, setRecent] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const months = useMemo(() => monthsBack(month, 6), [month])

  useEffect(() => {
    if (!org) return
    let alive = true
    setLoading(true)
    Promise.all([
      fetchMonthlySummary(org.id, months[0], months[months.length - 1]),
      fetchRecurring(org.id, entityId),
      fetchDebts(org.id, entityId),
      fetchTransactions(org.id, { month, entityId, limit: 12 }),
    ]).then(([s, r, d, t]) => {
      if (!alive) return
      setSummary(s); setRecurring(r); setDebts(d); setRecent(t); setLoading(false)
    }).catch(() => setLoading(false))
    return () => { alive = false }
  }, [org, entityId, month, months])

  const filtered = useMemo(() => entityId ? summary.filter(s => s.entity_id === entityId) : summary, [summary, entityId])

  const byMonth = useMemo(() => months.map(m => {
    const rows = filtered.filter(s => s.month === m)
    return {
      month: m,
      label: format(parseISO(m), 'MMM', { locale: es }),
      income: rows.reduce((a, r) => a + r.income, 0),
      expense: rows.reduce((a, r) => a + r.expense, 0),
      fixed: rows.reduce((a, r) => a + r.fixed_cost, 0),
      debt: rows.reduce((a, r) => a + r.debt_service, 0),
      count: rows.reduce((a, r) => a + r.tx_count, 0),
    }
  }), [filtered, months])

  const cur = byMonth[byMonth.length - 1]
  const prev = byMonth[byMonth.length - 2]
  const hasData = byMonth.some(m => m.count > 0)

  // Costo recurrente comprometido (suma de equivalentes mensuales de recurrentes no cancelados)
  const recurringActive = recurring.filter(r => r.status !== 'cancelado')
  const recurringMonthly = recurringActive.reduce((a, r) => a + (r.monthly_equivalent ?? 0), 0)
  const recurringToCut = recurring.filter(r => r.status === 'cancelar').reduce((a, r) => a + (r.monthly_equivalent ?? 0), 0)
  const recurringCut = recurring.filter(r => r.status === 'cancelado').reduce((a, r) => a + (r.monthly_equivalent ?? 0), 0)
  const toReview = recurring.filter(r => r.status === 'revisar').length

  const debtsActive = debts.filter(d => d.status !== 'pagada')
  const debtRemaining = debtsActive.reduce((a, d) => a + (d.remaining_est ?? 0), 0)
  const debtMonthly = debtsActive.reduce((a, d) => a + (d.monthly_payment ?? 0), 0)
  const debtInterest = debtsActive.reduce((a, d) => a + (d.monthly_interest_est ?? 0), 0)

  // Meta de recorte
  const baseline = org?.baseline_fixed_cost ?? (byMonth.find(m => m.month === org?.baseline_month)?.fixed || null)
  const target = org ? Number(org.target_reduction_pct) : 25
  const goalAmount = baseline ? baseline * (1 - target / 100) : null
  const achieved = baseline ? recurringCut : 0
  const progress = baseline && baseline > 0 ? Math.min(100, (achieved / (baseline * target / 100)) * 100) : 0

  if (!org) return null

  return (
    <div>
      <PageHeader
        title={entityId ? entities.find(e => e.id === entityId)?.name ?? 'Panel' : org.name}
        subtitle={`Resumen de ${monthLabel(month).toLowerCase()}`}
      />

      {/* Meta de recorte: el elemento protagonista */}
      <section className="card p-6 mb-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-ink-2">Costo recurrente mensual comprometido</div>
            <div className="num text-[32px] lg:text-[40px] leading-none font-semibold tracking-tight mt-2">{money(recurringMonthly)}</div>
            <div className="text-ink-3 mt-2">
              {recurringActive.length} cargos recurrentes identificados
              {toReview > 0 && <> · <Link to="/recurrentes" className="text-accent hover:underline">{toReview} por revisar</Link></>}
            </div>
          </div>
          <div className="min-w-[280px] flex-1 max-w-[520px]">
            <div className="flex justify-between text-[13px] mb-1.5">
              <span className="text-ink-2">Meta: bajar {pct(target)} desde {baseline ? money(baseline) : '— (fija el costo de partida en Configuración)'}</span>
              {goalAmount && <span className="num text-ink-2">objetivo {money(goalAmount)}</span>}
            </div>
            <div className="h-2.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-income rounded-full transition-[width]" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[13px] mt-1.5">
              <span className="text-income num">Ya eliminado: {money(achieved)}/mes</span>
              <span className="text-ink-2 num">Decidido cancelar: {money(recurringToCut)}/mes</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Entradas del mes" value={money(cur?.income)} tone="good" sub={prev && prev.count > 0 ? `${monthLabel(prev.month).split(' ')[0]}: ${compact(prev.income)}` : undefined} />
        <Stat label="Salidas del mes" value={money(cur?.expense)} sub={prev && prev.count > 0 ? `${monthLabel(prev.month).split(' ')[0]}: ${compact(prev.expense)}` : undefined} />
        <Stat label="Resultado del mes" value={money((cur?.income ?? 0) - (cur?.expense ?? 0), { sign: true })} tone={(cur?.income ?? 0) - (cur?.expense ?? 0) >= 0 ? 'good' : 'bad'} sub="sin contar traspasos entre cuentas propias" />
        <Stat label="Cuotas de deuda al mes" value={money(debtMonthly)} sub={debtInterest > 0 ? `≈ ${compact(debtInterest)} son intereses` : `${debtsActive.length} deudas activas`} />
      </div>

      {!hasData ? (
        <Empty
          title="Todavía no hay movimientos"
          body="Importa las cartolas de las cuentas para ver aquí entradas, salidas, costos recurrentes y deudas."
          action={<Link to="/importar" className="btn btn-primary">Importar cartolas</Link>}
        />
      ) : (
        <div className="grid lg:grid-cols-5 gap-5">
          <section className="card p-5 lg:col-span-3">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">Entradas y salidas, últimos 6 meses</h2>
              <div className="flex items-center gap-4 text-[12.5px] text-ink-2">
                <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: '#008300' }} />Entradas</span>
                <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm" style={{ background: '#16191c' }} />Salidas</span>
              </div>
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth} barGap={2} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="#e3e6e5" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#8a9097', fontSize: 12 }} />
                  <YAxis tickFormatter={v => compact(v)} tickLine={false} axisLine={false} width={64} tick={{ fill: '#8a9097', fontSize: 12 }} />
                  <Tooltip
                    cursor={{ fill: '#f6f7f6' }}
                    formatter={(v, n) => [money(Number(v)), n === 'income' ? 'Entradas' : 'Salidas']}
                    labelFormatter={(_, p) => p?.[0] ? monthLabel(p[0].payload.month) : ''}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e3e6e5', fontSize: 13 }}
                  />
                  <Bar dataKey="income" fill="#008300" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="#16191c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold">Deudas</h2>
              <Link to="/deudas" className="text-accent text-[13px] hover:underline">Ver todas</Link>
            </div>
            {debtsActive.length === 0 ? (
              <p className="text-ink-2">Sin deudas registradas. Agrégalas en la sección Deudas.</p>
            ) : (
              <>
                <div className="num text-[26px] font-semibold tracking-tight">{money(debtRemaining)}</div>
                <div className="text-ink-3 text-[12.5px] mb-4">saldo estimado por pagar</div>
                <ul className="flex flex-col gap-2">
                  {debtsActive.slice(0, 5).map(d => {
                    const total = (d.remaining_est ?? 0) + (d.paid_total ?? 0)
                    const p = total > 0 ? ((d.paid_total ?? 0) / total) * 100 : 0
                    return (
                      <li key={d.id}>
                        <div className="flex justify-between text-[13px]">
                          <span className="truncate pr-2">{d.creditor}</span>
                          <span className="num text-ink-2">{compact(d.remaining_est)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-line mt-1 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${p}%`, background: seriesColor(entities.find(e => e.id === d.entity_id)?.color_slot ?? 1) }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>

          <section className="card lg:col-span-5 overflow-x-auto">
            <div className="flex items-baseline justify-between px-5 pt-5 pb-3">
              <h2 className="font-semibold">Últimos movimientos</h2>
              <Link to="/movimientos" className="text-accent text-[13px] hover:underline">Ver todos</Link>
            </div>
            <table className="data">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Entidad</th><th>Cuenta</th><th>Categoría</th><th className="text-right">Monto</th></tr>
              </thead>
              <tbody>
                {recent.map(t => (
                  <tr key={t.id}>
                    <td className="text-ink-2 whitespace-nowrap">{dateDay(t.posted_at)}</td>
                    <td className="max-w-[360px] truncate" title={t.description}>{t.description}</td>
                    <td className="text-ink-2">{entities.find(e => e.id === t.entity_id)?.name ?? '—'}</td>
                    <td className="text-ink-2">{accounts.find(a => a.id === t.account_id)?.bank ?? '—'}</td>
                    <td className="text-ink-2">{t.is_transfer ? 'Traspaso propio' : categories.find(c => c.id === t.category_id)?.name ?? <span className="text-warn">Sin categoría</span>}</td>
                    <td className={`num text-right whitespace-nowrap ${t.amount > 0 ? 'text-income' : ''}`}>{money(t.amount, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {loading && <div className="sr-only">Cargando</div>}
    </div>
  )
}
