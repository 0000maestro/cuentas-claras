-- Excluir de la detección de recurrentes las categorías que no son costo (impuestos, traspasos, inversiones, ingresos, inventario)
alter table public.categories add column if not exists exclude_from_recurring boolean not null default false;
update public.categories set exclude_from_recurring = true
where kind in ('impuesto','transferencia','inversion','ingreso') or name ilike 'Proveedores%';

create or replace function public.detect_recurring(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_new integer := 0;
  g record;
  v_id uuid;
  v_nil uuid := '00000000-0000-0000-0000-000000000000';
begin
  if not private.can_edit_org(p_org) then raise exception 'sin permiso'; end if;
  for g in
    select t.description_norm, t.entity_id,
           count(distinct date_trunc('month', t.posted_at)) as months,
           avg(t.amount) as avg_amount,
           min(t.posted_at) as first_seen, max(t.posted_at) as last_seen,
           mode() within group (order by t.category_id) as category_id
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.org_id = p_org and t.amount < 0 and not t.is_transfer and t.recurring_id is null
      and length(t.description_norm) >= 4
      and coalesce(c.exclude_from_recurring, false) = false
    group by t.description_norm, t.entity_id
    having count(distinct date_trunc('month', t.posted_at)) >= 2
       and coalesce(stddev_pop(t.amount),0) <= greatest(abs(avg(t.amount)) * 0.25, 2000)
  loop
    select id into v_id from public.recurring_charges
      where org_id = p_org and match_pattern = g.description_norm
        and coalesce(entity_id, v_nil) = coalesce(g.entity_id, v_nil);
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
        and coalesce(entity_id, v_nil) = coalesce(g.entity_id, v_nil)
        and recurring_id is null and amount < 0;
  end loop;
  return v_new;
end $$;

drop view if exists public.v_debts;
create view public.v_debts with (security_invoker = true) as
with base as (
  select d.*,
         e.name as entity_name,
         coalesce(p.paid_total,0) as paid_recorded,
         p.payments_count,
         p.last_payment_at,
         case
           when d.balance_manual is not null then greatest(d.balance_manual - coalesce(p.principal_since_manual,0), 0)
           else greatest(d.principal - coalesce(p.principal_total,0) - d.paid_before_tracking, 0)
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
       greatest(b.paid_recorded + b.paid_before_tracking, b.principal - b.remaining_est) as paid_total,
       case when b.annual_rate is not null then round(b.remaining_est * (b.annual_rate/100.0) / 12.0, 0) else null end as monthly_interest_est,
       b.installment_amount as monthly_payment
from base b;
