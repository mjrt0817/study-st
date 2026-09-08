"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Question, seedQuestions } from "../data/questions";
import type { OfficialA1Question, OfficialA1Year } from "../data/officialA1";
import { officialA1AllQuestions, officialA1Sets } from "../data/officialA1";
import type { OfficialA2Question, OfficialA2Year } from "../data/officialA2";
import { officialA2AllQuestions, officialA2Sets } from "../data/officialA2";
import type { OfficialB1Year } from "../data/officialB1";
import { officialB1Sets, officialB1Years } from "../data/officialB1";
import { supabase, supabaseConfigured } from "../lib/supabase";
import {
  Attempt,
  B1Practice,
  B1SelfRating,
  Confidence,
  deleteAllCustomQuestions,
  deleteAllB1Practices,
  loadB1Practices,
  loadCloudStudyData,
  migrateLocalStudyData,
  resetCloudProgress,
  saveAttempt,
  saveAttempts,
  saveB1Practice,
  saveBookmark,
  upsertCustomQuestions,
} from "../lib/studyStore";

type Mode = "home" | "quiz" | "result" | "stats" | "manage" | "official" | "officialResult" | "review" | "reviewResult" | "b1";
type QuizKind = "random" | "mock" | "weak" | "wrong" | "category";
type ReviewKind = "recommended" | "wrong" | "unsure" | "unknown" | "category";
type OfficialExam = "A-1" | "A-2";
type OfficialYear = OfficialA1Year | OfficialA2Year;
type OfficialQuestion = OfficialA1Question | OfficialA2Question;
type SyncState = "idle" | "loading" | "synced" | "error";
const OFFICIAL_YEARS: OfficialYear[] = ["2025", "2024", "2023", "2022", "2021"];

const ATTEMPTS_KEY = "st-a1-attempts-v2";
const BOOKMARKS_KEY = "st-a1-bookmarks-v2";
const CUSTOM_KEY = "st-a1-custom-questions-v2";
const LEGACY_ATTEMPTS_KEY = "st-a1-attempts-v1";
const LEGACY_BOOKMARKS_KEY = "st-a1-bookmarks-v1";
const LEGACY_CUSTOM_KEY = "st-a1-custom-questions-v1";

function storageKey(base: string, userId: string) {
  return `${base}:${userId}`;
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function accuracy(items: Attempt[]) {
  if (!items.length) return null;
  return Math.round((items.filter((x) => x.correct).length / items.length) * 100);
}

function safeParseArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function newClientId() {
  return crypto.randomUUID();
}

function normalizeLocalAttempts(raw: Array<Partial<Attempt> & { questionId?: string }>): Attempt[] {
  return raw
    .filter((item) => item.questionId && typeof item.correct === "boolean" && item.answeredAt)
    .map((item) => ({
      clientId: item.clientId || newClientId(),
      questionId: item.questionId!,
      correct: Boolean(item.correct),
      confidence: (item.confidence === "confident" || item.confidence === "unknown" ? item.confidence : "unsure") as Confidence,
      answeredAt: item.answeredAt!,
    }));
}

function readLocalMigrationData(userId: string) {
  const attemptsKey = storageKey(ATTEMPTS_KEY, userId);
  const bookmarksKey = storageKey(BOOKMARKS_KEY, userId);
  const customKey = storageKey(CUSTOM_KEY, userId);

  const namespacedAttempts = safeParseArray<Partial<Attempt>>(localStorage.getItem(attemptsKey));
  const legacyAttempts = namespacedAttempts.length ? [] : safeParseArray<Partial<Attempt>>(localStorage.getItem(LEGACY_ATTEMPTS_KEY));
  const attempts = normalizeLocalAttempts([...namespacedAttempts, ...legacyAttempts]);

  // clientIdを付与した状態で一時保存。通信失敗後の再試行でも同じ行にupsertできるようにする。
  if (attempts.length) localStorage.setItem(attemptsKey, JSON.stringify(attempts));

  const namespacedBookmarks = safeParseArray<string>(localStorage.getItem(bookmarksKey));
  const bookmarks = namespacedBookmarks.length
    ? namespacedBookmarks
    : safeParseArray<string>(localStorage.getItem(LEGACY_BOOKMARKS_KEY));

  const namespacedCustom = safeParseArray<Question>(localStorage.getItem(customKey));
  const customQuestions = namespacedCustom.length
    ? namespacedCustom
    : safeParseArray<Question>(localStorage.getItem(LEGACY_CUSTOM_KEY));

  return { attempts, bookmarks: Array.from(new Set(bookmarks)), customQuestions };
}

function clearMigratedLocalData(userId: string) {
  localStorage.removeItem(storageKey(ATTEMPTS_KEY, userId));
  localStorage.removeItem(storageKey(BOOKMARKS_KEY, userId));
  localStorage.removeItem(storageKey(CUSTOM_KEY, userId));
  localStorage.removeItem(LEGACY_ATTEMPTS_KEY);
  localStorage.removeItem(LEGACY_BOOKMARKS_KEY);
  localStorage.removeItem(LEGACY_CUSTOM_KEY);
}

function dbSetupHint(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  if (message.includes("study_attempts") || message.includes("relation") || message.includes("schema cache")) {
    return "Supabaseの学習テーブルが未作成の可能性があります。supabase/setup.sql をSQL Editorで実行してください。";
  }
  return `Supabase同期に失敗しました：${message || "接続状態を確認してください。"}`;
}

type OfficialMetrics = {
  latest: Map<string, Attempt>;
  currentAccuracy: number | null;
  answeredCount: number;
  wrongCount: number;
  unsureCount: number;
  unknownCount: number;
  reviewIds: Set<string>;
  weakCategories: { name: string; accuracy: number; count: number }[];
  recommended: OfficialQuestion[];
};

function computeOfficialMetrics(attempts: Attempt[], questions: OfficialQuestion[]): OfficialMetrics {
  const ids = new Set(questions.map((q) => q.id));
  const latest = new Map<string, Attempt>();
  attempts.forEach((attempt) => { if (ids.has(attempt.questionId)) latest.set(attempt.questionId, attempt); });
  const current = Array.from(latest.values());
  const reviewIds = new Set<string>();
  latest.forEach((attempt, id) => { if (!attempt.correct || attempt.confidence !== "confident") reviewIds.add(id); });

  const groups = new Map<string, Attempt[]>();
  questions.forEach((q) => {
    const attempt = latest.get(q.id);
    if (!attempt) return;
    groups.set(q.category, [...(groups.get(q.category) || []), attempt]);
  });
  const weakCategories = Array.from(groups.entries())
    .map(([name, list]) => ({ name, accuracy: accuracy(list) ?? 0, count: list.length }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  const weakNames = new Set(weakCategories.map((x) => x.name));
  const scored = questions
    .map((q) => {
      const attempt = latest.get(q.id);
      if (!attempt) return { q, score: weakNames.has(q.category) ? 1 : 0, answeredAt: "" };
      let score = 0;
      if (!attempt.correct) score += 5;
      if (attempt.confidence === "unknown") score += 4;
      else if (attempt.confidence === "unsure") score += 2;
      if (weakNames.has(q.category)) score += 2;
      return { q, score, answeredAt: attempt.answeredAt };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.answeredAt.localeCompare(a.answeredAt));
  const primary = scored.map((item) => item.q);
  let recommended = primary.slice(0, 10);
  if (recommended.length < 10) {
    const selected = new Set(primary.map((q) => q.id));
    const fallback = questions.filter((q) => !selected.has(q.id) && !latest.has(q.id));
    recommended = [...primary, ...shuffle(fallback)].slice(0, 10);
  }

  return {
    latest, currentAccuracy: accuracy(current), answeredCount: latest.size,
    wrongCount: current.filter((a) => !a.correct).length,
    unsureCount: current.filter((a) => a.confidence === "unsure").length,
    unknownCount: current.filter((a) => a.confidence === "unknown").length,
    reviewIds, weakCategories, recommended,
  };
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [mode, setMode] = useState<Mode>("home");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [customQuestions, setCustomQuestions] = useState<Question[]>([]);
  const [quiz, setQuiz] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("unsure");
  const [sessionAnswers, setSessionAnswers] = useState<{ id: string; correct: boolean }[]>([]);
  const [message, setMessage] = useState("");
  const [officialExam, setOfficialExam] = useState<OfficialExam>("A-1");
  const [officialYear, setOfficialYear] = useState<OfficialYear>("2025");
  const [officialIndex, setOfficialIndex] = useState(0);
  const [officialSelections, setOfficialSelections] = useState<Record<string, { selected: number; confidence: Confidence }>>({});
  const [reviewQuiz, setReviewQuiz] = useState<OfficialQuestion[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewSelected, setReviewSelected] = useState<number | null>(null);
  const [reviewConfidence, setReviewConfidence] = useState<Confidence>("unsure");
  const [reviewAnswered, setReviewAnswered] = useState(false);
  const [reviewSessionAnswers, setReviewSessionAnswers] = useState<{ id: string; correct: boolean }[]>([]);
  const [b1Practices, setB1Practices] = useState<B1Practice[]>([]);
  const [b1DbReady, setB1DbReady] = useState(false);
  const [b1Year, setB1Year] = useState<OfficialB1Year>("2025");
  const [b1QuestionNumber, setB1QuestionNumber] = useState<1 | 2 | 3>(1);
  const [b1AnswerText, setB1AnswerText] = useState("");
  const [b1Rating, setB1Rating] = useState<B1SelfRating>("unrated");
  const [b1Memo, setB1Memo] = useState("");
  const [b1ShowAnswer, setB1ShowAnswer] = useState(false);
  const [b1ShowCommentary, setB1ShowCommentary] = useState(false);
  const [b1View, setB1View] = useState<"problem" | "answer" | "split">("problem");
  const [b1SecondsLeft, setB1SecondsLeft] = useState(45 * 60);
  const [b1TimerRunning, setB1TimerRunning] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const syncFromCloud = useCallback(async (currentUser: User, announce = false) => {
    setDataLoading(true);
    setSyncState("loading");
    try {
      const local = readLocalMigrationData(currentUser.id);
      const hasLocal = Boolean(local.attempts.length || local.bookmarks.length || local.customQuestions.length);

      if (hasLocal) {
        await migrateLocalStudyData(currentUser.id, local.attempts, local.bookmarks, local.customQuestions);
        clearMigratedLocalData(currentUser.id);
      }

      const cloud = await loadCloudStudyData();
      setAttempts(cloud.attempts);
      setBookmarks(cloud.bookmarks);
      setCustomQuestions(cloud.customQuestions);
      try {
        const b1 = await loadB1Practices();
        setB1Practices(b1);
        setB1DbReady(true);
      } catch (b1Error) {
        console.warn("B-1 practice table is not ready", b1Error);
        setB1Practices([]);
        setB1DbReady(false);
      }
      setSyncState("synced");
      if (hasLocal) setMessage("この端末の旧学習データをSupabaseへ移行しました。");
      else if (announce) setMessage("Supabaseから最新の学習履歴を読み込みました。");
    } catch (error) {
      console.error(error);
      setAttempts([]);
      setBookmarks([]);
      setCustomQuestions([]);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setAttempts([]);
      setBookmarks([]);
      setCustomQuestions([]);
      setB1Practices([]);
      setB1DbReady(false);
      setSyncState("idle");
      return;
    }
    void syncFromCloud(user);
  }, [user, syncFromCloud]);

  const allQuestions = useMemo(() => [...seedQuestions, ...customQuestions], [customQuestions]);
  const categories = useMemo(() => Array.from(new Set(allQuestions.map((q) => q.category))).sort(), [allQuestions]);
  const statsQuestions = useMemo(() => [...allQuestions, ...officialA1AllQuestions, ...officialA2AllQuestions], [allQuestions]);
  const currentOfficialSet = officialExam === "A-1" ? officialA1Sets[officialYear] : officialA2Sets[officialYear];
  const currentOfficialQuestions: OfficialQuestion[] = currentOfficialSet.questions;
  const statCategories = useMemo(() => Array.from(new Set(statsQuestions.map((q) => q.category))).sort(), [statsQuestions]);
  const a1Metrics = useMemo(() => computeOfficialMetrics(attempts, officialA1AllQuestions), [attempts]);
  const a2Metrics = useMemo(() => computeOfficialMetrics(attempts, officialA2AllQuestions), [attempts]);
  const activeMetrics = officialExam === "A-1" ? a1Metrics : a2Metrics;
  const a2FrequentAreas = useMemo(() => {
    const counts = new Map<string, number>();
    officialA2AllQuestions.forEach((q) => counts.set(q.category, (counts.get(q.category) || 0) + 1));
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, []);
  const a2StudyStatus = a2Metrics.currentAccuracy === null
    ? { label: "未判定", detail: "まずA-2公式25問を1年度分解きましょう。", tone: "neutral" }
    : a2Metrics.currentAccuracy >= 80
      ? { label: "安定圏", detail: "現状は良好です。誤答と迷った問題の再確認を優先。", tone: "good" }
      : a2Metrics.currentAccuracy >= 65
        ? { label: "合格水準を意識", detail: "弱点TOP3を潰して正答率を安定させましょう。", tone: "warn" }
        : { label: "要補強", detail: "頻出領域と誤答を優先して基礎を固めましょう。", tone: "danger" };
  const b1Set = officialB1Sets[b1Year];
  const b1Question = b1Set.questions.find((q) => q.number === b1QuestionNumber) ?? b1Set.questions[0];
  const b1CurrentPractice = b1Practices.find((p) => p.year === b1Year && p.questionNumber === b1QuestionNumber);
  const latestOfficialAttempts = activeMetrics.latest;

  const totalAccuracy = accuracy(attempts);
  const unknownCount = attempts.filter((a) => a.confidence === "unknown").length;
  const wrongQuestionIds = useMemo(() => {
    const latest = new Map<string, Attempt>();
    attempts.forEach((a) => latest.set(a.questionId, a));
    return new Set(Array.from(latest.values()).filter((a) => !a.correct).map((a) => a.questionId));
  }, [attempts]);
  const localWrongQuestionIds = useMemo(() => {
    const localIds = new Set(allQuestions.map((q) => q.id));
    return new Set(Array.from(wrongQuestionIds).filter((id) => localIds.has(id)));
  }, [allQuestions, wrongQuestionIds]);

  const weakCategories = useMemo(() => {
    const map = new Map<string, Attempt[]>();
    for (const a of attempts) {
      const q = statsQuestions.find((x) => x.id === a.questionId);
      if (!q) continue;
      map.set(q.category, [...(map.get(q.category) || []), a]);
    }
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, accuracy: accuracy(list) ?? 0, count: list.length }))
      .filter((x) => x.count >= 2)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }, [attempts, statsQuestions]);

  useEffect(() => {
    if (!b1TimerRunning || mode !== "b1") return;
    const timer = window.setInterval(() => {
      setB1SecondsLeft((current) => {
        if (current <= 1) {
          setB1TimerRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [b1TimerRunning, mode]);

  useEffect(() => {
    if (mode !== "b1") return;
    setB1AnswerText(b1CurrentPractice?.answerText ?? "");
    setB1Rating(b1CurrentPractice?.selfRating ?? "unrated");
    setB1Memo(b1CurrentPractice?.memo ?? "");
    setB1ShowAnswer(false);
    setB1ShowCommentary(false);
    setB1View("problem");
    setB1SecondsLeft(45 * 60);
    setB1TimerRunning(false);
  }, [b1Year, b1QuestionNumber, mode, b1CurrentPractice?.updatedAt]);

  function openB1(year: OfficialB1Year = "2025", questionNumber: 1 | 2 | 3 = 1) {
    setB1Year(year);
    setB1QuestionNumber(questionNumber);
    setMessage("");
    setMode("b1");
  }

  async function saveCurrentB1Practice() {
    if (!user) return;
    if (!b1DbReady) {
      setMessage("B-1保存テーブルが未作成です。Supabase SQL Editorで supabase/setup_v4_1.sql を実行してください。");
      return;
    }
    const record: B1Practice = {
      year: b1Year,
      questionNumber: b1QuestionNumber,
      answerText: b1AnswerText,
      selfRating: b1Rating,
      memo: b1Memo,
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveB1Practice(user.id, record);
      setB1Practices((current) => [record, ...current.filter((p) => !(p.year === record.year && p.questionNumber === record.questionNumber))]);
      setMessage(`${b1Year}年度 B-1 問${b1QuestionNumber}の答案・自己評価を保存しました。`);
    } catch (error) {
      console.error(error);
      setB1DbReady(false);
      setMessage("B-1答案の保存に失敗しました。supabase/setup_v4_1.sql の実行とRLS設定を確認してください。");
    }
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setMessage(`Googleログインに失敗しました：${error.message}`);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMode("home");
    setMessage("");
  }

  function startQuiz(kind: QuizKind, selectedCategory?: string) {
    if (syncState === "error") {
      setMessage("Supabase同期を直してから学習を開始してください。学習履歴が保存されない状態での出題は停止しています。");
      return;
    }

    let pool = [...allQuestions];
    let count = 10;

    if (kind === "mock") count = 30;
    if (kind === "wrong") pool = pool.filter((q) => wrongQuestionIds.has(q.id));
    if (kind === "category" && selectedCategory) pool = pool.filter((q) => q.category === selectedCategory);
    if (kind === "weak") {
      const weakNames = new Set(weakCategories.map((x) => x.name));
      const unknownIds = new Set(attempts.filter((a) => a.confidence === "unknown").map((a) => a.questionId));
      const weakPool = pool.filter((q) => weakNames.has(q.category) || unknownIds.has(q.id) || wrongQuestionIds.has(q.id));
      if (weakPool.length) pool = weakPool;
    }

    if (!pool.length) {
      setMessage("対象問題がまだありません。まずランダム10問を解いて学習履歴を作ってください。");
      return;
    }

    const picked = shuffle(pool).slice(0, Math.min(count, pool.length));
    setQuiz(picked);
    setIndex(0);
    setSelected(null);
    setConfidence("unsure");
    setSessionAnswers([]);
    setMessage("");
    setMode("quiz");
  }

  async function submitAnswer() {
    if (selected === null || !user) return;
    const q = quiz[index];
    const correct = selected === q.answer;
    const nextAttempt: Attempt = {
      clientId: newClientId(),
      questionId: q.id,
      correct,
      confidence,
      answeredAt: new Date().toISOString(),
    };

    setAttempts((current) => [...current, nextAttempt]);
    setSessionAnswers((current) => [...current, { id: q.id, correct }]);
    setSyncState("loading");
    try {
      await saveAttempt(user.id, nextAttempt);
      setSyncState("synced");
    } catch (error) {
      console.error(error);
      setAttempts((current) => current.filter((a) => a.clientId !== nextAttempt.clientId));
      setSessionAnswers((current) => current.slice(0, -1));
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
  }

  function nextQuestion() {
    if (index + 1 >= quiz.length) {
      setMode("result");
      return;
    }
    setIndex((x) => x + 1);
    setSelected(null);
    setConfidence("unsure");
  }

  async function toggleBookmark(id: string) {
    if (!user) return;
    const enabled = !bookmarks.includes(id);
    const previous = bookmarks;
    const next = enabled ? [...bookmarks, id] : bookmarks.filter((x) => x !== id);
    setBookmarks(next);
    setSyncState("loading");
    try {
      await saveBookmark(user.id, id, enabled);
      setSyncState("synced");
    } catch (error) {
      console.error(error);
      setBookmarks(previous);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
  }

  function startOfficialExam(exam: OfficialExam, year: OfficialYear = officialYear) {
    setOfficialExam(exam);
    setOfficialYear(year);
    setOfficialIndex(0);
    setOfficialSelections({});
    setMessage("");
    setMode("official");
  }

  function setOfficialAnswer(questionId: string, selected?: number, nextConfidence?: Confidence) {
    setOfficialSelections((current) => {
      const previous = current[questionId];
      if (!previous && selected === undefined) return current;
      const base = previous ?? { selected: selected!, confidence: "unsure" as Confidence };
      return {
        ...current,
        [questionId]: {
          selected: selected ?? base.selected,
          confidence: nextConfidence ?? base.confidence,
        },
      };
    });
  }

  async function finishOfficialExam() {
    if (!user) return;
    const unanswered = currentOfficialQuestions.filter((q) => officialSelections[q.id] === undefined);
    if (unanswered.length) {
      setMessage(`未回答が${unanswered.length}問あります。問${unanswered[0].number}から確認してください。`);
      setOfficialIndex(unanswered[0].number - 1);
      return;
    }

    const answeredAt = new Date().toISOString();
    const newAttempts: Attempt[] = currentOfficialQuestions.map((q) => ({
      clientId: newClientId(),
      questionId: q.id,
      correct: officialSelections[q.id].selected === q.answer,
      confidence: officialSelections[q.id].confidence,
      answeredAt,
    }));

    setSyncState("loading");
    try {
      await saveAttempts(user.id, newAttempts);
      setAttempts((current) => [...current, ...newAttempts]);
      setSyncState("synced");
      setMessage(`${officialYear}年度${officialExam}公式過去問の結果をSupabaseへ保存しました。`);
      setMode("officialResult");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
  }

  function startOfficialReview(exam: OfficialExam, kind: ReviewKind, category?: string) {
    setOfficialExam(exam);
    if (syncState === "error") {
      setMessage("Supabase同期を直してから復習を開始してください。");
      return;
    }

    const questionPool: OfficialQuestion[] = exam === "A-1" ? officialA1AllQuestions : officialA2AllQuestions;
    const metrics = exam === "A-1" ? a1Metrics : a2Metrics;
    let pool: OfficialQuestion[] = [];
    if (kind === "recommended") {
      pool = [...metrics.recommended];
    } else if (kind === "wrong") {
      pool = questionPool.filter((q) => {
        const attempt = metrics.latest.get(q.id);
        return attempt && !attempt.correct;
      });
    } else if (kind === "unsure") {
      pool = questionPool.filter((q) => metrics.latest.get(q.id)?.confidence === "unsure");
    } else if (kind === "unknown") {
      pool = questionPool.filter((q) => metrics.latest.get(q.id)?.confidence === "unknown");
    } else if (kind === "category" && category) {
      pool = questionPool.filter((q) => q.category === category);
    }

    if (!pool.length) {
      setMessage(kind === "recommended"
        ? "おすすめ復習を作るには、まず公式過去問を1セット解いて学習履歴を作ってください。"
        : "この条件に該当する公式問題はまだありません。");
      return;
    }

    const picked = kind === "recommended" ? pool : shuffle(pool).slice(0, Math.min(10, pool.length));
    setReviewQuiz(picked);
    setReviewIndex(0);
    setReviewSelected(null);
    setReviewConfidence("unsure");
    setReviewAnswered(false);
    setReviewSessionAnswers([]);
    setMessage("");
    setMode("review");
  }

  async function submitReviewAnswer() {
    if (!user || reviewSelected === null) return;
    const q = reviewQuiz[reviewIndex];
    const correct = reviewSelected === q.answer;
    const nextAttempt: Attempt = {
      clientId: newClientId(),
      questionId: q.id,
      correct,
      confidence: reviewConfidence,
      answeredAt: new Date().toISOString(),
    };

    setSyncState("loading");
    try {
      await saveAttempt(user.id, nextAttempt);
      setAttempts((current) => [...current, nextAttempt]);
      setReviewSessionAnswers((current) => [...current, { id: q.id, correct }]);
      setReviewAnswered(true);
      setSyncState("synced");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
  }

  function nextReviewQuestion() {
    if (reviewIndex + 1 >= reviewQuiz.length) {
      setMode("reviewResult");
      return;
    }
    setReviewIndex((x) => x + 1);
    setReviewSelected(null);
    setReviewConfidence("unsure");
    setReviewAnswered(false);
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error("配列ではありません");
        const normalized: Question[] = parsed.map((q, i) => {
          if (!q.id || !q.question || !Array.isArray(q.choices) || q.choices.length !== 4 || typeof q.answer !== "number") {
            throw new Error(`${i + 1}件目の形式が不正です`);
          }
          return q as Question;
        });
        const seedIds = new Set(seedQuestions.map((q) => q.id));
        const importable = normalized.filter((q) => !seedIds.has(q.id));
        const merged = [...customQuestions.filter((q) => !importable.some((n) => n.id === q.id)), ...importable];

        setSyncState("loading");
        await upsertCustomQuestions(user.id, importable);
        setCustomQuestions(merged);
        setSyncState("synced");
        setMessage(`${importable.length}問をSupabaseへ読み込みました。`);
      } catch (error) {
        console.error(error);
        setSyncState("error");
        setMessage(`読み込みに失敗しました：${error instanceof Error ? error.message : "形式を確認してください"}`);
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function resetProgress() {
    if (!user || !confirm("Supabase上のA-1/A-2解答履歴・ブックマーク・B-1記述履歴を削除します。よろしいですか？")) return;
    setSyncState("loading");
    try {
      await resetCloudProgress(user.id);
      if (b1DbReady) await deleteAllB1Practices(user.id);
      setAttempts([]);
      setBookmarks([]);
      setB1Practices([]);
      setSyncState("synced");
      setMessage("Supabase上の学習履歴をリセットしました。");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
  }

  async function removeCustomQuestions() {
    if (!user || !confirm("Supabase上の追加問題データを全て削除しますか？")) return;
    setSyncState("loading");
    try {
      await deleteAllCustomQuestions(user.id);
      setCustomQuestions([]);
      setSyncState("synced");
      setMessage("追加問題を削除しました。");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
  }

  if (!supabaseConfigured) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-mark">ST</div>
          <h1>Google認証の設定が必要です</h1>
          <p>Vercelまたは <code>.env.local</code> にSupabaseの接続情報を設定してください。</p>
          <div className="env-list">
            <code>NEXT_PUBLIC_SUPABASE_URL</code>
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
          </div>
          <p className="auth-note">詳しい手順はREADMEを参照してください。</p>
        </section>
      </main>
    );
  }

  if (authLoading || (user && dataLoading)) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-mark">ST</div>
          <h1>{authLoading ? "認証状態を確認しています" : "学習履歴を同期しています"}</h1>
          <p>{authLoading ? "Googleログイン情報を確認しています。" : "Supabaseから解答履歴・ブックマークを読み込んでいます。"}</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-mark">ST</div>
          <div className="eyebrow auth-eyebrow">IT STRATEGIST 2026</div>
          <h1>科目A-1 / A-2 / B-1 トレーナー</h1>
          <p>選択問題の履歴とB-1記述答案をSupabaseに保存します。Googleアカウントでログインすると、PCとスマホで同じ進捗を利用できます。</p>
          {message && <div className="notice">{message}</div>}
          <button className="google-button" onClick={signInWithGoogle}>
            <span className="google-g">G</span> Googleでログイン
          </button>
          <p className="auth-note">未ログイン状態では学習データを読み書きしません。</p>
        </section>
      </main>
    );
  }

  if (mode === "quiz" && quiz.length) {
    const q = quiz[index];
    const answered = sessionAnswers.some((a) => a.id === q.id);
    const isCorrect = selected === q.answer;

    return (
      <main className="app-shell">
        <header className="topbar">
          <button className="text-button" onClick={() => setMode("home")}>← 終了</button>
          <div className="progress-text">{index + 1} / {quiz.length}</div>
          <button className={`bookmark ${bookmarks.includes(q.id) ? "active" : ""}`} onClick={() => void toggleBookmark(q.id)}>
            {bookmarks.includes(q.id) ? "★" : "☆"}
          </button>
        </header>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${((index + 1) / quiz.length) * 100}%` }} /></div>

        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}
        <section className="quiz-card">
          <div className="badges">
            <span className="badge">{q.category}</span>
            {q.subcategory && <span className="badge muted">{q.subcategory}</span>}
          </div>
          <h1 className="question">{q.question}</h1>
          {q.imageUrl && <img className="question-image" src={q.imageUrl} alt="問題図" />}

          <div className="choices">
            {q.choices.map((choice, i) => {
              let className = "choice";
              if (selected === i) className += " selected";
              if (answered && i === q.answer) className += " correct";
              if (answered && selected === i && i !== q.answer) className += " wrong";
              return (
                <button key={i} className={className} onClick={() => !answered && setSelected(i)} disabled={answered}>
                  <span className="choice-key">{["ア", "イ", "ウ", "エ"][i]}</span>
                  <span>{choice}</span>
                </button>
              );
            })}
          </div>

          {!answered ? (
            <>
              <div className="confidence-box">
                <span>この問題の感触</span>
                <div className="confidence-buttons">
                  <button className={confidence === "confident" ? "active" : ""} onClick={() => setConfidence("confident")}>自信あり</button>
                  <button className={confidence === "unsure" ? "active" : ""} onClick={() => setConfidence("unsure")}>迷った</button>
                  <button className={confidence === "unknown" ? "active" : ""} onClick={() => setConfidence("unknown")}>知らなかった</button>
                </div>
              </div>
              <button className="primary large" disabled={selected === null || syncState === "loading"} onClick={() => void submitAnswer()}>
                {syncState === "loading" ? "保存中…" : "回答する"}
              </button>
            </>
          ) : (
            <div className={`explanation ${isCorrect ? "ok" : "ng"}`}>
              <h2>{isCorrect ? "○ 正解" : "× 不正解"}</h2>
              <p>{q.explanation}</p>
              <div className="source">出典：{q.source}</div>
              {q.sourceUrl && <a href={q.sourceUrl} target="_blank" rel="noreferrer">出典ページを開く ↗</a>}
              <button className="primary large" onClick={nextQuestion}>{index + 1 >= quiz.length ? "結果を見る" : "次の問題"}</button>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (mode === "review") {
    const q = reviewQuiz[reviewIndex];
    if (!q) return null;
    const reviewExam: OfficialExam = q.exam === "A-2" ? "A-2" : "A-1";
    const set = reviewExam === "A-1" ? officialA1Sets[q.year] : officialA2Sets[q.year];
    const pdfSrc = `/api/official-pdf?exam=${reviewExam === "A-1" ? "a1" : "a2"}&year=${q.year}#page=${q.pdfPage}&view=FitH`;
    const latest = latestOfficialAttempts.get(q.id);
    const reviewCorrect = reviewSelected === q.answer;

    return (
      <main className="app-shell official-shell">
        <header className="topbar">
          <button className="text-button" onClick={() => setMode("home")}>← 終了</button>
          <div className="progress-text">{reviewExam} 年度横断復習　{reviewIndex + 1} / {reviewQuiz.length}</div>
          <a className="secondary small pdf-link-button" href={`${set.pdfUrl}#page=${q.pdfPage}`} target="_blank" rel="noreferrer">PDFを別タブで開く ↗</a>
        </header>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${((reviewIndex + (reviewAnswered ? 1 : 0)) / reviewQuiz.length) * 100}%` }} /></div>
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}

        <section className="official-layout">
          <div className="official-pdf-panel">
            <iframe key={pdfSrc} src={pdfSrc} title={`IPA公式 ${q.year}年度 ${reviewExam} 問${q.number}`} />
            <p>{q.year}年度 問{q.number}（PDF {q.pdfPage}ページ）を確認して解答してください。</p>
          </div>
          <aside className="official-answer-panel review-answer-panel">
            <div className="official-question-heading">
              <span>{set.shortLabel} / {q.category} / {q.subcategory}</span>
              <strong>問{q.number}</strong>
            </div>
            {latest && (
              <div className="previous-status">
                <span>前回：{latest.correct ? "○ 正解" : "× 不正解"}</span>
                <span>{latest.confidence === "confident" ? "自信あり" : latest.confidence === "unknown" ? "知らなかった" : "迷った"}</span>
              </div>
            )}

            <div className="official-choice-grid">
              {[0, 1, 2, 3].map((choice) => {
                let className = reviewSelected === choice ? "selected" : "";
                if (reviewAnswered && choice === q.answer) className += " review-correct";
                if (reviewAnswered && reviewSelected === choice && choice !== q.answer) className += " review-wrong";
                return (
                  <button key={choice} className={className.trim()} disabled={reviewAnswered} onClick={() => setReviewSelected(choice)}>
                    {["ア", "イ", "ウ", "エ"][choice]}
                  </button>
                );
              })}
            </div>

            {!reviewAnswered ? (
              <>
                <div className="confidence-box">
                  <span>今回の感触</span>
                  <div className="confidence-buttons">
                    <button className={reviewConfidence === "confident" ? "active" : ""} onClick={() => setReviewConfidence("confident")}>自信あり</button>
                    <button className={reviewConfidence === "unsure" ? "active" : ""} onClick={() => setReviewConfidence("unsure")}>迷った</button>
                    <button className={reviewConfidence === "unknown" ? "active" : ""} onClick={() => setReviewConfidence("unknown")}>知らなかった</button>
                  </div>
                </div>
                <button className="primary large" disabled={reviewSelected === null || syncState === "loading"} onClick={() => void submitReviewAnswer()}>
                  {syncState === "loading" ? "保存中…" : "回答する"}
                </button>
              </>
            ) : (
              <div className={`review-feedback ${reviewCorrect ? "ok" : "ng"}`}>
                <h2>{reviewCorrect ? "○ 正解" : "× 不正解"}</h2>
                <p>{q.learningPoint}</p>
                <small>正解：{["ア", "イ", "ウ", "エ"][q.answer]}</small>
                <a href={`${set.answerPdfUrl}`} target="_blank" rel="noreferrer">IPA公式解答を開く ↗</a>
                <button className="primary large" onClick={nextReviewQuestion}>{reviewIndex + 1 >= reviewQuiz.length ? "結果を見る" : "次の問題"}</button>
              </div>
            )}
          </aside>
        </section>
      </main>
    );
  }

  if (mode === "reviewResult") {
    const correct = reviewSessionAnswers.filter((x) => x.correct).length;
    const rate = reviewSessionAnswers.length ? Math.round((correct / reviewSessionAnswers.length) * 100) : 0;
    return (
      <main className="app-shell narrow">
        <section className="result-card">
          <div className="result-ring"><strong>{rate}%</strong><span>{correct}/{reviewSessionAnswers.length} 正解</span></div>
          <h1>{rate >= 80 ? "弱点がかなり埋まっています" : rate >= 60 ? "もう一周で定着を狙えます" : "このセットを優先してもう一度"}</h1>
          <p>{officialExam}年度横断復習の結果はSupabaseへ保存済みです。次回のおすすめ10問にも反映されます。</p>
          <div className="button-stack">
            <button className="primary" onClick={() => startOfficialReview(officialExam, "recommended")}>おすすめ10問を更新</button>
            <button className="secondary" onClick={() => startOfficialReview(officialExam, "wrong")}>公式の誤答だけ</button>
            <button className="text-button" onClick={() => setMode("home")}>ホームへ戻る</button>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "official") {
    const q = currentOfficialQuestions[officialIndex];
    const current = officialSelections[q.id];
    const answeredCount = Object.keys(officialSelections).length;
    const pdfSrc = `/api/official-pdf?exam=${officialExam === "A-1" ? "a1" : "a2"}&year=${officialYear}#page=${q.pdfPage}&view=FitH`;

    return (
      <main className="app-shell official-shell">
        <header className="topbar">
          <button className="text-button" onClick={() => setMode("home")}>← 終了</button>
          <div className="progress-text">{officialYear}年度公式 {officialExam}　回答済み {answeredCount} / {currentOfficialQuestions.length}</div>
          <a className="secondary small pdf-link-button" href={currentOfficialSet.pdfUrl} target="_blank" rel="noreferrer">PDFを別タブで開く ↗</a>
        </header>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${(answeredCount / currentOfficialQuestions.length) * 100}%` }} /></div>
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}

        <section className="official-layout">
          <div className="official-pdf-panel">
            <iframe key={pdfSrc} src={pdfSrc} title={`IPA公式 ${officialYear}年度 ${officialExam} 問${q.number}`} />
            <p>PDFはアプリ経由で表示しています。表示されない場合は、上部の「PDFを別タブで開く」を利用してください。</p>
          </div>
          <aside className="official-answer-panel">
            <div className="official-question-heading">
              <span>IPA {currentOfficialSet.eraLabel} {officialExam === "A-1" ? "午前Ⅰ" : "午前Ⅱ"}</span>
              <strong>問{q.number}</strong>
            </div>
            <p className="muted-text">左の公式問題を確認して、解答だけこちらで記録します。採点は全問終了後にまとめて行います。</p>
            <div className="official-choice-grid">
              {[0, 1, 2, 3].map((choice) => (
                <button
                  key={choice}
                  className={current?.selected === choice ? "selected" : ""}
                  onClick={() => setOfficialAnswer(q.id, choice)}
                >
                  {["ア", "イ", "ウ", "エ"][choice]}
                </button>
              ))}
            </div>

            <div className="confidence-box">
              <span>この問題の感触</span>
              <div className="confidence-buttons">
                <button className={current?.confidence === "confident" ? "active" : ""} onClick={() => setOfficialAnswer(q.id, undefined, "confident")}>自信あり</button>
                <button className={!current || current.confidence === "unsure" ? "active" : ""} onClick={() => setOfficialAnswer(q.id, undefined, "unsure")}>迷った</button>
                <button className={current?.confidence === "unknown" ? "active" : ""} onClick={() => setOfficialAnswer(q.id, undefined, "unknown")}>知らなかった</button>
              </div>
            </div>

            <div className="official-nav">
              {currentOfficialQuestions.map((item, i) => (
                <button
                  key={item.id}
                  className={`${i === officialIndex ? "current" : ""} ${officialSelections[item.id] ? "answered" : ""}`}
                  onClick={() => setOfficialIndex(i)}
                >
                  {item.number}
                </button>
              ))}
            </div>

            <div className="official-step-buttons">
              <button className="secondary" disabled={officialIndex === 0} onClick={() => setOfficialIndex((x) => Math.max(0, x - 1))}>← 前へ</button>
              {officialIndex < currentOfficialQuestions.length - 1 ? (
                <button className="primary" onClick={() => setOfficialIndex((x) => Math.min(currentOfficialQuestions.length - 1, x + 1))}>次へ →</button>
              ) : (
                <button className="primary" disabled={syncState === "loading"} onClick={() => void finishOfficialExam()}>採点して保存</button>
              )}
            </div>
            {answeredCount === currentOfficialQuestions.length && officialIndex < currentOfficialQuestions.length - 1 && (
              <button className="primary large" disabled={syncState === "loading"} onClick={() => void finishOfficialExam()}>{currentOfficialQuestions.length}問を採点して保存</button>
            )}
          </aside>
        </section>
      </main>
    );
  }

  if (mode === "officialResult") {
    const results = currentOfficialQuestions.map((q) => ({ q, answer: officialSelections[q.id], correct: officialSelections[q.id]?.selected === q.answer }));
    const correct = results.filter((x) => x.correct).length;
    const rate = Math.round((correct / currentOfficialQuestions.length) * 100);
    const wrong = results.filter((x) => !x.correct);
    return (
      <main className="app-shell narrow official-result-shell">
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}
        <section className="result-card">
          <div className="result-ring"><strong>{rate}%</strong><span>{correct}/{currentOfficialQuestions.length} 正解</span></div>
          <h1>{rate >= 75 ? `${officialExam}はかなり良い位置です` : rate >= 60 ? "合格ライン付近です" : "弱点分野を優先して補強しましょう"}</h1>
          <p>{officialYear}年度春期の公式{currentOfficialQuestions.length}問（{officialExam}）です。結果はSupabaseへ保存済みです。</p>
          <div className="button-stack">
            <button className="primary" onClick={() => startOfficialExam(officialExam, officialYear)}>もう一度{currentOfficialQuestions.length}問解く</button>
            <a className="secondary result-link" href={currentOfficialSet.answerPdfUrl} target="_blank" rel="noreferrer">IPA公式解答を開く ↗</a>
            <button className="text-button" onClick={() => setMode("home")}>ホームへ戻る</button>
          </div>
        </section>
        {wrong.length > 0 && (
          <section className="panel official-review">
            <h2>間違えた問題の復習ポイント</h2>
            <div className="official-review-list">
              {wrong.map(({ q, answer }) => (
                <div key={q.id}>
                  <div className="review-title"><strong>問{q.number}</strong><span>{q.category} / {q.subcategory}</span></div>
                  <p>{q.learningPoint}</p>
                  <small>あなた：{answer ? ["ア","イ","ウ","エ"][answer.selected] : "未回答"} ／ 正解：{["ア","イ","ウ","エ"][q.answer]}</small>
                  <a href={`${currentOfficialSet.pdfUrl}#page=${q.pdfPage}`} target="_blank" rel="noreferrer">公式PDFの該当ページを開く ↗</a>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    );
  }

  if (mode === "result") {
    const correct = sessionAnswers.filter((x) => x.correct).length;
    const rate = sessionAnswers.length ? Math.round((correct / sessionAnswers.length) * 100) : 0;
    return (
      <main className="app-shell narrow">
        <section className="result-card">
          <div className="result-ring"><strong>{rate}%</strong><span>{correct}/{sessionAnswers.length} 正解</span></div>
          <h1>{rate >= 75 ? "良いペースです" : rate >= 60 ? "合格圏を狙えます" : "弱点が見えてきました"}</h1>
          <p>今回の結果もSupabaseへ保存済みです。別端末でログインしても続きから学習できます。</p>
          <div className="button-stack">
            <button className="primary" onClick={() => startQuiz("wrong")}>今回までの誤答を復習</button>
            <button className="secondary" onClick={() => setMode("stats")}>分野別成績を見る</button>
            <button className="text-button" onClick={() => setMode("home")}>ホームへ戻る</button>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "stats") {
    return (
      <main className="app-shell">
        <Header title="分野別成績" onBack={() => setMode("home")} />
        <section className="panel">
          <div className="stat-table">
            {statCategories.map((name) => {
              const ids = new Set(statsQuestions.filter((q) => q.category === name).map((q) => q.id));
              const list = attempts.filter((a) => ids.has(a.questionId));
              const rate = accuracy(list);
              return (
                <div className="stat-row" key={name}>
                  <div><strong>{name}</strong><span>{list.length}回答</span></div>
                  <div className="bar"><div style={{ width: `${rate ?? 0}%` }} /></div>
                  <div className={rate !== null && rate < 60 ? "rate weak" : "rate"}>{rate === null ? "—" : `${rate}%`}</div>
                  {allQuestions.some((q) => q.category === name) ? <button onClick={() => startQuiz("category", name)}>この分野</button> : <span className="official-only-label">公式履歴</span>}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    );
  }

  if (mode === "b1") {
    const minutes = Math.floor(b1SecondsLeft / 60).toString().padStart(2, "0");
    const seconds = (b1SecondsLeft % 60).toString().padStart(2, "0");
    const questionPdfSrc = `/api/official-pdf?exam=b1&year=${b1Year}&doc=question#page=${b1Question.pdfPage}&view=FitH`;
    const answerPdfSrc = `/api/official-pdf?exam=b1&year=${b1Year}&doc=answer#page=1&view=FitH`;
    const commentaryPdfSrc = `/api/official-pdf?exam=b1&year=${b1Year}&doc=commentary#page=1&view=FitH`;
    return (
      <main className="app-shell b1-shell">
        <Header title="B-1 記述トレーナー" onBack={() => setMode("home")} />
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}
        {!b1DbReady && <div className="notice warning">答案をSupabaseへ保存するには、先に <strong>supabase/setup_v4_1.sql</strong> をSQL Editorで実行してください。PDF閲覧と入力は先に試せます。</div>}

        <section className="panel b1-guide">
          <div>
            <div className="eyebrow">2026 科目B-1</div>
            <h2>3問から2問を選択・90分</h2>
            <p className="muted-text">1問あたり45分を目安に、本文根拠 → 設問の主語 → 要求字数の順で答案を組み立てます。</p>
          </div>
          <div className={`b1-timer ${b1SecondsLeft === 0 ? "timeup" : ""}`}>
            <span>1問の目安</span><strong>{minutes}:{seconds}</strong>
            <div>
              <button className="secondary small" onClick={() => setB1TimerRunning((v) => !v)}>{b1TimerRunning ? "一時停止" : "開始"}</button>
              <button className="text-button" onClick={() => { setB1SecondsLeft(45 * 60); setB1TimerRunning(false); }}>リセット</button>
            </div>
          </div>
        </section>

        <section className="panel b1-selector">
          <div className="b1-year-tabs">
            {officialB1Years.map((year) => <button key={year} className={b1Year === year ? "active" : ""} onClick={() => { setB1Year(year); setB1QuestionNumber(1); }}>{officialB1Sets[year].shortLabel} / {year}</button>)}
          </div>
          <div className="b1-question-tabs">
            {b1Set.questions.map((q) => {
              const saved = b1Practices.find((p) => p.year === b1Year && p.questionNumber === q.number);
              return <button key={q.number} className={b1QuestionNumber === q.number ? "active" : ""} onClick={() => setB1QuestionNumber(q.number)}><strong>問{q.number}</strong><span>{q.title}</span>{saved && <small>保存済み {saved.selfRating === "good" ? "○" : saved.selfRating === "partial" ? "△" : saved.selfRating === "redo" ? "×" : "・"}</small>}</button>;
            })}
          </div>
        </section>

        <section className="panel b1-view-toolbar">
          <div>
            <strong>表示モード</strong>
            <span>まず問題文を大きく読み、答案を書くときだけ画面を切り替えるのがおすすめです。</span>
          </div>
          <div className="b1-view-buttons">
            <button className={b1View === "problem" ? "active" : ""} onClick={() => setB1View("problem")}>問題を大きく読む</button>
            <button className={b1View === "answer" ? "active" : ""} onClick={() => setB1View("answer")}>答案を書く</button>
            <button className={b1View === "split" ? "active" : ""} onClick={() => setB1View("split")}>分割表示</button>
          </div>
        </section>

        <section className={`b1-workspace view-${b1View}`}>
          {b1View !== "answer" && (
            <div className="panel b1-pdf-panel">
              <div className="panel-heading">
                <div><h2>{b1Year} 問{b1Question.number}</h2><p className="muted-text">{b1Question.title}</p></div>
                <div className="b1-pdf-actions">
                  {b1View === "split" && <button className="secondary small" onClick={() => setB1View("problem")}>大きく表示</button>}
                  <a className="text-button" href={`${b1Set.pdfUrl}#page=${b1Question.pdfPage}`} target="_blank" rel="noreferrer">公式PDF ↗</a>
                </div>
              </div>
              <div className="b1-pdf-frame"><iframe key={questionPdfSrc} src={questionPdfSrc} title={`IPA ${b1Year} B-1 問${b1Question.number}`} /></div>
              {b1View === "problem" && (
                <div className="b1-problem-next">
                  <span>本文と設問を読み終えたら、答案入力へ切り替えます。</span>
                  <button className="primary" onClick={() => setB1View("answer")}>答案を書く →</button>
                </div>
              )}
            </div>
          )}

          {b1View !== "problem" && (
            <div className="panel b1-answer-panel">
              <div className="b1-answer-topline">
                <div>
                  <div className="eyebrow">{b1Year} 問{b1Question.number}</div>
                  <h2>{b1Question.title}</h2>
                </div>
                {b1View === "answer" && <button className="secondary" onClick={() => setB1View("problem")}>← 問題を確認</button>}
              </div>
              <div className="b1-focus">
                <strong>この問で意識すること</strong>
                <ul>{b1Question.focus.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <label className="b1-label">自分の答案・設問別メモ
                <textarea className="b1-answer-textarea" value={b1AnswerText} onChange={(e) => setB1AnswerText(e.target.value)} placeholder={"例：\n設問1(1)：…\n設問2(1)：…\n設問2(2)：…"} />
              </label>
              <div className="b1-answer-actions">
                <button className="primary" onClick={() => void saveCurrentB1Practice()}>答案を保存</button>
                <button className="secondary" onClick={() => { setB1ShowAnswer((v) => !v); setB1ShowCommentary(false); }}>{b1ShowAnswer ? "解答例を閉じる" : "公式解答例と比較"}</button>
                <button className="secondary" onClick={() => { setB1ShowCommentary((v) => !v); setB1ShowAnswer(false); }}>{b1ShowCommentary ? "採点講評を閉じる" : "採点講評を見る"}</button>
              </div>
              <div className="b1-rating-block">
                <span>自己評価</span>
                <div className="b1-rating-buttons">
                  <button className={b1Rating === "good" ? "selected good" : ""} onClick={() => setB1Rating("good")}>○ 要点を押さえた</button>
                  <button className={b1Rating === "partial" ? "selected partial" : ""} onClick={() => setB1Rating("partial")}>△ 一部不足</button>
                  <button className={b1Rating === "redo" ? "selected redo" : ""} onClick={() => setB1Rating("redo")}>× 書き直し</button>
                </div>
              </div>
              <label className="b1-label">解答例・採点講評からの気づき
                <textarea className="b1-memo-textarea" value={b1Memo} onChange={(e) => setB1Memo(e.target.value)} placeholder="本文のどこを読み落としたか、主語・理由・具体性などを記録" />
              </label>
            </div>
          )}
        </section>

        {b1ShowAnswer && <section className="panel b1-reference"><div className="panel-heading"><div><h2>IPA公式 解答例</h2><p className="muted-text">自分の答案を書いてから比較するのがおすすめです。</p></div><a className="text-button" href={b1Set.answerPdfUrl} target="_blank" rel="noreferrer">別タブ ↗</a></div><div className="b1-reference-frame"><iframe key={answerPdfSrc} src={answerPdfSrc} title={`IPA ${b1Year} B-1 解答例`} /></div></section>}
        {b1ShowCommentary && <section className="panel b1-reference"><div className="panel-heading"><div><h2>IPA公式 採点講評</h2><p className="muted-text">誤答傾向と、何を読み取るべきだったかを確認します。</p></div><a className="text-button" href={b1Set.commentaryPdfUrl} target="_blank" rel="noreferrer">別タブ ↗</a></div><div className="b1-reference-frame compact"><iframe key={commentaryPdfSrc} src={commentaryPdfSrc} title={`IPA ${b1Year} B-1 採点講評`} /></div></section>}
      </main>
    );
  }

  if (mode === "manage") {
    return (
      <main className="app-shell">
        <Header title="問題データ管理" onBack={() => setMode("home")} />
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}
        <section className="panel">
          <h2>JSON問題データを追加</h2>
          <p className="muted-text">追加問題もSupabaseへ保存され、同じGoogleアカウントなら別端末でも利用できます。公式過去問を登録する場合は、年度・試験区分・時間区分・問番号等の出典を明記してください。</p>
          <label className="upload">
            JSONファイルを選択
            <input type="file" accept="application/json,.json" onChange={handleImport} />
          </label>
          <div className="info-grid">
            <div><strong>{seedQuestions.length}</strong><span>標準問題</span></div>
            <div><strong>{customQuestions.length}</strong><span>追加問題</span></div>
            <div><strong>{allQuestions.length}</strong><span>アプリ内合計</span></div>
          </div>
          <p className="muted-text">別途、2025〜2021年度春期の公式A-1各30問（150問）とA-2各25問（125問）、B-1は2025・2024年度の公式問題・解答例・採点講評を利用できます。</p>
          <a className="link-card" href="https://www.ipa.go.jp/shiken/mondai-kaiotu/index.html" target="_blank" rel="noreferrer">
            IPA公式 過去問題ページを開く ↗
          </a>
          <button className="danger" onClick={() => void removeCustomQuestions()}>追加問題を削除</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <div className="eyebrow">ITストラテジスト 2026</div>
          <h1>科目A-1 / A-2 / B-1 トレーナー</h1>
          <p>選択問題は弱点反復、記述問題は本文根拠と答案比較で鍛える。</p>
        </div>
        <button className="gear" onClick={() => setMode("manage")}>⚙</button>
      </section>

      <section className="user-bar">
        <div>
          <span>ログイン中</span>
          <strong>{user.email ?? "Googleアカウント"}</strong>
        </div>
        <div className="user-actions">
          <span className={`sync-pill ${syncState}`}>
            {syncState === "synced" ? "☁ 同期済み" : syncState === "loading" ? "↻ 同期中" : syncState === "error" ? "! 同期エラー" : "☁"}
          </span>
          <button className="secondary small" onClick={() => void syncFromCloud(user, true)}>再同期</button>
          <button className="secondary small" onClick={signOut}>ログアウト</button>
        </div>
      </section>

      {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}

      <section className="summary-grid review-summary-grid">
        <div className="summary-card"><span>公式275問 回答済み</span><strong>{a1Metrics.answeredCount + a2Metrics.answeredCount}</strong><small>/ 275問</small></div>
        <div className="summary-card"><span>A-1 正答率</span><strong>{a1Metrics.currentAccuracy ?? "—"}</strong><small>{a1Metrics.currentAccuracy === null ? "" : "%"}</small></div>
        <div className="summary-card"><span>A-2 正答率</span><strong>{a2Metrics.currentAccuracy ?? "—"}</strong><small>{a2Metrics.currentAccuracy === null ? "" : "%"}</small></div>
        <div className="summary-card"><span>B-1 保存済み</span><strong>{b1Practices.length}</strong><small>/ 6問</small></div>
      </section>

      <section className="panel review-dashboard">
        <div className="panel-heading">
          <div><h2>A-2 年度横断・弱点復習</h2><p className="muted-text">ITストラテジスト固有の2025〜2021年125問から、優先問題を選びます。</p></div>
          <span className="review-count">要復習 {a2Metrics.reviewIds.size}問</span>
        </div>
        <div className="a2-focus-grid">
          <div className={`a2-status-card ${a2StudyStatus.tone}`}><span>学習目安</span><strong>{a2StudyStatus.label}</strong><small>{a2StudyStatus.detail}</small></div>
          <div className="a2-frequency-card"><span>5年125問の頻出領域</span><div>{a2FrequentAreas.map((item) => <button key={item.name} onClick={() => startOfficialReview("A-2", "category", item.name)}><strong>{item.name}</strong><small>{item.count}問</small></button>)}</div></div>
        </div>
        <button className="recommend-card" onClick={() => startOfficialReview("A-2", "recommended")}>
          <span className="recommend-icon">10</span><span><strong>A-2 今日のおすすめ10問</strong><small>誤答 → 知らなかった → 迷った → 弱点分野の順に優先</small></span><span>→</span>
        </button>
        <div className="review-filter-grid">
          <button onClick={() => startOfficialReview("A-2", "wrong")}><strong>{a2Metrics.wrongCount}</strong><span>間違えた</span></button>
          <button onClick={() => startOfficialReview("A-2", "unsure")}><strong>{a2Metrics.unsureCount}</strong><span>迷った</span></button>
          <button onClick={() => startOfficialReview("A-2", "unknown")}><strong>{a2Metrics.unknownCount}</strong><span>知らなかった</span></button>
        </div>
        {a2Metrics.weakCategories.length > 0 && <div className="review-weak-row"><span>弱点TOP3</span>{a2Metrics.weakCategories.map((item) => <button key={item.name} onClick={() => startOfficialReview("A-2", "category", item.name)}>{item.name} <strong>{item.accuracy}%</strong></button>)}</div>}
      </section>

      <section className="panel">
        <h2>A-2 公式過去問</h2>
        <p className="muted-text">まずこちらを優先。各年度25問、5年分で125問です。</p>
        <div className="action-grid">
          {OFFICIAL_YEARS.map((year) => { const set = officialA2Sets[year]; return (
            <button key={`a2-${year}`} className="action official-action" onClick={() => startOfficialExam("A-2", year)}>
              <span className="action-icon">{set.shortLabel}</span><span><strong>{year}公式A-2 25問</strong><small>IPA公式PDF＋クラウド採点</small></span>
            </button>
          ); })}
        </div>
      </section>

      <section className="panel b1-home-panel">
        <div className="panel-heading">
          <div><h2>B-1 記述対策</h2><p className="muted-text">90分で3問から2問を選択。まず2025・2024年度の公式問題で、答案作成→解答例→採点講評の流れを練習します。</p></div>
          <span className={`b1-db-pill ${b1DbReady ? "ready" : "pending"}`}>{b1DbReady ? `☁ ${b1Practices.length}/6保存` : "DB追加SQL未実行"}</span>
        </div>
        <button className="recommend-card b1-launch-card" onClick={() => openB1("2025", 1)}>
          <span className="recommend-icon">記</span><span><strong>B-1 記述トレーナーを開く</strong><small>公式PDFを見ながら答案入力・45分タイマー・自己評価・採点講評メモ</small></span><span>→</span>
        </button>
        <div className="b1-year-summary">
          {officialB1Years.map((year) => <button key={year} onClick={() => openB1(year, 1)}><strong>{officialB1Sets[year].shortLabel} / {year}</strong><span>{b1Practices.filter((p) => p.year === year).length}/3問 保存済み</span></button>)}
        </div>
      </section>

      <section className="panel review-dashboard">
        <div className="panel-heading">
          <div><h2>A-1 年度横断・弱点復習</h2><p className="muted-text">高度試験共通の2025〜2021年150問から、優先問題を選びます。</p></div>
          <span className="review-count">要復習 {a1Metrics.reviewIds.size}問</span>
        </div>
        <button className="recommend-card" onClick={() => startOfficialReview("A-1", "recommended")}>
          <span className="recommend-icon">10</span><span><strong>A-1 今日のおすすめ10問</strong><small>誤答 → 知らなかった → 迷った → 弱点分野の順に優先</small></span><span>→</span>
        </button>
        <div className="review-filter-grid">
          <button onClick={() => startOfficialReview("A-1", "wrong")}><strong>{a1Metrics.wrongCount}</strong><span>間違えた</span></button>
          <button onClick={() => startOfficialReview("A-1", "unsure")}><strong>{a1Metrics.unsureCount}</strong><span>迷った</span></button>
          <button onClick={() => startOfficialReview("A-1", "unknown")}><strong>{a1Metrics.unknownCount}</strong><span>知らなかった</span></button>
        </div>
        {a1Metrics.weakCategories.length > 0 && <div className="review-weak-row"><span>弱点TOP3</span>{a1Metrics.weakCategories.map((item) => <button key={item.name} onClick={() => startOfficialReview("A-1", "category", item.name)}>{item.name} <strong>{item.accuracy}%</strong></button>)}</div>}
      </section>

      <section className="panel">
        <h2>A-1 公式過去問・補助演習</h2>
        <div className="action-grid">
          <button className="action primary-action" onClick={() => startQuiz("random")}><span className="action-icon">▶</span><span><strong>ランダム10問</strong><small>オリジナル問題で現在地を確認</small></span></button>
          {OFFICIAL_YEARS.map((year) => { const set = officialA1Sets[year]; return (
            <button key={`a1-${year}`} className="action official-action" onClick={() => startOfficialExam("A-1", year)}>
              <span className="action-icon">{set.shortLabel}</span><span><strong>{year}公式A-1 30問</strong><small>IPA公式PDF＋クラウド採点</small></span>
            </button>
          ); })}
          <button className="action" onClick={() => startQuiz("mock")}><span className="action-icon">30</span><span><strong>A-1模擬試験</strong><small>最大30問・本番想定</small></span></button>
          <button className="action" onClick={() => startQuiz("weak")}><span className="action-icon">↻</span><span><strong>苦手を優先</strong><small>誤答・低正答率・知らなかった</small></span></button>
          <button className="action" onClick={() => startQuiz("wrong")}><span className="action-icon">×</span><span><strong>誤答だけ</strong><small>{localWrongQuestionIds.size}問が対象</small></span></button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><h2>分野別に解く</h2><button className="text-button" onClick={() => setMode("stats")}>成績を見る</button></div>
        <div className="category-list">
          {categories.map((name) => {
            const count = allQuestions.filter((q) => q.category === name).length;
            return <button key={name} onClick={() => startQuiz("category", name)}><span>{name}</span><small>{count}問</small></button>;
          })}
        </div>
      </section>

      <section className="panel">
        <h2>今の弱点</h2>
        {weakCategories.length ? (
          <div className="weak-list">
            {weakCategories.map((w) => allQuestions.some((q) => q.category === w.name) ? (
              <button key={w.name} onClick={() => startQuiz("category", w.name)}><span>{w.name}</span><strong>{w.accuracy}%</strong></button>
            ) : (
              <div className="weak-static" key={w.name}><span>{w.name}</span><strong>{w.accuracy}%</strong><small>公式履歴</small></div>
            ))}
          </div>
        ) : (
          <p className="muted-text">まだ判定できません。まず10問程度解くと、正答率の低い分野がここに表示されます。</p>
        )}
      </section>

      <section className="panel compact">
        <div className="panel-heading"><div><h2>データ</h2><p className="muted-text">標準{seedQuestions.length}問 ＋ 追加{customQuestions.length}問 ＋ A系公式275問（A-1 150＋A-2 125）＋ B-1記述6問 ／ Supabase同期</p></div><button className="secondary small" onClick={() => setMode("manage")}>問題を追加</button></div>
      </section>

      <footer>
        <button className="text-button" onClick={() => void resetProgress()}>学習履歴をリセット</button>
        <p>標準問題はオリジナル問題。A系2025〜2021年度とB-1 2025〜2024年度はIPA公式PDFを参照して学習します。</p>
      </footer>
    </main>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="topbar section-header">
      <button className="text-button" onClick={onBack}>← 戻る</button>
      <h1>{title}</h1>
      <span />
    </header>
  );
}
