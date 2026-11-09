import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { money, seriesColor } from '../lib/format'
import { ACCOUNT_KIND_LABEL, type Account, type AccountKind, type Category, type Entity, type Rule } from '../lib/types'
import { Chip, Field, Modal, PageHeader } from '../components/ui'

type Tab = 'entidades' | 'cuentas' | 'reglas' | 'categorias' | 'acceso' | 'meta'

export default function Settings() {
  const { org, canEdit, role } = useApp()
  const [tab, setTab] = useState<Tab>('cuentas')
  if (!org) return null
  if (!canEdit) return <PageHeader title="Configuración" subtitle={`Tu acceso es de solo lectura (${role}). Pide a quien administra la organización los cambios que necesites.`} />

  const tabs: { id: Tab; label: string }[] = [
    { id: 'cuentas', label: 'Cuentas' },
    { id: 'entidades', label: 'Personas y empresas' },
    { id: 'reglas', label: 'Reglas' },
    { id: 'categorias', label: 'Categorías' },
    { id: 'meta', label: 'Meta de recorte' },
    { id: 'acceso', label: 'Acceso' },
  ]

  return (
    <div>
      <PageHeader title="Configuración" subtitle={org.name} />
      <div className="flex gap-1 border-b border-line mb-5">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2 text-[13.5px] -mb-px border-b-2 ${tab === t.id ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'entidades' && <EntitiesTab />}
      {tab === 'cuentas' && <AccountsTab />}
      {tab === 'reglas' && <RulesTab />}
      {tab === 'categorias' && <CategoriesTab />}
      {tab === 'meta' && <GoalTab />}
      {tab === 'acceso' && <AccessTab />}
    </div>
  )
}

/* ---------------- Entidades ---------------- */
function EntitiesTab() {
  const { org, entities, refreshOrg } = useApp()
  const [editing, setEditing] = useState<Entity | 'new' | null>(null)
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-ink-2 max-w-[60ch]">La persona y cada una de sus empresas. Cada cuenta y cada movimiento pertenece a una de ellas.</p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Agregar</button>
      </div>
      <div className="card overflow-hidden">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>RUT</th><th></th></tr></thead>
          <tbody>
            {entities.map(e => (
              <tr key={e.id}>
                <td className="font-medium"><span className="inline-block size-2.5 mr-2 align-middle" style={{ background: seriesColor(e.color_slot), borderRadius: e.kind === 'persona' ? 999 : 2 }} />{e.name}</td>
                <td className="text-ink-2">{e.kind === 'persona' ? 'Persona' : 'Empresa'}</td>
                <td className="text-ink-2 num">{e.rut ?? '—'}</td>
                <td className="text-right"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && org && (
        <SimpleForm
          title={editing === 'new' ? 'Nueva persona o empresa' : 'Editar'}
          initial={editing === 'new' ? { name: '', kind: 'empresa', rut: '', color_slot: String(entities.length + 1) } : { name: editing.name, kind: editing.kind, rut: editing.rut ?? '', color_slot: String(editing.color_slot) }}
          fields={[
            { key: 'name', label: 'Nombre' },
            { key: 'kind', label: 'Tipo', options: [['persona', 'Persona'], ['empresa', 'Empresa']] },
            { key: 'rut', label: 'RUT (opcional)' },
            { key: 'color_slot', label: 'Color (1–8)', type: 'number' },
          ]}
          onClose={() => setEditing(null)}
          onDelete={editing !== 'new' ? async () => { await supabase.from('entities').delete().eq('id', editing.id) } : undefined}
          onSave={async v => {
            const payload = { org_id: org.id, name: v.name.trim(), kind: v.kind, rut: v.rut || null, color_slot: Number(v.color_slot) || 1 }
            const q = editing === 'new' ? supabase.from('entities').insert(payload) : supabase.from('entities').update(payload).eq('id', editing.id)
            const { error } = await q
            if (error) throw error
          }}
          onSaved={() => { setEditing(null); refreshOrg() }}
        />
      )}
    </div>
  )
}

/* ---------------- Cuentas ---------------- */
function AccountsTab() {
  const { org, entities, accounts, refreshOrg } = useApp()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-ink-2 max-w-[60ch]">Cuentas corrientes, tarjetas, créditos, líneas e inversiones. Cada cartola se importa a una cuenta.</p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Agregar cuenta</button>
      </div>
      {entities.map(en => {
        const list = accounts.filter(a => a.entity_id === en.id)
        return (
          <div key={en.id} className="card overflow-hidden mb-3">
            <div className="px-4 py-2.5 border-b border-line flex items-center gap-2 bg-paper">
              <span className="inline-block size-2.5" style={{ background: seriesColor(en.color_slot), borderRadius: en.kind === 'persona' ? 999 : 2 }} />
              <span className="font-medium">{en.name}</span>
              <span className="text-ink-3 text-[12.5px]">· {list.length} {list.length === 1 ? 'cuenta' : 'cuentas'}</span>
            </div>
            {list.length === 0 ? <div className="px-4 py-3 text-ink-3">Sin cuentas todavía.</div> : (
              <table className="data">
                <tbody>
                  {list.map(a => (
                    <tr key={a.id} className={!a.is_active ? 'opacity-50' : ''}>
                      <td className="font-medium w-[220px]">{a.bank}</td>
                      <td>{a.name}{a.last4 ? <span className="text-ink-3 num"> ····{a.last4}</span> : ''}</td>
                      <td className="text-ink-2">{ACCOUNT_KIND_LABEL[a.kind]}</td>
                      <td className="text-ink-2">{a.import_mapping ? <Chip tone="good">Formato guardado</Chip> : <span className="text-ink-3 text-[12.5px]">Sin cartolas aún</span>}</td>
                      <td className="text-right"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
      {editing && org && (
        <SimpleForm
          title={editing === 'new' ? 'Nueva cuenta' : 'Editar cuenta'}
          initial={editing === 'new'
            ? { entity_id: entities[0]?.id ?? '', bank: 'Santander', name: 'Cuenta corriente', kind: 'corriente', last4: '', credit_limit: '', is_active: 'true', notes: '' }
            : { entity_id: editing.entity_id, bank: editing.bank, name: editing.name, kind: editing.kind, last4: editing.last4 ?? '', credit_limit: editing.credit_limit?.toString() ?? '', is_active: String(editing.is_active), notes: editing.notes ?? '' }}
          fields={[
            { key: 'entity_id', label: 'Pertenece a', options: entities.map(e => [e.id, e.name]) },
            { key: 'bank', label: 'Banco o institución', options: [['Santander', 'Santander'], ['Banco de Chile', 'Banco de Chile'], ['BCI', 'BCI'], ['Itaú', 'Itaú'], ['Scotiabank', 'Scotiabank'], ['BancoEstado', 'BancoEstado'], ['Falabella', 'Banco Falabella'], ['Security', 'Security'], ['Mercado Pago', 'Mercado Pago'], ['Tenpo', 'Tenpo'], ['Otro', 'Otro']], allowCustom: true },
            { key: 'name', label: 'Nombre de la cuenta' },
            { key: 'kind', label: 'Tipo', options: (Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map(k => [k, ACCOUNT_KIND_LABEL[k]]) },
            { key: 'last4', label: 'Últimos 4 dígitos (opcional)' },
            { key: 'credit_limit', label: 'Cupo (si es tarjeta o línea)', type: 'number' },
            { key: 'is_active', label: 'Estado', options: [['true', 'Activa'], ['false', 'Cerrada / inactiva']] },
            { key: 'notes', label: 'Notas' },
          ]}
          onClose={() => setEditing(null)}
          onDelete={editing !== 'new' ? async () => { await supabase.from('accounts').delete().eq('id', editing.id) } : undefined}
          deleteWarning="Se eliminarán también todos los movimientos importados de esta cuenta."
          onSave={async v => {
            const payload = { org_id: org.id, entity_id: v.entity_id, bank: v.bank.trim(), name: v.name.trim(), kind: v.kind, last4: v.last4 || null, credit_limit: v.credit_limit ? Number(v.credit_limit) : null, is_active: v.is_active === 'true', notes: v.notes || null }
            const q = editing === 'new' ? supabase.from('accounts').insert(payload) : supabase.from('accounts').update(payload).eq('id', editing.id)
            const { error } = await q
            if (error) throw error
          }}
          onSaved={() => { setEditing(null); refreshOrg() }}
        />
      )}
    </div>
  )
}

/* ---------------- Reglas ---------------- */
function RulesTab() {
  const { org, entities, categories } = useApp()
  const [rules, setRules] = useState<Rule[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!org) return
    const { data } = await supabase.from('rules').select('*').eq('org_id', org.id).order('priority').order('created_at')
    setRules((data as Rule[]) ?? [])
  }, [org])
  useEffect(() => { load() }, [load])

  async function toggle(r: Rule) {
    await supabase.from('rules').update({ is_active: !r.is_active }).eq('id', r.id); load()
  }
  async function remove(r: Rule) {
    if (!confirm('¿Eliminar esta regla? Los movimientos ya clasificados no cambian.')) return
    await supabase.from('rules').delete().eq('id', r.id); load()
  }
  async function reapply() {
    if (!org) return
    setBusy(true)
    const { data, error } = await supabase.rpc('reapply_rules', { p_org: org.id })
    setBusy(false)
    if (error) return alert(error.message)
    alert(`Reglas aplicadas sobre ${data} movimientos.`)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-ink-2 max-w-[60ch]">Las reglas se crean desde Movimientos (botón “Regla”). Se aplican solas a cada cartola nueva.</p>
        <button className="btn btn-outline" onClick={reapply} disabled={busy || rules.length === 0}>Volver a aplicar todas</button>
      </div>
      <div className="card overflow-hidden">
        {rules.length === 0 ? <div className="p-6 text-ink-3">Sin reglas todavía.</div> : (
          <table className="data">
            <thead><tr><th>Si contiene</th><th>Categoría</th><th>Entidad</th><th>Contraparte</th><th>Traspaso</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className={!r.is_active ? 'opacity-50' : ''}>
                  <td className="font-medium">“{r.pattern}”</td>
                  <td className="text-ink-2">{categories.find(c => c.id === r.category_id)?.name ?? '—'}</td>
                  <td className="text-ink-2">{entities.find(e => e.id === r.entity_id)?.name ?? '—'}</td>
                  <td className="text-ink-2">{r.counterparty ?? '—'}</td>
                  <td>{r.mark_transfer ? <Chip>Sí</Chip> : ''}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => toggle(r)}>{r.is_active ? 'Activa' : 'Pausada'}</button></td>
                  <td className="text-right"><button className="btn btn-ghost btn-sm text-bad" onClick={() => remove(r)}>Eliminar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ---------------- Categorías ---------------- */
function CategoriesTab() {
  const { org, categories, refreshOrg } = useApp()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const kinds: Record<string, string> = { ingreso: 'Ingresos', gasto: 'Gastos', deuda: 'Deuda', impuesto: 'Impuestos', transferencia: 'Transferencias', inversion: 'Inversiones' }
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-ink-2 max-w-[60ch]">Las categorías marcadas como “costo fijo” suman al costo recurrente aunque no estén detectadas como suscripción.</p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={15} /> Agregar</button>
      </div>
      <div className="card overflow-hidden">
        <table className="data">
          <thead><tr><th>Categoría</th><th>Tipo</th><th>Costo fijo</th><th></th></tr></thead>
          <tbody>
            {categories.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="text-ink-2">{kinds[c.kind] ?? c.kind}</td>
                <td className="flex gap-1">{c.is_fixed ? <Chip tone="accent">Fijo</Chip> : ''}{c.exclude_from_recurring ? <Chip>No recurrente</Chip> : ''}</td>
                <td className="text-right">{c.org_id && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Editar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && org && (
        <SimpleForm
          title={editing === 'new' ? 'Nueva categoría' : 'Editar categoría'}
          initial={editing === 'new' ? { name: '', kind: 'gasto', is_fixed: 'false', exclude_from_recurring: 'false' } : { name: editing.name, kind: editing.kind, is_fixed: String(editing.is_fixed), exclude_from_recurring: String(editing.exclude_from_recurring) }}
          fields={[
            { key: 'name', label: 'Nombre' },
            { key: 'kind', label: 'Tipo', options: Object.entries(kinds) },
            { key: 'is_fixed', label: 'Es costo fijo', options: [['false', 'No'], ['true', 'Sí']] },
            { key: 'exclude_from_recurring', label: 'Ignorar al detectar recurrentes', options: [['false', 'No'], ['true', 'Sí (ej: inventario, impuestos)']] },
          ]}
          onClose={() => setEditing(null)}
          onDelete={editing !== 'new' ? async () => { await supabase.from('categories').delete().eq('id', editing.id) } : undefined}
          onSave={async v => {
            const payload = { org_id: org.id, name: v.name.trim(), kind: v.kind, is_fixed: v.is_fixed === 'true', exclude_from_recurring: v.exclude_from_recurring === 'true' }
            const q = editing === 'new' ? supabase.from('categories').insert(payload) : supabase.from('categories').update(payload).eq('id', editing.id)
            const { error } = await q
            if (error) throw error
          }}
          onSaved={() => { setEditing(null); refreshOrg() }}
        />
      )}
    </div>
  )
}

/* ---------------- Meta ---------------- */
function GoalTab() {
  const { org, refreshOrgs } = useApp()
  const [baseline, setBaseline] = useState(org?.baseline_fixed_cost?.toString() ?? '')
  const [month, setMonth] = useState(org?.baseline_month ?? '')
  const [target, setTarget] = useState(org?.target_reduction_pct?.toString() ?? '25')
  const [saved, setSaved] = useState(false)
  async function save() {
    if (!org) return
    const { error } = await supabase.from('organizations').update({
      baseline_fixed_cost: baseline ? Number(baseline) : null, baseline_month: month || null, target_reduction_pct: Number(target) || 25,
    }).eq('id', org.id)
    if (error) return alert(error.message)
    setSaved(true); refreshOrgs(); setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div className="card p-5 max-w-xl">
      <p className="text-ink-2 mb-4">Define el punto de partida para medir el recorte. Si no fijas un monto, el panel usa el costo fijo calculado del mes de referencia.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mes de referencia"><input className="input" type="month" value={month.slice(0, 7)} onChange={e => setMonth(e.target.value ? `${e.target.value}-01` : '')} /></Field>
        <Field label="Meta de reducción (%)"><input className="input num" type="number" value={target} onChange={e => setTarget(e.target.value)} /></Field>
        <div className="col-span-2">
          <Field label="Costo fijo mensual de partida (CLP)" hint="Lo que la empresa gastaba en fijos al empezar. Ejemplo: 50000000.">
            <input className="input num" type="number" value={baseline} onChange={e => setBaseline(e.target.value)} />
          </Field>
        </div>
      </div>
      {baseline && target && (
        <p className="text-ink-2 mt-3">Objetivo: llegar a <span className="font-medium text-ink num">{money(Number(baseline) * (1 - Number(target) / 100))}</span> al mes, es decir, recortar <span className="font-medium text-ink num">{money(Number(baseline) * Number(target) / 100)}</span>.</p>
      )}
      <div className="flex items-center gap-3 mt-4">
        <button className="btn btn-primary" onClick={save}>Guardar</button>
        {saved && <span className="text-income">Guardado</span>}
      </div>
    </div>
  )
}

/* ---------------- Acceso ---------------- */
function AccessTab() {
  const { org } = useApp()
  const [invites, setInvites] = useState<{ id: string; email: string; role: string }[]>([])
  const [members, setMembers] = useState<{ user_id: string; role: string }[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!org) return
    const [{ data: i }, { data: m }] = await Promise.all([
      supabase.from('org_invites').select('id, email, role').eq('org_id', org.id),
      supabase.from('memberships').select('user_id, role').eq('org_id', org.id),
    ])
    setInvites((i as typeof invites) ?? []); setMembers((m as typeof members) ?? [])
  }, [org])
  useEffect(() => { load() }, [load])

  async function invite() {
    if (!org) return
    setErr(null)
    const { error } = await supabase.from('org_invites').insert({ org_id: org.id, email: email.trim().toLowerCase(), role })
    if (error) return setErr(error.message)
    setEmail(''); load()
  }
  async function revoke(id: string) { await supabase.from('org_invites').delete().eq('id', id); load() }

  return (
    <div className="max-w-xl">
      <div className="card p-5 mb-4">
        <p className="text-ink-2 mb-3">Invita por correo. La persona entra con un enlace a su correo, sin contraseña. <span className="text-ink">Ver</span> solo mira; <span className="text-ink">Administrar</span> puede importar y editar.</p>
        <div className="flex gap-2">
          <input className="input" type="email" placeholder="correo@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="input w-auto" value={role} onChange={e => setRole(e.target.value)}>
            <option value="viewer">Ver</option><option value="admin">Administrar</option><option value="owner">Dueño</option>
          </select>
          <button className="btn btn-primary shrink-0" onClick={invite} disabled={!email.includes('@')}>Invitar</button>
        </div>
        {err && <p className="text-bad mt-2">{err}</p>}
      </div>
      <div className="card overflow-hidden">
        <table className="data">
          <thead><tr><th>Quién</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.user_id}><td className="text-ink-2 num text-[12.5px]">usuario {m.user_id.slice(0, 8)}…</td><td>{roleLabel(m.role)}</td><td><Chip tone="good">Activo</Chip></td><td></td></tr>
            ))}
            {invites.map(i => (
              <tr key={i.id}><td>{i.email}</td><td>{roleLabel(i.role)}</td><td><Chip tone="warn">Invitado, aún no entra</Chip></td><td className="text-right"><button className="btn btn-ghost btn-sm text-bad" onClick={() => revoke(i.id)}>Revocar</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
function roleLabel(r: string) { return r === 'owner' ? 'Dueño' : r === 'admin' ? 'Administrar' : 'Ver' }

/* ---------------- Formulario genérico ---------------- */
interface FieldDef { key: string; label: string; type?: string; options?: (string[] | [string, string])[]; allowCustom?: boolean }
function SimpleForm({ title, initial, fields, onClose, onSave, onSaved, onDelete, deleteWarning }: {
  title: string; initial: Record<string, string>; fields: FieldDef[]; onClose: () => void;
  onSave: (v: Record<string, string>) => Promise<void>; onSaved: () => void; onDelete?: () => Promise<void>; deleteWarning?: string
}) {
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    setBusy(true); setErr(null)
    try { await onSave(v); onSaved() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  async function del() {
    if (!onDelete || !confirm(`¿Eliminar? ${deleteWarning ?? ''}`)) return
    try { await onDelete(); onSaved() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        {fields.map(f => (
          <Field key={f.key} label={f.label}>
            {f.options && !(f.allowCustom && !f.options.some(o => o[0] === v[f.key])) ? (
              <select className="input" value={v[f.key]} onChange={e => setV({ ...v, [f.key]: e.target.value })}>
                {f.options.map(o => <option key={o[0]} value={o[0]}>{o[1] ?? o[0]}</option>)}
                {f.allowCustom && <option value="__custom">Otro (escribir)…</option>}
              </select>
            ) : (
              <input className={`input ${f.type === 'number' ? 'num' : ''}`} type={f.type ?? 'text'} value={v[f.key] === '__custom' ? '' : v[f.key]} onChange={e => setV({ ...v, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-between pt-2">
          <div>{onDelete && <button className="btn btn-ghost text-bad" onClick={del}>Eliminar</button>}</div>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
