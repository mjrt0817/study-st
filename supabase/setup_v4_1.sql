-- V4.1 B-1記述トレーナー用の追加テーブル
-- 既存の setup.sql を実行済みの場合は、このファイルだけを1回実行してください。

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

create index if not exists study_b1_practices_user_updated_idx
  on public.study_b1_practices (user_id, updated_at desc);

alter table public.study_b1_practices enable row level security;
revoke all on table public.study_b1_practices from anon, authenticated;
grant select, insert, update, delete on table public.study_b1_practices to authenticated;

DROP POLICY IF EXISTS "study_b1_practices_select_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_select_own"
  ON public.study_b1_practices FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_b1_practices_insert_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_insert_own"
  ON public.study_b1_practices FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_b1_practices_update_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_update_own"
  ON public.study_b1_practices FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "study_b1_practices_delete_own" ON public.study_b1_practices;
CREATE POLICY "study_b1_practices_delete_own"
  ON public.study_b1_practices FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
