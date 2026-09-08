-- ST A-1 Trainer V3: 学習履歴同期用テーブル + RLS
-- Supabase Dashboard -> SQL Editor でこのファイル全体を1回実行してください。

create table if not exists public.study_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  question_id text not null,
  correct boolean not null,
  confidence text not null check (confidence in ('confident', 'unsure', 'unknown')),
  answered_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create index if not exists study_attempts_user_answered_idx
  on public.study_attempts (user_id, answered_at desc);
create index if not exists study_attempts_user_question_idx
  on public.study_attempts (user_id, question_id);

create table if not exists public.study_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.study_custom_questions (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  question_data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.study_attempts enable row level security;
alter table public.study_bookmarks enable row level security;
alter table public.study_custom_questions enable row level security;

revoke all on table public.study_attempts from anon, authenticated;
revoke all on table public.study_bookmarks from anon, authenticated;
revoke all on table public.study_custom_questions from anon, authenticated;

grant select, insert, update, delete on table public.study_attempts to authenticated;
grant select, insert, update, delete on table public.study_bookmarks to authenticated;
grant select, insert, update, delete on table public.study_custom_questions to authenticated;

-- study_attempts
DROP POLICY IF EXISTS "study_attempts_select_own" ON public.study_attempts;
CREATE POLICY "study_attempts_select_own"
  ON public.study_attempts FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_attempts_insert_own" ON public.study_attempts;
CREATE POLICY "study_attempts_insert_own"
  ON public.study_attempts FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_attempts_update_own" ON public.study_attempts;
CREATE POLICY "study_attempts_update_own"
  ON public.study_attempts FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_attempts_delete_own" ON public.study_attempts;
CREATE POLICY "study_attempts_delete_own"
  ON public.study_attempts FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- study_bookmarks
DROP POLICY IF EXISTS "study_bookmarks_select_own" ON public.study_bookmarks;
CREATE POLICY "study_bookmarks_select_own"
  ON public.study_bookmarks FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_bookmarks_insert_own" ON public.study_bookmarks;
CREATE POLICY "study_bookmarks_insert_own"
  ON public.study_bookmarks FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_bookmarks_update_own" ON public.study_bookmarks;
CREATE POLICY "study_bookmarks_update_own"
  ON public.study_bookmarks FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_bookmarks_delete_own" ON public.study_bookmarks;
CREATE POLICY "study_bookmarks_delete_own"
  ON public.study_bookmarks FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- study_custom_questions
DROP POLICY IF EXISTS "study_custom_questions_select_own" ON public.study_custom_questions;
CREATE POLICY "study_custom_questions_select_own"
  ON public.study_custom_questions FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_custom_questions_insert_own" ON public.study_custom_questions;
CREATE POLICY "study_custom_questions_insert_own"
  ON public.study_custom_questions FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_custom_questions_update_own" ON public.study_custom_questions;
CREATE POLICY "study_custom_questions_update_own"
  ON public.study_custom_questions FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_custom_questions_delete_own" ON public.study_custom_questions;
CREATE POLICY "study_custom_questions_delete_own"
  ON public.study_custom_questions FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- V4.1 B-1記述トレーナー
create table if not exists public.study_b1_practices (
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_year text not null,
  question_number integer not null check (question_number between 1 and 3),
  answer_text text not null default '',
  self_rating text not null default 'unrated' check (self_rating in ('unrated', 'good', 'partial', 'redo')),
  memo text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, exam_year, question_number)
);
create index if not exists study_b1_practices_user_updated_idx on public.study_b1_practices (user_id, updated_at desc);
alter table public.study_b1_practices enable row level security;
revoke all on table public.study_b1_practices from anon, authenticated;
grant select, insert, update, delete on table public.study_b1_practices to authenticated;
DROP POLICY IF EXISTS "study_b1_practices_select_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_select_own" ON public.study_b1_practices FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "study_b1_practices_insert_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_insert_own" ON public.study_b1_practices FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "study_b1_practices_update_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_update_own" ON public.study_b1_practices FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "study_b1_practices_delete_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_delete_own" ON public.study_b1_practices FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);
