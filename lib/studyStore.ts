import { supabase } from "./supabase";
import type { Question } from "../data/questions";

export type Confidence = "confident" | "unsure" | "unknown";

export type Attempt = {
  clientId: string;
  questionId: string;
  correct: boolean;
  confidence: Confidence;
  answeredAt: string;
};

export type CloudStudyData = {
  attempts: Attempt[];
  bookmarks: string[];
  customQuestions: Question[];
};

function client() {
  if (!supabase) throw new Error("Supabaseが設定されていません。");
  return supabase;
}

export async function loadCloudStudyData(): Promise<CloudStudyData> {
  const db = client();
  const [attemptsResult, bookmarksResult, customResult] = await Promise.all([
    db
      .from("study_attempts")
      .select("client_id, question_id, correct, confidence, answered_at")
      .order("answered_at", { ascending: true }),
    db.from("study_bookmarks").select("question_id"),
    db.from("study_custom_questions").select("question_id, question_data"),
  ]);

  const firstError = attemptsResult.error || bookmarksResult.error || customResult.error;
  if (firstError) throw firstError;

  return {
    attempts: (attemptsResult.data ?? []).map((row) => ({
      clientId: row.client_id,
      questionId: row.question_id,
      correct: row.correct,
      confidence: row.confidence as Confidence,
      answeredAt: row.answered_at,
    })),
    bookmarks: (bookmarksResult.data ?? []).map((row) => row.question_id),
    customQuestions: (customResult.data ?? []).map((row) => row.question_data as Question),
  };
}

export async function saveAttempt(userId: string, attempt: Attempt) {
  const { error } = await client().from("study_attempts").upsert(
    {
      user_id: userId,
      client_id: attempt.clientId,
      question_id: attempt.questionId,
      correct: attempt.correct,
      confidence: attempt.confidence,
      answered_at: attempt.answeredAt,
    },
    { onConflict: "user_id,client_id" },
  );
  if (error) throw error;
}

export async function saveBookmark(userId: string, questionId: string, enabled: boolean) {
  const db = client();
  if (enabled) {
    const { error } = await db.from("study_bookmarks").upsert(
      { user_id: userId, question_id: questionId },
      { onConflict: "user_id,question_id" },
    );
    if (error) throw error;
    return;
  }

  const { error } = await db
    .from("study_bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("question_id", questionId);
  if (error) throw error;
}

export async function upsertCustomQuestions(userId: string, questions: Question[]) {
  if (!questions.length) return;
  const { error } = await client().from("study_custom_questions").upsert(
    questions.map((question) => ({
      user_id: userId,
      question_id: question.id,
      question_data: question,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,question_id" },
  );
  if (error) throw error;
}

export async function deleteAllCustomQuestions(userId: string) {
  const { error } = await client().from("study_custom_questions").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function resetCloudProgress(userId: string) {
  const db = client();
  const [attemptsResult, bookmarksResult] = await Promise.all([
    db.from("study_attempts").delete().eq("user_id", userId),
    db.from("study_bookmarks").delete().eq("user_id", userId),
  ]);
  const firstError = attemptsResult.error || bookmarksResult.error;
  if (firstError) throw firstError;
}

export async function migrateLocalStudyData(
  userId: string,
  attempts: Attempt[],
  bookmarks: string[],
  customQuestions: Question[],
) {
  const db = client();

  if (attempts.length) {
    const { error } = await db.from("study_attempts").upsert(
      attempts.map((attempt) => ({
        user_id: userId,
        client_id: attempt.clientId,
        question_id: attempt.questionId,
        correct: attempt.correct,
        confidence: attempt.confidence,
        answered_at: attempt.answeredAt,
      })),
      { onConflict: "user_id,client_id" },
    );
    if (error) throw error;
  }

  if (bookmarks.length) {
    const { error } = await db.from("study_bookmarks").upsert(
      bookmarks.map((questionId) => ({ user_id: userId, question_id: questionId })),
      { onConflict: "user_id,question_id" },
    );
    if (error) throw error;
  }

  if (customQuestions.length) {
    const { error } = await db.from("study_custom_questions").upsert(
      customQuestions.map((question) => ({
        user_id: userId,
        question_id: question.id,
        question_data: question,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,question_id" },
    );
    if (error) throw error;
  }
}
