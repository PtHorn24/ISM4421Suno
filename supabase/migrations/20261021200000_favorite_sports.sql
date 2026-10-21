-- Owls Gameday: each user's favorite FAU sports (shown first on their dashboard).
-- Short sport keys used by the app: football, mbb, wbb, vb.

alter table public.profiles
  add column favorite_sports text[] not null default '{}'
    check (favorite_sports <@ array['football', 'mbb', 'wbb', 'vb']::text[]);

comment on column public.profiles.favorite_sports is 'FAU sports this user follows (football, mbb, wbb, vb).';
