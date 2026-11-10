import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Building2, Check, ExternalLink, FileUp, Plus, UserRound } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { supabase } from '../lib/supabase'
import { saveDocument, listDocuments } from '../lib/documents'
import { ACTIVITIES, CMF, GENERIC_PRODUCTS, INCOME_CHANNELS, INSTITUTIONS, PRODUCT_LABEL, findInstitution, type Institution } from '../lib/institutions'
import type { Account, AccountKind, DocumentRow, Entity } from '../lib/types'
import { seriesColor } from '../lib/format'
import Wordmark from '../components/Wordmark'
import { Modal, Spinner } from '../components/ui'

const STEPS = ['Tú', 'Tus negocios', 'Tus cuentas', 'Tus deudas', 'Tus movimientos']

interface Draft { id?: string; name: string; kind: 'persona' | 'empresa'; rut: string; activity: string; income_channels: string[] }

export default function Welcome() {
  const { org, orgs, setOrgId, roleLabel, isTitular, entities, accounts, refreshOrg, refreshOrgs, session } = useApp()
  const nav = useNavigate()
  const [step, setStep] = useState(() => Math.min(org?.onboarding?.step ?? 0, STEPS.length - 1))
  const [name, setName] = useState(org?.onboarding?.owner_name ?? '')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(entities.length
      ? entities.map(e => ({ id: e.id, name: e.name, kind: e.kind, rut: e.rut ?? '', activity: e.activity ?? '', income_channels: e.income_channels ?? [] }))
      : [{ name: '', kind: 'persona', rut: '', activity: '', income_channels: [] }])
  }, [entities])

  if (!org) return null

  async function saveProgress(next: number, done = false) {
    await supabase.from('organizations').update({ onboarding: { ...(org!.onboarding ?? {}), owner_name: name.trim() || undefined, step: next, done: done || org!.onboarding?.done || false } }).eq('id', org!.id)
    await refreshOrgs()
  }

  async function saveEntities(): Promise<boolean> {
    const valid = drafts.filter(d => d.name.trim())
    if (valid.length === 0) { setErr('Agrega al menos tu nombre o el de un negocio.'); return false }
    for (const [i, d] of valid.entries()) {
      const payload = { org_id: org!.id, name: d.name.trim(), kind: d.kind, rut: d.rut.trim() || null, activity: d.activity.trim() || null, income_channels: d.income_channels }
      const q = d.id
        ? supabase.from('entities').update(payload).eq('id', d.id)
        : supabase.from('entities').insert({ ...payload, color_slot: (i % 8) + 1, sort_order: i })
      const { error } = await q
      if (error) { setErr(error.message); return false }
    }
    await refreshOrg()
    return true
  }

  async function go(next: number) {
    setErr(null); setBusy(true)
    try {
      if (step === 0 && next > 0 && drafts.length && !drafts[0].id && !drafts[0].name && name.trim()) {
        setDrafts(ds => ds.map((d, i) => i === 0 ? { ...d, name: `${name.trim()} (personal)` } : d))
      }
      if (step === 1 && next > step && !(await saveEntities())) return
      if (next >= STEPS.length) { await saveProgress(STEPS.length - 1, true); nav('/importar'); return }
      await saveProgress(next)
      setStep(next)
      window.scrollTo({ top: 0 })
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-paper flex flex-col">
      <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur border-b border-line">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Wordmark />
          <button className="text-ink-2 text-[13px] hover:text-ink" onClick={() => { sessionStorage.setItem('cc.skipWelcome', '1'); nav('/') }}>Seguir después</button>
        </div>
        {orgs.length > 1 && org && (
          <div className="max-w-2xl mx-auto px-4 pb-2 flex items-center gap-2 text-[13px]">
            <span className="text-ink-2 shrink-0">Configurando:</span>
            <select className="input py-1 text-[13px] min-w-0 flex-1" value={org.id} onChange={e => setOrgId(e.target.value)} aria-label="Organización">
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name} · {roleLabel(o.id)}</option>)}
            </select>
          </div>
        )}
        {!isTitular && (
          <div className="max-w-2xl mx-auto px-4 pb-2 text-[12.5px] text-[#8a5c00]">Esta organización es de un cliente. Lo que completes aquí lo verá como hecho.</div>
        )}
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
            {STEPS.map((s, i) => <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-line-2'}`} />)}
          </div>
          <div className="text-[12.5px] text-ink-2 mt-2">Paso {step + 1} de {STEPS.length} · {STEPS[step]}</div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 pt-7 pb-32">
        {step === 0 && (
          <section>
            <h1 className="text-[30px] leading-[1.15] font-semibold tracking-tight">Vamos a ordenar tus números.</h1>
            <p className="text-ink-2 text-[16px] mt-3 max-w-[52ch]">
              En unos minutos vas a ver, en un solo lugar, cuánto entra, cuánto sale, qué se cobra todos los meses y cuánto debes, tuyo y de cada uno de tus negocios.
            </p>
            <label className="block mt-8">
              <span className="block font-medium mb-1.5">¿Cómo te llamas?</span>
              <input className="input text-[16px] py-3" value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" autoFocus />
            </label>
            <div className="mt-8 grid gap-3">
              {[
                ['Nos cuentas quién eres y qué negocios tienes', 'Qué vende cada uno y cómo le pagan.'],
                ['Marcas dónde tienes cuentas, tarjetas y créditos', 'Con botones, banco por banco.'],
                ['Subes tus movimientos', 'Cartolas, PDF o capturas de pantalla desde el celular. Nosotros los leemos y ordenamos.'],
              ].map(([t, d], i) => (
                <div key={t} className="flex gap-3">
                  <span className="mt-0.5 size-6 shrink-0 rounded-full bg-ink text-white text-[12px] font-medium grid place-items-center">{i + 1}</span>
                  <div><div className="font-medium">{t}</div><div className="text-ink-2 text-[13.5px]">{d}</div></div>
                </div>
              ))}
            </div>
            <p className="text-ink-3 text-[12.5px] mt-8">Entraste como {session?.user.email}. Solo tú y quienes invites pueden ver esta información.</p>
          </section>
        )}

        {step === 1 && (
          <section>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Tú y tus negocios</h1>
            <p className="text-ink-2 mt-2 max-w-[56ch]">Agrega una ficha para ti y una por cada empresa. Así cada gasto queda en el lugar que le corresponde y no se mezcla lo personal con el negocio.</p>
            <div className="flex flex-col gap-3 mt-6">
              {drafts.map((d, i) => (
                <EntityCard key={d.id ?? `n${i}`} draft={d} index={i} onChange={c => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, ...c } : x))}
                  onRemove={!d.id ? () => setDrafts(ds => ds.filter((_, j) => j !== i)) : undefined} />
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-outline" onClick={() => setDrafts(ds => [...ds, { name: '', kind: 'empresa', rut: '', activity: '', income_channels: [] }])}><Plus size={15} /> Agregar empresa</button>
              <button className="btn btn-ghost" onClick={() => setDrafts(ds => [...ds, { name: '', kind: 'persona', rut: '', activity: '', income_channels: [] }])}><Plus size={15} /> Agregar persona</button>
            </div>
          </section>
        )}

        {step === 2 && <AccountsStep entities={entities} accounts={accounts} />}
        {step === 3 && <CmfStep entities={entities} />}
        {step === 4 && <MovementsStep entities={entities} accounts={accounts} />}

        {err && <p className="text-bad mt-4">{err}</p>}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-sheet border-t border-line">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button className="btn btn-ghost" onClick={() => go(step - 1)} disabled={step === 0 || busy}><ArrowLeft size={16} /> Atrás</button>
          <button className="btn btn-primary px-6 py-2.5 text-[15px]" onClick={() => go(step + 1)} disabled={busy}>
            {busy ? <Spinner /> : step === STEPS.length - 1 ? <>Subir mis archivos <FileUp size={16} /></> : <>Continuar <ArrowRight size={16} /></>}
          </button>
        </div>
      </footer>
    </div>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${on ? 'border-ink bg-ink text-white' : 'border-line-2 bg-sheet text-ink-2 hover:border-ink-3'}`}>
      {on && <Check size={13} />}{children}
    </button>
  )
}

function EntityCard({ draft, index, onChange, onRemove }: { draft: Draft; index: number; onChange: (c: Partial<Draft>) => void; onRemove?: () => void }) {
  const isPerson = draft.kind === 'persona'
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <span className="size-9 shrink-0 grid place-items-center text-white" style={{ background: seriesColor(index + 1), borderRadius: isPerson ? 999 : 8 }}>
          {isPerson ? <UserRound size={17} /> : <Building2 size={17} />}
        </span>
        <input className="input font-medium" value={draft.name} onChange={e => onChange({ name: e.target.value })} placeholder={isPerson ? 'Tu nombre' : 'Nombre de la empresa'} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="block text-ink-2 text-[13px] mb-1">RUT (opcional)</span>
          <input className="input num" value={draft.rut} onChange={e => onChange({ rut: e.target.value })} placeholder={isPerson ? '12.345.678-9' : '76.123.456-7'} />
        </label>
        <label className="block">
          <span className="block text-ink-2 text-[13px] mb-1">{isPerson ? '¿A qué te dedicas?' : '¿Qué vende o qué hace?'}</span>
          <input className="input" list="actividades" value={draft.activity} onChange={e => onChange({ activity: e.target.value })} placeholder={isPerson ? 'Ej: dueño de mis empresas' : 'Ej: compra y venta de autos'} />
          <datalist id="actividades">{ACTIVITIES.map(a => <option key={a} value={a} />)}</datalist>
        </label>
      </div>
      <div className="mt-3">
        <div className="text-ink-2 text-[13px] mb-1.5">¿Cómo le llega la plata?</div>
        <div className="flex flex-wrap gap-1.5">
          {INCOME_CHANNELS.filter(c => isPerson ? !['tarjetas', 'financieras', 'plataformas'].includes(c.id) : c.id !== 'sueldo').map(c => {
            const on = draft.income_channels.includes(c.id)
            return <Toggle key={c.id} on={on} onClick={() => onChange({ income_channels: on ? draft.income_channels.filter(x => x !== c.id) : [...draft.income_channels, c.id] })}>{c.label}</Toggle>
          })}
        </div>
      </div>
      {onRemove && <button className="text-[13px] text-ink-3 hover:text-bad mt-3" onClick={onRemove}>Quitar</button>}
    </div>
  )
}

function EntityTabs({ entities, value, onChange }: { entities: Entity[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
      {entities.map(e => (
        <button key={e.id} onClick={() => onChange(e.id)}
          className={`shrink-0 flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] ${value === e.id ? 'border-ink bg-sheet font-medium' : 'border-transparent bg-line/50 text-ink-2'}`}>
          <span className="size-2.5" style={{ background: seriesColor(e.color_slot), borderRadius: e.kind === 'persona' ? 999 : 2 }} />
          {e.name}
        </button>
      ))}
    </div>
  )
}

function AccountsStep({ entities, accounts }: { entities: Entity[]; accounts: Account[] }) {
  const { org, refreshOrg } = useApp()
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '')
  const [open, setOpen] = useState<Institution | null>(null)
  const [other, setOther] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const mine = useMemo(() => accounts.filter(a => a.entity_id === entityId && a.is_active), [accounts, entityId])
  const customBanks = useMemo(() => [...new Set(mine.map(a => a.bank))].filter(b => !INSTITUTIONS.some(i => i.name === b)), [mine])
  const tiles: Institution[] = [
    ...INSTITUTIONS,
    ...customBanks.map(b => ({ id: `x-${b}`, name: b, mark: b.slice(0, 2), url: '', group: 'banco' as const, products: GENERIC_PRODUCTS })),
  ]

  async function toggle(inst: Institution, kind: AccountKind) {
    if (!org) return
    setMsg(null)
    const all = accounts.filter(a => a.entity_id === entityId && a.bank === inst.name && a.kind === kind)
    const active = all.filter(a => a.is_active)
    if (active.length) {
      for (const a of active) {
        const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', a.id)
        if ((count ?? 0) > 0) { setMsg(`${PRODUCT_LABEL[kind]} en ${inst.name} ya tiene movimientos cargados, así que se mantiene.`); return }
      }
      await supabase.from('accounts').update({ is_active: false }).in('id', active.map(a => a.id))
    } else if (all.length) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', all[0].id)
    } else {
      await supabase.from('accounts').insert({ org_id: org.id, entity_id: entityId, bank: inst.name, kind, name: PRODUCT_LABEL[kind] })
    }
    await refreshOrg()
  }

  async function addOther() {
    if (!org || !other.trim()) return
    const nameTxt = other.trim()
    // si ya está en la lista, se abre esa en vez de pedirla de nuevo
    const known = findInstitution(nameTxt)
    if (known) { setOther(''); setOpen(known); return }
    await supabase.from('source_requests').insert({ org_id: org.id, name: nameTxt, detail: `Pedida en la configuración inicial para ${entities.find(e => e.id === entityId)?.name ?? ''}` })
    setOther('')
    setOpen({ id: `x-${nameTxt}`, name: nameTxt, mark: nameTxt.slice(0, 2), url: '', group: 'banco', products: GENERIC_PRODUCTS })
  }

  return (
    <section>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">¿Dónde tienes cuentas, tarjetas y créditos?</h1>
      <p className="text-ink-2 mt-2 max-w-[56ch]">Elige a quién pertenecen y toca cada institución para marcar lo que tienes ahí. No necesitas números de cuenta ni claves.</p>
      <div className="mt-5"><EntityTabs entities={entities} value={entityId} onChange={setEntityId} /></div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4">
        {tiles.map(inst => {
          const n = mine.filter(a => a.bank === inst.name).length
          return (
            <button key={inst.id} onClick={() => setOpen(inst)}
              className={`relative text-left rounded-xl border p-3.5 transition-colors ${n ? 'border-ink bg-sheet' : 'border-line bg-sheet hover:border-line-2'}`}>
              <span className={`size-9 rounded-lg grid place-items-center text-[12.5px] font-semibold ${n ? 'bg-ink text-white' : 'bg-paper text-ink-2'}`}>{inst.mark}</span>
              <div className="font-medium mt-2.5 leading-tight">{inst.name}</div>
              <div className="text-[12.5px] mt-0.5 text-ink-3">{n ? `${n} ${n === 1 ? 'producto' : 'productos'}` : 'Tocar para marcar'}</div>
              {n > 0 && <span className="absolute top-3 right-3 size-5 rounded-full bg-income text-white grid place-items-center"><Check size={12} /></span>}
            </button>
          )
        })}
      </div>

      <div className="card p-4 mt-4">
        <div className="font-medium">¿Falta alguna?</div>
        <p className="text-ink-2 text-[13px] mt-0.5">Financieras, cooperativas, casas comerciales, corredoras, billeteras de cripto: escríbela y la sumamos.</p>
        <div className="flex gap-2 mt-2.5">
          <input className="input" value={other} onChange={e => setOther(e.target.value)} placeholder="Nombre de la institución" onKeyDown={e => e.key === 'Enter' && addOther()} />
          <button className="btn btn-outline shrink-0" onClick={addOther} disabled={!other.trim()}>Agregar</button>
        </div>
      </div>

      {open && (
        <Modal open onClose={() => { setOpen(null); setMsg(null) }} title={`${open.name} · ${entities.find(e => e.id === entityId)?.name ?? ''}`}>
          <p className="text-ink-2 mb-3">Marca todo lo que tienes en {open.name}.</p>
          <div className="grid grid-cols-2 gap-2">
            {open.products.map(kind => {
              const n = mine.filter(a => a.bank === open.name && a.kind === kind).length
              return (
                <button key={kind} onClick={() => toggle(open, kind)} aria-pressed={n > 0}
                  className={`rounded-lg border px-3 py-3 text-left text-[13.5px] flex items-center justify-between gap-2 ${n ? 'border-ink bg-ink text-white' : 'border-line-2 hover:border-ink-3'}`}>
                  <span>{PRODUCT_LABEL[kind]}{n > 1 ? ` (${n})` : ''}</span>
                  {n > 0 && <Check size={15} />}
                </button>
              )
            })}
          </div>
          {msg && <p className="text-[13px] text-[#8a5c00] bg-warn-soft rounded-md px-3 py-2 mt-3">{msg}</p>}
          <p className="text-ink-3 text-[12.5px] mt-3">Si tienes más de una tarjeta o crédito del mismo tipo, se separan solas cuando subas sus estados de cuenta.</p>
          <div className="flex justify-end mt-4"><button className="btn btn-primary" onClick={() => { setOpen(null); setMsg(null) }}>Listo</button></div>
        </Modal>
      )}
    </section>
  )
}

function CmfStep({ entities }: { entities: Entity[] }) {
  const { org } = useApp()
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => { if (org) listDocuments(org.id, 50).then(setDocs) }, [org])

  async function upload(entity: Entity, file: File) {
    if (!org) return
    setBusyId(entity.id)
    let text = ''
    try {
      const { readAnyFile } = await import('../lib/readers')
      text = (await readAnyFile(file, { askPassword: () => window.prompt('Este PDF tiene clave. Escríbela aquí:') })).text
    } catch { /* se guarda igual */ }
    await saveDocument({ orgId: org.id, file, kind: 'cmf', status: 'recibido', entityId: entity.id, text })
    setDocs(await listDocuments(org.id, 50))
    setBusyId(null)
  }

  return (
    <section>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Todas tus deudas en un solo informe</h1>
      <p className="text-ink-2 mt-2 max-w-[58ch]">
        La CMF (el regulador de los bancos) entrega gratis un informe con todo lo que debes en bancos, tarjetas y financieras supervisadas: con quién, cuánto y si hay atrasos. Es la forma más rápida de no olvidar ninguna deuda.
      </p>

      <div className="grid gap-3 mt-6">
        {entities.map(e => {
          const got = docs.filter(d => d.kind === 'cmf' && d.entity_id === e.id)
          const isPerson = e.kind === 'persona'
          return (
            <div key={e.id} className="card p-4">
              <div className="flex items-center gap-2.5">
                <span className="size-2.5" style={{ background: seriesColor(e.color_slot), borderRadius: isPerson ? 999 : 2 }} />
                <span className="font-medium">{e.name}</span>
                {got.length > 0 && <span className="ml-auto text-income text-[13px] flex items-center gap-1"><Check size={14} /> Informe recibido</span>}
              </div>
              {isPerson ? (
                <ol className="list-decimal pl-5 text-ink-2 text-[13.5px] mt-2.5 flex flex-col gap-1">
                  <li>Abre “Conoce tu deuda” e ingresa con tu RUN y ClaveÚnica.</li>
                  <li>Te llegará un código al correo: escríbelo.</li>
                  <li>Descarga el informe en PDF y súbelo aquí. Sale al instante.</li>
                </ol>
              ) : (
                <ol className="list-decimal pl-5 text-ink-2 text-[13.5px] mt-2.5 flex flex-col gap-1">
                  <li>Lo pide el representante legal en “Atención en línea” de la CMF, con su ClaveÚnica.</li>
                  <li>Hay que adjuntar: cédula del representante, RUT de la empresa y la escritura donde consta la representación.</li>
                  <li>La CMF lo envía en un máximo de 10 días hábiles. Cuando llegue, súbelo aquí.</li>
                </ol>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <a className="btn btn-outline" href={isPerson ? CMF.persona : CMF.empresa} target="_blank" rel="noreferrer">
                  {isPerson ? 'Abrir Conoce tu deuda' : 'Abrir Atención en línea CMF'} <ExternalLink size={14} />
                </a>
                <label className="btn btn-primary cursor-pointer">
                  {busyId === e.id ? <Spinner /> : <FileUp size={15} />} Subir el informe
                  <input type="file" className="sr-only" onChange={ev => { const f = ev.target.files?.[0]; if (f) upload(e, f); ev.target.value = '' }} />
                </label>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-ink-3 text-[12.5px] mt-4 max-w-[60ch]">
        Puedes continuar sin esto y subirlo después. El informe no incluye deudas con personas, proveedores ni financieras que la CMF no supervisa; esas se agregan a mano en “Deudas”.
      </p>
    </section>
  )
}

function MovementsStep({ entities, accounts }: { entities: Entity[]; accounts: Account[] }) {
  const active = accounts.filter(a => a.is_active)
  return (
    <section>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Ahora, tus movimientos</h1>
      <p className="text-ink-2 mt-2 max-w-[58ch]">
        Para cada cuenta necesitamos los movimientos de los últimos 3 meses. Puedes hacerlo de dos formas, la que te quede más cómoda.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <div className="card p-4">
          <div className="font-medium">Desde el celular</div>
          <p className="text-ink-2 text-[13.5px] mt-1">Abre la app del banco, entra a los movimientos y saca capturas de pantalla bajando de a poco. Después súbelas todas juntas.</p>
        </div>
        <div className="card p-4">
          <div className="font-medium">Desde el computador</div>
          <p className="text-ink-2 text-[13.5px] mt-1">En el sitio del banco busca “Cartola” o “Movimientos”, elige el mes y descarga. Sirve PDF, Excel o el archivo de texto.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {entities.map(e => {
          const list = active.filter(a => a.entity_id === e.id)
          if (!list.length) return null
          const banks = [...new Set(list.map(a => a.bank))]
          return (
            <div key={e.id} className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-paper border-b border-line flex items-center gap-2.5">
                <span className="size-2.5" style={{ background: seriesColor(e.color_slot), borderRadius: e.kind === 'persona' ? 999 : 2 }} />
                <span className="font-medium">{e.name}</span>
              </div>
              {banks.map(b => {
                const inst = findInstitution(b)
                return (
                  <div key={b} className="px-4 py-3 border-b border-line/70 last:border-b-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{b}</div>
                      <div className="text-ink-2 text-[13px]">{list.filter(a => a.bank === b).map(a => `${PRODUCT_LABEL[a.kind]}${a.last4 ? ` ····${a.last4}` : ''}`).join(' · ')}</div>
                    </div>
                    {inst?.url && <a className="btn btn-outline btn-sm shrink-0" href={inst.url} target="_blank" rel="noreferrer">Abrir banco <ExternalLink size={13} /></a>}
                  </div>
                )
              })}
            </div>
          )
        })}
        {active.length === 0 && <p className="text-ink-2">No marcaste cuentas todavía. Puedes volver atrás o crearlas al subir tu primer archivo.</p>}
      </div>
      <p className="text-ink-3 text-[12.5px] mt-4">Nunca te pediremos la clave del banco. Tú descargas o capturas; nosotros leemos.</p>
    </section>
  )
}
