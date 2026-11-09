-- =====================================================================
-- Módulo "Ahorro compartido" (aplicado al proyecto Conciliation el 2026-11-09)
--
-- Acuerdo: por cada ahorro logrado en un ítem de costo, el auditor gana una
-- comisión ÚNICA del 50% del ahorro mensual de ese ítem. El ahorro se verifica
-- automáticamente contra las cartolas: el cargo deja de aparecer (o aparece
-- rebajado) dentro de su ventana de cobro esperada.
--
-- Estado consolidado de las migraciones remotas:
--   ahorro_compartido · ahorro_compartido_ajustes · ahorro_formato_clp
-- =====================================================================

-- 1) Acuerdos ---------------------------------------------------------
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'ahorro_compartido',
  commission_pct numeric not null default 50 check (commission_pct >= 0 and commission_pct <= 100),
  payout text not null default 'unico' check (payout in ('unico','recurrente')),
  terms_md text not null,
  accepted_by uuid,
  accepted_email text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, kind)
);

alter table public.agreements enable row level security;
create policy agreements_select on public.agreements for select
  using ((select private.is_org_member(org_id)));
create policy agreements_insert on public.agreements for insert
  with check ((select private.can_edit_org(org_id)));
create policy agreements_update on public.agreements for update
  using ((select private.can_edit_org(org_id)))
  with check ((select private.can_edit_org(org_id)));
create policy agreements_delete on public.agreements for delete
  using ((select private.can_edit_org(org_id)));

-- Un acuerdo aceptado queda congelado.
CREATE OR REPLACE FUNCTION private.agreements_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.accepted_at is not null then
      raise exception 'Acuerdo aceptado: no se puede eliminar.';
    end if;
    return old;
  end if;
  if old.accepted_at is not null and (
       new.commission_pct is distinct from old.commission_pct
    or new.payout is distinct from old.payout
    or new.terms_md is distinct from old.terms_md
    or new.accepted_at is distinct from old.accepted_at
    or new.accepted_by is distinct from old.accepted_by
    or new.accepted_email is distinct from old.accepted_email
    or new.org_id is distinct from old.org_id
  ) then
    raise exception 'Acuerdo aceptado: no se puede modificar. Crea un acuerdo nuevo.';
  end if;
  return new;
end $function$;

create trigger agreements_guard
  before update or delete on public.agreements
  for each row execute function private.agreements_guard();

-- Cualquier miembro de la organización puede aceptar el acuerdo, una vez.
CREATE OR REPLACE FUNCTION public.accept_agreement(p_agreement uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid; v_email text;
begin
  select org_id into v_org from public.agreements where id = p_agreement;
  if v_org is null then raise exception 'acuerdo no encontrado'; end if;
  if not private.is_org_member(v_org) then raise exception 'sin permiso'; end if;
  select email into v_email from auth.users where id = (select auth.uid());
  update public.agreements
     set accepted_by = (select auth.uid()), accepted_email = v_email, accepted_at = now()
   where id = p_agreement and accepted_at is null;
  return found;
end $function$;

-- 2) Eventos de ahorro ------------------------------------------------
create table public.savings_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agreement_id uuid references public.agreements(id),
  recurring_id uuid references public.recurring_charges(id),
  debt_id uuid references public.debts(id),
  entity_id uuid references public.entities(id),
  account_id uuid references public.accounts(id),
  title text not null,
  action text not null check (action in ('cancelado','renegociado','rebajado','otro')),
  action_note text,
  amount_before numeric not null check (amount_before > 0),
  amount_after_expected numeric not null default 0 check (amount_after_expected >= 0),
  match_pattern text not null,
  window_start date not null,
  window_end date not null,
  grace_days integer not null default 5,
  status text not null default 'pendiente'
    check (status in ('pendiente','verificado','no_logrado','reaparecio')),
  amount_after_actual numeric,
  monthly_saving numeric,
  commission_pct numeric not null default 50,
  commission_amount numeric,
  verified_at timestamptz,
  verified_import_id uuid references public.imports(id),
  verification_detail text,
  reappeared_at date,
  reappeared_tx bigint references public.transactions(id),
  commission_status text not null default 'pendiente'
    check (commission_status in ('pendiente','devengada','pagada','anulada')),
  commission_paid_at date,
  commission_payment_tx bigint references public.transactions(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (window_end >= window_start)
);

create index savings_events_org_status_idx on public.savings_events (org_id, status);

alter table public.savings_events enable row level security;
create policy savings_events_select on public.savings_events for select
  using ((select private.is_org_member(org_id)));
create policy savings_events_insert on public.savings_events for insert
  with check ((select private.can_edit_org(org_id)));
create policy savings_events_update on public.savings_events for update
  using ((select private.can_edit_org(org_id)))
  with check ((select private.can_edit_org(org_id)));
create policy savings_events_delete on public.savings_events for delete
  using ((select private.can_edit_org(org_id)));

-- Un ahorro verificado no se edita ni se borra: solo se permite marcar
-- reaparición y gestionar el pago de la comisión.
CREATE OR REPLACE FUNCTION private.savings_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.status in ('verificado','reaparecio') then
      raise exception 'Ahorro verificado: no se puede eliminar.';
    end if;
    return old;
  end if;
  if old.status in ('verificado','reaparecio') then
    if new.amount_before        is distinct from old.amount_before
    or new.amount_after_expected is distinct from old.amount_after_expected
    or new.amount_after_actual  is distinct from old.amount_after_actual
    or new.monthly_saving       is distinct from old.monthly_saving
    or new.commission_pct       is distinct from old.commission_pct
    or new.commission_amount    is distinct from old.commission_amount
    or new.verified_at          is distinct from old.verified_at
    or new.verified_import_id   is distinct from old.verified_import_id
    or new.verification_detail  is distinct from old.verification_detail
    or new.match_pattern        is distinct from old.match_pattern
    or new.window_start         is distinct from old.window_start
    or new.window_end           is distinct from old.window_end
    or new.title                is distinct from old.title
    or new.action               is distinct from old.action
    or new.org_id               is distinct from old.org_id
    then
      raise exception 'Ahorro verificado: los datos económicos son inmutables.';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'verificado' and new.status = 'reaparecio') then
      raise exception 'Transición de estado no permitida.';
    end if;
  end if;
  return new;
end $function$;

create trigger savings_events_guard
  before update or delete on public.savings_events
  for each row execute function private.savings_events_guard();

-- 3) Registrar un ahorro desde un cargo recurrente ---------------------
-- Calcula la ventana del próximo cobro (día típico ±7) y guarda la cuenta
-- donde se cobraba.
CREATE OR REPLACE FUNCTION public.register_saving(p_recurring uuid, p_action text, p_amount_after numeric DEFAULT 0, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rc public.recurring_charges%rowtype;
  v_day int; v_base date; v_next date; v_account uuid;
  v_agreement uuid; v_pct numeric; v_id uuid;
begin
  select * into rc from public.recurring_charges where id = p_recurring;
  if rc.id is null then raise exception 'cargo recurrente no encontrado'; end if;
  if not private.can_edit_org(rc.org_id) then raise exception 'sin permiso'; end if;
  if p_action not in ('cancelado','renegociado','rebajado') then
    raise exception 'acción inválida: usa cancelado, renegociado o rebajado';
  end if;
  if coalesce(rc.expected_amount, 0) <= 0 then
    raise exception 'el cargo no tiene monto esperado definido';
  end if;
  if coalesce(p_amount_after,0) < 0 or coalesce(p_amount_after,0) >= rc.expected_amount then
    raise exception 'el monto nuevo debe ser menor al monto actual del cargo';
  end if;
  if exists (select 1 from public.savings_events
              where recurring_id = p_recurring and status in ('pendiente','verificado')) then
    raise exception 'este cargo ya tiene un ahorro registrado';
  end if;

  select id, commission_pct into v_agreement, v_pct
    from public.agreements
   where org_id = rc.org_id and kind = 'ahorro_compartido'
   order by created_at desc limit 1;
  v_pct := coalesce(v_pct, 50);

  select coalesce(mode() within group (order by extract(day from t.posted_at)::int), 5),
         mode() within group (order by t.account_id)
    into v_day, v_account
    from public.transactions t where t.recurring_id = p_recurring;

  v_base := greatest(coalesce(rc.last_seen, current_date), current_date);
  v_next := (date_trunc('month', v_base)::date
             + interval '1 month'
             + (least(coalesce(v_day,5), 28) - 1) * interval '1 day')::date;
  if v_next < current_date then
    v_next := (v_next + interval '1 month')::date;
  end if;

  insert into public.savings_events (
    org_id, agreement_id, recurring_id, entity_id, account_id, title, action, action_note,
    amount_before, amount_after_expected, match_pattern,
    window_start, window_end, commission_pct, created_by
  ) values (
    rc.org_id, v_agreement, rc.id, rc.entity_id, v_account, rc.name, p_action, p_note,
    rc.expected_amount, coalesce(p_amount_after, 0), rc.match_pattern,
    v_next - 7, v_next + 7, v_pct, (select auth.uid())
  ) returning id into v_id;

  if p_action = 'cancelado' then
    update public.recurring_charges
       set status = 'cancelado', cancelled_at = current_date,
           decision_note = coalesce(p_note, decision_note)
     where id = rc.id;
  end if;

  return v_id;
end $function$;

-- 4) Verificación automática contra cartolas ---------------------------
-- Se llama después de cada importación. Solo decide cuando la cartola de la
-- cuenta original ya cubre la ventana + días de gracia. El cargo se busca en
-- todas las cuentas (por si el proveedor cambió de tarjeta).
CREATE OR REPLACE FUNCTION public.verify_savings(p_org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e record; v_count int := 0;
  v_deadline date; v_cover date;
  v_tx bigint; v_found numeric; v_found_date date;
  v_saving numeric; v_import uuid;
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;

  for e in select * from public.savings_events
            where org_id = p_org and status = 'pendiente' loop
    v_deadline := e.window_end + e.grace_days;

    if e.account_id is not null then
      select max(t.posted_at) into v_cover from public.transactions t
       where t.org_id = p_org and t.account_id = e.account_id;
    else
      -- sin cuenta conocida: exigir que TODAS las cuentas con movimientos cubran la fecha
      select min(mx) into v_cover from (
        select max(t.posted_at) as mx from public.transactions t
         where t.org_id = p_org group by t.account_id) s;
    end if;
    if v_cover is null or v_cover < v_deadline then continue; end if;

    v_tx := null; v_found := null; v_found_date := null;
    select t.id, abs(t.amount), t.posted_at
      into v_tx, v_found, v_found_date
      from public.transactions t
     where t.org_id = p_org and t.amount < 0 and not t.is_transfer
       and t.posted_at between e.window_start and v_deadline
       and t.description_norm ilike '%' || lower(e.match_pattern) || '%'
     order by abs(t.amount) desc limit 1;

    if v_tx is null then
      v_saving := e.amount_before; v_found := 0;
    elsif v_found <= e.amount_before * 0.95 then
      v_saving := e.amount_before - v_found;
    else
      update public.savings_events
         set status = 'no_logrado',
             amount_after_actual = v_found,
             verification_detail = format(
               'El cargo apareció por $%s el %s dentro de la ventana esperada (%s a %s). No hubo ahorro.',
               replace(to_char(v_found, 'FM999,999,999,999'), ',', '.'), v_found_date, e.window_start, v_deadline)
       where id = e.id;
      continue;
    end if;

    select t.import_id into v_import
      from public.transactions t
     where t.org_id = p_org
       and (e.account_id is null or t.account_id = e.account_id)
       and t.posted_at >= e.window_start and t.import_id is not null
     order by t.posted_at desc limit 1;

    update public.savings_events
       set status = 'verificado',
           amount_after_actual = v_found,
           monthly_saving = v_saving,
           commission_amount = round(v_saving * savings_events.commission_pct / 100, 0),
           commission_status = 'devengada',
           verified_at = now(),
           verified_import_id = v_import,
           verification_detail = case when v_tx is null
             then format('No apareció ningún cargo que coincida con "%s" entre %s y %s, con cartolas cargadas hasta el %s.',
                         e.match_pattern, e.window_start, v_deadline, v_cover)
             else format('El cargo apareció rebajado: $%s el %s (antes $%s).',
                         replace(to_char(v_found, 'FM999,999,999,999'), ',', '.'), v_found_date,
                         replace(to_char(e.amount_before, 'FM999,999,999,999'), ',', '.')) end
     where id = e.id;
    v_count := v_count + 1;
  end loop;

  -- reapariciones (informativo; no afecta comisiones devengadas)
  for e in select * from public.savings_events
            where org_id = p_org and status = 'verificado' loop
    v_tx := null;
    select t.id, t.posted_at, abs(t.amount)
      into v_tx, v_found_date, v_found
      from public.transactions t
     where t.org_id = p_org and t.amount < 0 and not t.is_transfer
       and t.posted_at > e.window_end + e.grace_days
       and t.description_norm ilike '%' || lower(e.match_pattern) || '%'
       and abs(t.amount) > coalesce(e.amount_after_actual, 0) + greatest(e.monthly_saving * 0.2, 1000)
     order by t.posted_at asc limit 1;
    if v_tx is not null then
      update public.savings_events
         set status = 'reaparecio', reappeared_at = v_found_date, reappeared_tx = v_tx
       where id = e.id;
    end if;
  end loop;

  return v_count;
end $function$;

-- 5) Vistas para el panel ---------------------------------------------
create or replace view public.v_savings with (security_invoker = on) as
select s.*,
       a.terms_md, a.accepted_at as agreement_accepted_at,
       e.name as entity_name
  from public.savings_events s
  left join public.agreements a on a.id = s.agreement_id
  left join public.entities e on e.id = s.entity_id;

create or replace view public.v_savings_summary with (security_invoker = on) as
select org_id,
       count(*) filter (where status = 'pendiente')                                as pendientes,
       count(*) filter (where status in ('verificado','reaparecio'))               as verificados,
       count(*) filter (where status = 'no_logrado')                               as no_logrados,
       coalesce(sum(monthly_saving) filter (where status in ('verificado','reaparecio')), 0)      as ahorro_mensual_total,
       coalesce(sum(monthly_saving * 12) filter (where status in ('verificado','reaparecio')), 0) as ahorro_proyectado_12m,
       coalesce(sum(commission_amount) filter (where commission_status = 'devengada'), 0)         as comision_devengada,
       coalesce(sum(commission_amount) filter (where commission_status = 'pagada'), 0)            as comision_pagada
  from public.savings_events
 group by org_id;
