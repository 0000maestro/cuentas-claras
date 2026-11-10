-- Ya aplicada en Conciliation como "regex_rules_documents_onboarding" (20261110052625).

-- 1) Reglas con expresión regular ("re:...") sobre la descripción original
create or replace function private.rule_matches(p_pattern text, p_desc text, p_norm text)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_pattern like 're:%'
              then coalesce(p_desc,'') ~* substr(p_pattern, 4)
              else coalesce(p_norm,'') ilike '%' || lower(p_pattern) || '%' end;
$$;
grant execute on function private.rule_matches(text, text, text) to authenticated;

create or replace function private.apply_rules_to_transaction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  new.description_norm := public.normalize_description(new.description);
  if new.entity_id is null then
    select a.entity_id into new.entity_id from public.accounts a where a.id = new.account_id;
  end if;
  for r in
    select * from public.rules
    where org_id = new.org_id and is_active
      and private.rule_matches(pattern, new.description, new.description_norm)
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

create or replace function public.reapply_rules(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;
  with first_rule as (
    select distinct on (t.id) t.id as tx_id, r.category_id, r.entity_id, r.counterparty, r.recurring_id, r.debt_id, r.mark_transfer
    from public.transactions t
    join public.rules r on r.org_id = t.org_id and r.is_active
      and private.rule_matches(r.pattern, t.description, t.description_norm)
    where t.org_id = p_org and not t.reviewed
    order by t.id, r.priority asc, r.created_at asc
  )
  update public.transactions t
     set category_id = coalesce(f.category_id, t.category_id),
         entity_id = coalesce(f.entity_id, t.entity_id),
         counterparty = coalesce(f.counterparty, t.counterparty),
         recurring_id = coalesce(f.recurring_id, t.recurring_id),
         debt_id = coalesce(f.debt_id, t.debt_id),
         is_transfer = (t.is_transfer or f.mark_transfer)
    from first_rule f
   where t.id = f.tx_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 2) Deudas de las que solo se conoce la cuota
alter table public.debts alter column principal drop not null;

create or replace view public.v_debts with (security_invoker = true) as
with base as (
  select d.*,
         e.name as entity_name,
         coalesce(p.paid_total,0) as paid_recorded,
         p.payments_count,
         p.last_payment_at,
         case
           when d.balance_manual is not null then greatest(d.balance_manual - coalesce(p.principal_since_manual,0), 0)
           when d.principal is not null then greatest(d.principal - coalesce(p.principal_total,0) - d.paid_before_tracking, 0)
           else null
         end as remaining_est
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
  ) p on true
)
select b.*,
       case when b.principal is not null and b.remaining_est is not null
            then greatest(b.paid_recorded + b.paid_before_tracking, b.principal - b.remaining_est)
            else b.paid_recorded + b.paid_before_tracking end as paid_total,
       case when b.annual_rate is not null and b.remaining_est is not null
            then round(b.remaining_est * (b.annual_rate/100.0) / 12.0, 0) else null end as monthly_interest_est,
       b.installment_amount as monthly_payment
from base b;

-- 3) Contexto del onboarding
alter table public.organizations add column if not exists onboarding jsonb not null default '{}'::jsonb;
alter table public.entities add column if not exists activity text;
alter table public.entities add column if not exists income_channels text[] not null default '{}';
alter table public.transactions add column if not exists meta jsonb;

-- 4) Bandeja de documentos: todo archivo que se sube queda guardado
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  kind text not null default 'otro' check (kind in ('cartola','tarjeta','cmf','captura','otro')),
  filename text not null,
  storage_path text,
  mime text,
  size_bytes bigint,
  extracted_text text,
  rows_found integer not null default 0,
  rows_imported integer not null default 0,
  status text not null default 'recibido' check (status in ('recibido','importado','por_revisar','procesado')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists documents_org_id_idx on public.documents (org_id, created_at desc);
create index if not exists documents_entity_id_idx on public.documents (entity_id);
create index if not exists documents_account_id_idx on public.documents (account_id);
create index if not exists documents_created_by_idx on public.documents (created_by);
alter table public.documents enable row level security;
create policy documents_select on public.documents for select to authenticated using ((select private.is_org_member(org_id)));
create policy documents_insert on public.documents for insert to authenticated with check ((select private.can_edit_org(org_id)));
create policy documents_update on public.documents for update to authenticated using ((select private.can_edit_org(org_id))) with check ((select private.can_edit_org(org_id)));

-- 5) Solicitudes de nuevas fuentes (instituciones que aún no leemos)
create table if not exists public.source_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  detail text,
  status text not null default 'pendiente' check (status in ('pendiente','en_curso','lista')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists source_requests_org_id_idx on public.source_requests (org_id);
create index if not exists source_requests_created_by_idx on public.source_requests (created_by);
alter table public.source_requests enable row level security;
create policy source_requests_select on public.source_requests for select to authenticated using ((select private.is_org_member(org_id)));
create policy source_requests_insert on public.source_requests for insert to authenticated with check ((select private.can_edit_org(org_id)));

-- 6) Almacenamiento privado de los archivos originales, una carpeta por organización
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 26214400)
on conflict (id) do nothing;
create policy documentos_read on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and private.is_org_member(((storage.foldername(name))[1])::uuid));
create policy documentos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and private.can_edit_org(((storage.foldername(name))[1])::uuid));
