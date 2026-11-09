-- Cuentas Claras — esquema multi-cliente
-- Cada organización (cliente) agrupa entidades (personas y empresas), cuentas, movimientos, recurrentes y deudas.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ---------- Organizaciones y acceso ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  baseline_month date,                 -- mes de referencia para la meta de recorte (ej: 2026-11-01)
  baseline_fixed_cost numeric(14,2),   -- costo fijo mensual de partida (se puede fijar a mano)
  target_reduction_pct numeric(5,2) not null default 25,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, email)
);
create index org_invites_email_idx on public.org_invites (lower(email));

-- Helpers de seguridad (privados)
create or replace function private.is_org_member(p_org uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;
create or replace function private.can_edit_org(p_org uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role in ('owner','admin')
  );
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.can_edit_org(uuid) to authenticated;

-- Al entrar, el usuario convierte sus invitaciones en membresías
create or replace function public.accept_invites()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_count integer;
begin
  select email into v_email from auth.users where id = (select auth.uid());
  if v_email is null then return 0; end if;
  with moved as (
    insert into public.memberships (org_id, user_id, role)
    select i.org_id, (select auth.uid()), i.role
    from public.org_invites i
    where lower(i.email) = lower(v_email)
    on conflict (org_id, user_id) do update set role = excluded.role
    returning org_id
  )
  select count(*) into v_count from moved;
  delete from public.org_invites where lower(email) = lower(v_email);
  return v_count;
end $$;

-- ---------- Entidades: la persona y sus empresas ----------
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('persona','empresa')),
  rut text,
  color_slot smallint not null default 1,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index entities_org_id_idx on public.entities (org_id);

-- ---------- Cuentas: corrientes, tarjetas, créditos, inversiones ----------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  name text not null,
  bank text not null,
  kind text not null check (kind in (
    'corriente','vista','ahorro','tarjeta_credito','linea_credito',
    'credito_consumo','credito_comercial','hipotecario','leasing','inversion','efectivo','billetera','otro')),
  currency text not null default 'CLP',
  last4 text,
  credit_limit numeric(14,2),
  is_active boolean not null default true,
  import_mapping jsonb,                -- mapeo de columnas guardado para las cartolas de esta cuenta
  notes text,
  created_at timestamptz not null default now()
);
create index accounts_org_id_idx on public.accounts (org_id);
create index accounts_entity_id_idx on public.accounts (entity_id);

-- ---------- Categorías ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = plantilla global
  name text not null,
  kind text not null check (kind in ('ingreso','gasto','transferencia','deuda','inversion','impuesto')),
  is_fixed boolean not null default false,   -- costo fijo / recurrente por naturaleza
  parent_id uuid references public.categories(id) on delete set null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
create index categories_org_id_idx on public.categories (org_id);
create index categories_parent_id_idx on public.categories (parent_id);

-- ---------- Deudas ----------
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  creditor text not null,
  kind text not null check (kind in (
    'credito_consumo','credito_comercial','hipotecario','linea_credito','tarjeta_credito',
    'leasing','factoring','prestamo_persona','proveedor','sii','otro')),
  principal numeric(14,2) not null,          -- monto original
  currency text not null default 'CLP',
  start_date date,
  installments_total integer,
  installment_amount numeric(14,2),          -- cuota mensual
  annual_rate numeric(7,3),                  -- tasa anual en % (ej: 24.5)
  balance_manual numeric(14,2),              -- saldo informado por el banco a una fecha
  balance_manual_at date,
  paid_before_tracking numeric(14,2) not null default 0, -- pagado antes de tener datos
  status text not null default 'activa' check (status in ('activa','pagada','refinanciada','en_mora')),
  notes text,
  created_at timestamptz not null default now()
);
create index debts_org_id_idx on public.debts (org_id);
create index debts_entity_id_idx on public.debts (entity_id);
create index debts_account_id_idx on public.debts (account_id);

-- ---------- Recurrentes (suscripciones y costos fijos) ----------
create table public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  match_pattern text not null,               -- texto normalizado que identifica el cargo
  cadence text not null default 'mensual' check (cadence in ('semanal','mensual','bimestral','trimestral','anual','irregular')),
  expected_amount numeric(14,2),
  status text not null default 'revisar' check (status in ('revisar','mantener','negociar','cancelar','cancelado')),
  decision_note text,
  first_seen date,
  last_seen date,
  cancelled_at date,
  created_at timestamptz not null default now()
);
create index recurring_org_id_idx on public.recurring_charges (org_id);
create index recurring_entity_id_idx on public.recurring_charges (entity_id);
create index recurring_category_id_idx on public.recurring_charges (category_id);

-- ---------- Reglas de clasificación ----------
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  pattern text not null,                     -- se compara contra description_norm (ILIKE %pattern%)
  category_id uuid references public.categories(id) on delete set null,
  entity_id uuid references public.entities(id) on delete set null,
  counterparty text,
  recurring_id uuid references public.recurring_charges(id) on delete set null,
  debt_id uuid references public.debts(id) on delete set null,
  mark_transfer boolean not null default false,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index rules_org_id_idx on public.rules (org_id);
create index rules_category_id_idx on public.rules (category_id);
create index rules_entity_id_idx on public.rules (entity_id);
create index rules_recurring_id_idx on public.rules (recurring_id);
create index rules_debt_id_idx on public.rules (debt_id);

-- ---------- Importaciones ----------
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  filename text,
  source text not null default 'cartola' check (source in ('cartola','api','manual')),
  rows_total integer not null default 0,
  rows_inserted integer not null default 0,
  rows_duplicated integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index imports_org_id_idx on public.imports (org_id);
create index imports_account_id_idx on public.imports (account_id);
create index imports_created_by_idx on public.imports (created_by);

-- ---------- Movimientos ----------
create table public.transactions (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  posted_at date not null,
  description text not null,
  description_norm text not null default '',
  amount numeric(14,2) not null,             -- negativo = sale dinero, positivo = entra
  balance_after numeric(14,2),
  category_id uuid references public.categories(id) on delete set null,
  counterparty text,
  is_transfer boolean not null default false, -- movimiento entre cuentas propias: no es ingreso ni gasto
  recurring_id uuid references public.recurring_charges(id) on delete set null,
  debt_id uuid references public.debts(id) on delete set null,
  import_id uuid references public.imports(id) on delete set null,
  fingerprint text not null,                 -- evita duplicados al reimportar
  reviewed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (account_id, fingerprint)
);
create index transactions_org_posted_idx on public.transactions (org_id, posted_at desc);
create index transactions_account_id_idx on public.transactions (account_id);
create index transactions_entity_id_idx on public.transactions (entity_id);
create index transactions_category_id_idx on public.transactions (category_id);
create index transactions_recurring_id_idx on public.transactions (recurring_id);
create index transactions_debt_id_idx on public.transactions (debt_id);
create index transactions_import_id_idx on public.transactions (import_id);
create index transactions_desc_norm_idx on public.transactions (org_id, description_norm);

-- Pagos de deuda registrados a mano (antes de tener cartolas) o conciliados
create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  paid_at date not null,
  amount numeric(14,2) not null,
  interest_part numeric(14,2),
  principal_part numeric(14,2),
  transaction_id bigint references public.transactions(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index debt_payments_debt_id_idx on public.debt_payments (debt_id);
create index debt_payments_org_id_idx on public.debt_payments (org_id);
create index debt_payments_transaction_id_idx on public.debt_payments (transaction_id);

-- ---------- Normalización y reglas automáticas ----------
create or replace function public.normalize_description(p text)
returns text language sql immutable set search_path = '' as $$
  select trim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p,'')), '[0-9]{2,}', ' ', 'g'),   -- folios, fechas, montos, ids
             '[-/*.#:_]+', ' ', 'g'),                                        -- separadores sueltos
           '\s+', ' ', 'g'));
$$;

create or replace function private.apply_rules_to_transaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  new.description_norm := public.normalize_description(new.description);
  if new.entity_id is null then
    select a.entity_id into new.entity_id from public.accounts a where a.id = new.account_id;
  end if;
  -- primera regla que calce, por prioridad
  for r in
    select * from public.rules
    where org_id = new.org_id and is_active
      and new.description_norm ilike '%' || lower(pattern) || '%'
    order by priority asc, created_at asc
    limit 1
  loop
    if new.category_id is null and r.category_id is not null then new.category_id := r.category_id; end if;
    if r.entity_id is not null then new.entity_id := r.entity_id; end if;
    if new.counterparty is null and r.counterparty is not null then new.counterparty := r.counterparty; end if;
    if new.recurring_id is null and r.recurring_id is not null then new.recurring_id := r.recurring_id; end if;
    if new.debt_id is null and r.debt_id is not null then new.debt_id := r.debt_id; end if;
    if r.mark_transfer then new.is_transfer := true; end if;
  end loop;
  return new;
end $$;

create trigger transactions_apply_rules
before insert on public.transactions
for each row execute function private.apply_rules_to_transaction();

-- Reaplicar una regla a los movimientos existentes de la organización
create or replace function public.reapply_rules(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_n integer;
  r record;
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;
  for r in select * from public.rules where org_id = p_org and is_active order by priority desc, created_at desc loop
    update public.transactions t
      set category_id = coalesce(r.category_id, t.category_id),
          entity_id = coalesce(r.entity_id, t.entity_id),
          counterparty = coalesce(r.counterparty, t.counterparty),
          recurring_id = coalesce(r.recurring_id, t.recurring_id),
          debt_id = coalesce(r.debt_id, t.debt_id),
          is_transfer = (t.is_transfer or r.mark_transfer)
      where t.org_id = p_org and t.description_norm ilike '%' || lower(r.pattern) || '%';
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end $$;

-- Detectar cargos recurrentes: misma descripción normalizada, en 2+ meses distintos, monto parecido
create or replace function public.detect_recurring(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_new integer := 0;
  g record;
  v_id uuid;
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;
  for g in
    select t.description_norm, t.entity_id,
           count(distinct date_trunc('month', t.posted_at)) as months,
           avg(t.amount) as avg_amount,
           min(t.posted_at) as first_seen, max(t.posted_at) as last_seen,
           mode() within group (order by t.category_id) as category_id
    from public.transactions t
    where t.org_id = p_org and t.amount < 0 and not t.is_transfer and t.recurring_id is null
      and length(t.description_norm) >= 4
    group by t.description_norm, t.entity_id
    having count(distinct date_trunc('month', t.posted_at)) >= 2
       and stddev_pop(t.amount) <= greatest(abs(avg(t.amount)) * 0.25, 2000)
  loop
    select id into v_id from public.recurring_charges
      where org_id = p_org and match_pattern = g.description_norm and coalesce(entity_id,'00000000-0000-0000-0000-000000000000') = coalesce(g.entity_id,'00000000-0000-0000-0000-000000000000');
    if v_id is null then
      insert into public.recurring_charges (org_id, entity_id, category_id, name, match_pattern, expected_amount, first_seen, last_seen)
      values (p_org, g.entity_id, g.category_id, initcap(g.description_norm), g.description_norm, round(abs(g.avg_amount),0), g.first_seen, g.last_seen)
      returning id into v_id;
      v_new := v_new + 1;
    else
      update public.recurring_charges set last_seen = g.last_seen, expected_amount = round(abs(g.avg_amount),0) where id = v_id;
    end if;
    update public.transactions set recurring_id = v_id
      where org_id = p_org and description_norm = g.description_norm
        and coalesce(entity_id,'00000000-0000-0000-0000-000000000000') = coalesce(g.entity_id,'00000000-0000-0000-0000-000000000000')
        and recurring_id is null and amount < 0;
  end loop;
  return v_new;
end $$;

-- ---------- Vistas ----------
-- Resumen mensual por entidad
create or replace view public.v_monthly_summary with (security_invoker = true) as
select t.org_id, t.entity_id, date_trunc('month', t.posted_at)::date as month,
       sum(case when t.amount > 0 and not t.is_transfer then t.amount else 0 end) as income,
       sum(case when t.amount < 0 and not t.is_transfer then -t.amount else 0 end) as expense,
       sum(case when t.amount < 0 and not t.is_transfer and (t.recurring_id is not null or c.is_fixed) then -t.amount else 0 end) as fixed_cost,
       sum(case when t.amount < 0 and not t.is_transfer and t.debt_id is not null then -t.amount else 0 end) as debt_service,
       count(*) as tx_count
from public.transactions t
left join public.categories c on c.id = t.category_id
group by 1,2,3;

-- Recurrentes con su promedio y última fecha
create or replace view public.v_recurring with (security_invoker = true) as
select r.*,
       e.name as entity_name, c.name as category_name,
       coalesce(stats.months_seen,0) as months_seen,
       stats.avg_amount,
       stats.last_amount,
       case r.cadence when 'anual' then coalesce(r.expected_amount, stats.avg_amount)/12
                      when 'trimestral' then coalesce(r.expected_amount, stats.avg_amount)/3
                      when 'bimestral' then coalesce(r.expected_amount, stats.avg_amount)/2
                      when 'semanal' then coalesce(r.expected_amount, stats.avg_amount)*4.33
                      else coalesce(r.expected_amount, stats.avg_amount) end as monthly_equivalent
from public.recurring_charges r
left join public.entities e on e.id = r.entity_id
left join public.categories c on c.id = r.category_id
left join lateral (
  select count(distinct date_trunc('month', t.posted_at)) as months_seen,
         round(avg(-t.amount),0) as avg_amount,
         (select -t2.amount from public.transactions t2 where t2.recurring_id = r.id order by t2.posted_at desc limit 1) as last_amount
  from public.transactions t where t.recurring_id = r.id
) stats on true;

-- Estado de cada deuda
create or replace view public.v_debts with (security_invoker = true) as
select d.*,
       e.name as entity_name,
       coalesce(p.paid_total,0) + d.paid_before_tracking as paid_total,
       p.payments_count,
       p.last_payment_at,
       case
         when d.balance_manual is not null then
           greatest(d.balance_manual - coalesce(p.principal_since_manual,0), 0)
         else greatest(d.principal - coalesce(p.principal_total,0) - d.paid_before_tracking, 0)
       end as remaining_est,
       case when d.annual_rate is not null then
         round((case
           when d.balance_manual is not null then greatest(d.balance_manual - coalesce(p.principal_since_manual,0), 0)
           else greatest(d.principal - coalesce(p.principal_total,0) - d.paid_before_tracking, 0)
         end) * (d.annual_rate/100.0) / 12.0, 0)
       else null end as monthly_interest_est,
       d.installment_amount as monthly_payment
from public.debts d
left join public.entities e on e.id = d.entity_id
left join lateral (
  select sum(dp.amount) as paid_total,
         count(*) as payments_count,
         max(dp.paid_at) as last_payment_at,
         sum(coalesce(dp.principal_part, dp.amount)) as principal_total,
         sum(case when d.balance_manual_at is not null and dp.paid_at > d.balance_manual_at
                  then coalesce(dp.principal_part, dp.amount) else 0 end) as principal_since_manual
  from public.debt_payments dp where dp.debt_id = d.id
) p on true;

-- ---------- Categorías por defecto para una organización nueva ----------
create or replace function public.seed_default_categories(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;
  insert into public.categories (org_id, name, kind, is_fixed, sort_order) values
    (p_org,'Ventas / ingresos del negocio','ingreso',false,1),
    (p_org,'Sueldo / retiros','ingreso',false,2),
    (p_org,'Otros ingresos','ingreso',false,3),
    (p_org,'Arriendo y gastos comunes','gasto',true,10),
    (p_org,'Sueldos y honorarios','gasto',true,11),
    (p_org,'Cotizaciones previsionales','gasto',true,12),
    (p_org,'Servicios básicos (luz, agua, gas, internet)','gasto',true,13),
    (p_org,'Telefonía','gasto',true,14),
    (p_org,'Software y suscripciones','gasto',true,15),
    (p_org,'Seguros','gasto',true,16),
    (p_org,'Publicidad y marketing','gasto',false,17),
    (p_org,'Proveedores / inventario','gasto',false,18),
    (p_org,'Vehículos y combustible','gasto',false,19),
    (p_org,'Mantención y reparaciones','gasto',false,20),
    (p_org,'Comisiones bancarias','gasto',true,21),
    (p_org,'Alimentación','gasto',false,22),
    (p_org,'Hogar y familia','gasto',false,23),
    (p_org,'Salud','gasto',false,24),
    (p_org,'Ocio y viajes','gasto',false,25),
    (p_org,'Otros gastos','gasto',false,29),
    (p_org,'Cuota de crédito','deuda',true,30),
    (p_org,'Pago de tarjeta de crédito','deuda',false,31),
    (p_org,'Intereses y gastos financieros','deuda',true,32),
    (p_org,'IVA / impuestos / SII','impuesto',false,40),
    (p_org,'Transferencia entre cuentas propias','transferencia',false,50),
    (p_org,'Inversiones','inversion',false,60);
end $$;

-- ---------- RLS ----------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.org_invites enable row level security;
alter table public.entities enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.debts enable row level security;
alter table public.recurring_charges enable row level security;
alter table public.rules enable row level security;
alter table public.imports enable row level security;
alter table public.transactions enable row level security;
alter table public.debt_payments enable row level security;

create policy org_select on public.organizations for select to authenticated using ((select private.is_org_member(id)));
create policy org_update on public.organizations for update to authenticated using ((select private.can_edit_org(id)));

create policy memberships_select on public.memberships for select to authenticated using ((select private.is_org_member(org_id)));
create policy invites_select on public.org_invites for select to authenticated using ((select private.can_edit_org(org_id)));
create policy invites_write on public.org_invites for insert to authenticated with check ((select private.can_edit_org(org_id)));
create policy invites_delete on public.org_invites for delete to authenticated using ((select private.can_edit_org(org_id)));

-- Tablas con org_id: leer si es miembro, escribir si es owner/admin
do $$
declare t text;
begin
  foreach t in array array['entities','accounts','debts','recurring_charges','rules','imports','transactions','debt_payments'] loop
    execute format('create policy %I_select on public.%I for select to authenticated using ((select private.is_org_member(org_id)))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check ((select private.can_edit_org(org_id)))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using ((select private.can_edit_org(org_id))) with check ((select private.can_edit_org(org_id)))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using ((select private.can_edit_org(org_id)))', t, t);
  end loop;
end $$;

create policy categories_select on public.categories for select to authenticated using (org_id is null or (select private.is_org_member(org_id)));
create policy categories_insert on public.categories for insert to authenticated with check (org_id is not null and (select private.can_edit_org(org_id)));
create policy categories_update on public.categories for update to authenticated using (org_id is not null and (select private.can_edit_org(org_id)));
create policy categories_delete on public.categories for delete to authenticated using (org_id is not null and (select private.can_edit_org(org_id)));
