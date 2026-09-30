-- Math AI V0.23
-- Cloud learning archive.
-- The Worker uses a server-side Supabase secret key.
-- The client never receives a Supabase key.

create table if not exists public.math_ai_learners (
  learner_id text primary key,
  archive_version text not null default 'V0.23.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.math_ai_learning_events (
  learner_id text not null references public.math_ai_learners(learner_id) on delete cascade,
  event_id text not null,
  occurred_at timestamptz not null,
  source text not null,
  event_type text not null,
  schema_version text not null,
  raw_payload jsonb not null,
  normalized_event jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (learner_id, event_id)
);

create index if not exists math_ai_learning_events_learner_occurred_idx
  on public.math_ai_learning_events (learner_id, occurred_at);

create index if not exists math_ai_learning_events_learner_source_idx
  on public.math_ai_learning_events (learner_id, source);

alter table public.math_ai_learners enable row level security;
alter table public.math_ai_learning_events enable row level security;

-- V0.23 intentionally exposes no client-facing policies.
-- All reads/writes go through the Cloudflare Worker.
revoke all on table public.math_ai_learners from anon, authenticated;
revoke all on table public.math_ai_learning_events from anon, authenticated;

grant select, insert, update, delete on table public.math_ai_learners to service_role;
grant select, insert, update, delete on table public.math_ai_learning_events to service_role;

create or replace function public.math_ai_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists math_ai_learners_touch_updated_at
  on public.math_ai_learners;

create trigger math_ai_learners_touch_updated_at
before update on public.math_ai_learners
for each row
execute function public.math_ai_touch_updated_at();

drop trigger if exists math_ai_learning_events_touch_updated_at
  on public.math_ai_learning_events;

create trigger math_ai_learning_events_touch_updated_at
before update on public.math_ai_learning_events
for each row
execute function public.math_ai_touch_updated_at();
