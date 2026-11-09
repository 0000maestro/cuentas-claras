/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Account, Category, Entity, Organization, Role } from '../lib/types'
import { monthKey } from '../lib/format'

interface Membership { org_id: string; role: Role }

interface AppState {
  session: Session | null
  loadingSession: boolean
  orgs: Organization[]
  memberships: Membership[]
  org: Organization | null
  role: Role | null
  canEdit: boolean
  setOrgId: (id: string) => void
  entities: Entity[]
  accounts: Account[]
  categories: Category[]
  /** filtro de entidad: null = todas */
  entityId: string | null
  setEntityId: (id: string | null) => void
  /** mes seleccionado como 'yyyy-MM-01' */
  month: string
  setMonth: (m: string) => void
  loadingOrg: boolean
  refreshOrg: () => Promise<void>
  refreshOrgs: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [orgId, setOrgIdState] = useState<string | null>(() => localStorage.getItem('cc.org'))
  const [entities, setEntities] = useState<Entity[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [entityId, setEntityIdState] = useState<string | null>(() => localStorage.getItem('cc.entity'))
  const [month, setMonthState] = useState<string>(() => localStorage.getItem('cc.month') || monthKey(new Date()))
  const [loadingOrg, setLoadingOrg] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoadingSession(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const refreshOrgs = useCallback(async () => {
    if (!session) { setOrgs([]); setMemberships([]); return }
    await supabase.rpc('accept_invites')
    const [{ data: ms }, { data: os }] = await Promise.all([
      supabase.from('memberships').select('org_id, role'),
      supabase.from('organizations').select('*').order('name'),
    ])
    setMemberships((ms as Membership[]) ?? [])
    setOrgs((os as Organization[]) ?? [])
  }, [session])

  useEffect(() => { refreshOrgs() }, [refreshOrgs])

  useEffect(() => {
    if (orgs.length === 0) return
    if (!orgId || !orgs.some(o => o.id === orgId)) {
      setOrgIdState(orgs[0].id)
      localStorage.setItem('cc.org', orgs[0].id)
    }
  }, [orgs, orgId])

  const refreshOrg = useCallback(async () => {
    if (!orgId) return
    setLoadingOrg(true)
    const [{ data: es }, { data: as }, { data: cs }] = await Promise.all([
      supabase.from('entities').select('*').eq('org_id', orgId).order('sort_order').order('name'),
      supabase.from('accounts').select('*').eq('org_id', orgId).order('bank').order('name'),
      supabase.from('categories').select('*').or(`org_id.eq.${orgId},org_id.is.null`).order('sort_order').order('name'),
    ])
    setEntities((es as Entity[]) ?? [])
    setAccounts((as as Account[]) ?? [])
    setCategories((cs as Category[]) ?? [])
    setLoadingOrg(false)
  }, [orgId])

  useEffect(() => { refreshOrg() }, [refreshOrg])

  // si la entidad guardada no pertenece a la org, limpiar
  useEffect(() => {
    if (entityId && entities.length && !entities.some(e => e.id === entityId)) {
      setEntityIdState(null)
      localStorage.removeItem('cc.entity')
    }
  }, [entities, entityId])

  const setOrgId = (id: string) => {
    setOrgIdState(id); localStorage.setItem('cc.org', id)
    setEntityIdState(null); localStorage.removeItem('cc.entity')
  }
  const setEntityId = (id: string | null) => {
    setEntityIdState(id)
    if (id) localStorage.setItem('cc.entity', id); else localStorage.removeItem('cc.entity')
  }
  const setMonth = (m: string) => { setMonthState(m); localStorage.setItem('cc.month', m) }

  const org = useMemo(() => orgs.find(o => o.id === orgId) ?? null, [orgs, orgId])
  const role = useMemo(() => memberships.find(m => m.org_id === orgId)?.role ?? null, [memberships, orgId])

  const value: AppState = {
    session, loadingSession, orgs, memberships, org, role,
    canEdit: role === 'owner' || role === 'admin',
    setOrgId, entities, accounts, categories, entityId, setEntityId, month, setMonth,
    loadingOrg, refreshOrg, refreshOrgs,
    signOut: async () => { await supabase.auth.signOut(); localStorage.removeItem('cc.org') },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp fuera de AppProvider')
  return v
}
