-- Semainier — schéma Supabase
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Idempotent : tu peux le relancer sans casser l'existant.

-- ---------------------------------------------------------------- Table
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  kind        text not null check (kind in ('block', 'task')),
  start_date  date not null,
  time_from   time,
  time_to     time,
  recur       text not null default 'none' check (recur in ('none', 'daily', 'weekly', 'monthly')),
  days        smallint[] check (days is null or days <@ array[0,1,2,3,4,5,6]::smallint[]),
  cat         text not null default 'bleu' check (cat in ('bleu', 'vert', 'ambre', 'rose', 'gris')),
  done        jsonb not null default '{}'::jsonb check (jsonb_typeof(done) = 'object'),
  skipped     jsonb not null default '{}'::jsonb check (jsonb_typeof(skipped) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Heures : les deux ou aucune, et la fin après le début.
  constraint items_times_ok check (
    (time_from is null and time_to is null)
    or (time_from is not null and time_to is not null and time_to > time_from)
  ),
  -- Un créneau bloqué a forcément des heures.
  constraint items_block_timed check (kind <> 'block' or time_from is not null)
);

-- Date de fin d'une série, ajoutée après coup : la colonne et sa contrainte sont posées à part,
-- pour qu'une base créée avec une version antérieure les reçoive en relançant ce script.
alter table public.items add column if not exists until_date date;
alter table public.items drop constraint if exists items_until_ok;
alter table public.items add constraint items_until_ok check (
  until_date is null or (recur <> 'none' and until_date >= start_date)
);

comment on table  public.items         is 'Semainier : créneaux bloqués et tâches, avec leur règle de récurrence.';
comment on column public.items.days    is 'Récurrence hebdo : jours actifs, 0 = lundi … 6 = dimanche.';
comment on column public.items.until_date is 'Dernier jour d''une série (compris). Vide : la série n''a pas de fin.';
comment on column public.items.done    is 'Occurrences cochées : { "AAAA-MM-JJ": true }. Tâche ponctuelle, ou dernier jour d''une série courte : le jour où elle a été faite.';
comment on column public.items.skipped is 'Occurrences retirées de la série : { "AAAA-MM-JJ": true }.';

create index if not exists items_user_id_idx on public.items (user_id);

-- ----------------------------------------------------------- updated_at
-- Une seule fonction pour les deux tables : la date de modification est posée par la base.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();

-- Ancienne fonction propre à items, remplacée par la fonction commune ci-dessus.
drop function if exists public.items_touch_updated_at();

-- -------------------------------------------------- Row Level Security
-- Chaque utilisateur ne voit et ne modifie que ses propres lignes.
alter table public.items enable row level security;

drop policy if exists "items: lecture de ses lignes"      on public.items;
drop policy if exists "items: création de ses lignes"     on public.items;
drop policy if exists "items: modification de ses lignes" on public.items;
drop policy if exists "items: suppression de ses lignes"  on public.items;

create policy "items: lecture de ses lignes" on public.items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "items: création de ses lignes" on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "items: modification de ses lignes" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "items: suppression de ses lignes" on public.items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Les visiteurs non connectés n'ont aucun droit sur la table.
revoke all on public.items from anon;
grant select, insert, update, delete on public.items to authenticated;

-- ============================================================ Réglages
-- Une ligne par utilisateur : noms des catégories (couleurs), synchronisés entre appareils.
create table if not exists public.settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  cat_labels  jsonb not null default '{}'::jsonb
              check (jsonb_typeof(cat_labels) = 'object' and pg_column_size(cat_labels) < 4096),
  updated_at  timestamptz not null default now()
);

comment on table public.settings is 'Semainier : réglages synchronisés de chaque utilisateur.';
comment on column public.settings.cat_labels is 'Nom de chaque couleur : { "bleu": "Travail", … }.';

drop trigger if exists settings_touch_updated_at on public.settings;
create trigger settings_touch_updated_at
  before update on public.settings
  for each row execute function public.touch_updated_at();

alter table public.settings enable row level security;

drop policy if exists "settings: lecture de sa ligne"      on public.settings;
drop policy if exists "settings: création de sa ligne"     on public.settings;
drop policy if exists "settings: modification de sa ligne" on public.settings;
drop policy if exists "settings: suppression de sa ligne"  on public.settings;

create policy "settings: lecture de sa ligne" on public.settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "settings: création de sa ligne" on public.settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "settings: modification de sa ligne" on public.settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "settings: suppression de sa ligne" on public.settings
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.settings from anon;
grant select, insert, update, delete on public.settings to authenticated;

-- ============================================ Double authentification
-- 2FA optionnelle, imposée par la base : si l'utilisateur a activé un facteur TOTP vérifié,
-- toute requête doit provenir d'une session qui a validé le code (claim JWT aal = 'aal2').
-- Sans facteur actif, rien ne change. Politiques RESTRICTIVES : elles s'ajoutent (ET logique)
-- aux politiques ci-dessus, qu'elles ne peuvent jamais élargir.

-- Schéma non exposé par l'API REST de Supabase (seul « public » l'est).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- SECURITY DEFINER : lit auth.mfa_factors avec les droits du propriétaire, sans dépendre
-- des droits accordés au rôle « authenticated » sur le schéma auth. search_path vide :
-- aucune résolution de nom détournable.
create or replace function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified'
    )
    then coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    else true
  end;
$$;

revoke all on function private.mfa_satisfied() from public, anon;
grant execute on function private.mfa_satisfied() to authenticated;

drop policy if exists "items: 2FA exigée si activée" on public.items;
create policy "items: 2FA exigée si activée" on public.items
  as restrictive
  for all to authenticated
  using ((select private.mfa_satisfied()))
  with check ((select private.mfa_satisfied()));

drop policy if exists "settings: 2FA exigée si activée" on public.settings;
create policy "settings: 2FA exigée si activée" on public.settings
  as restrictive
  for all to authenticated
  using ((select private.mfa_satisfied()))
  with check ((select private.mfa_satisfied()));
