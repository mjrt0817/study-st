"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Question, seedQuestions } from "../data/questions";
import type { OfficialA1Year } from "../data/officialA1";
import { officialA1AllQuestions, officialA1Sets } from "../data/officialA1";
import { supabase, supabaseConfigured } from "../lib/supabase";
import {
  Attempt,
  Confidence,
  deleteAllCustomQuestions,
  loadCloudStudyData,
  migrateLocalStudyData,
  resetCloudProgress,
  saveAttempt,
  saveAttempts,
  saveBookmark,
  upsertCustomQuestions,
} from "../lib/studyStore";

type Mode = "home" | "quiz" | "result" | "stats" | "manage" | "official" | "officialResult";
type QuizKind = "random" | "mock" | "weak" | "wrong" | "category";
type SyncState = "idle" | "loading" | "synced" | "error";
const OFFICIAL_YEARS: OfficialA1Year[] = ["2025", "2024", "2023"];

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
  const [officialYear, setOfficialYear] = useState<OfficialA1Year>("2025");
  const [officialIndex, setOfficialIndex] = useState(0);
  const [officialSelections, setOfficialSelections] = useState<Record<string, { selected: number; confidence: Confidence }>>({});

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
      setSyncState("idle");
      return;
    }
    void syncFromCloud(user);
  }, [user, syncFromCloud]);

  const allQuestions = useMemo(() => [...seedQuestions, ...customQuestions], [customQuestions]);
  const categories = useMemo(() => Array.from(new Set(allQuestions.map((q) => q.category))).sort(), [allQuestions]);
  const statsQuestions = useMemo(() => [...allQuestions, ...officialA1AllQuestions], [allQuestions]);
  const currentOfficialSet = officialA1Sets[officialYear];
  const currentOfficialQuestions = currentOfficialSet.questions;
  const statCategories = useMemo(() => Array.from(new Set(statsQuestions.map((q) => q.category))).sort(), [statsQuestions]);

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

  function startOfficialExam(year: OfficialA1Year = officialYear) {
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
      setMessage(`${officialYear}年度A-1公式過去問の結果をSupabaseへ保存しました。`);
      setMode("officialResult");
    } catch (error) {
      console.error(error);
      setSyncState("error");
      setMessage(dbSetupHint(error));
    }
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
    if (!user || !confirm("Supabase上の解答履歴とブックマークを削除します。よろしいですか？")) return;
    setSyncState("loading");
    try {
      await resetCloudProgress(user.id);
      setAttempts([]);
      setBookmarks([]);
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
          <h1>科目A-1 トレーナー</h1>
          <p>学習履歴はSupabaseに保存します。Googleアカウントでログインすると、PCとスマホで同じ進捗を利用できます。</p>
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

  if (mode === "official") {
    const q = currentOfficialQuestions[officialIndex];
    const current = officialSelections[q.id];
    const answeredCount = Object.keys(officialSelections).length;
    const pdfSrc = `/api/official-pdf?year=${officialYear}#page=${q.pdfPage}&view=FitH`;

    return (
      <main className="app-shell official-shell">
        <header className="topbar">
          <button className="text-button" onClick={() => setMode("home")}>← 終了</button>
          <div className="progress-text">{officialYear}年度公式 A-1　回答済み {answeredCount} / 30</div>
          <a className="secondary small pdf-link-button" href={currentOfficialSet.pdfUrl} target="_blank" rel="noreferrer">PDFを別タブで開く ↗</a>
        </header>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${(answeredCount / 30) * 100}%` }} /></div>
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}

        <section className="official-layout">
          <div className="official-pdf-panel">
            <iframe key={pdfSrc} src={pdfSrc} title={`IPA公式 ${officialYear}年度 A-1 問${q.number}`} />
            <p>PDFはアプリ経由で表示しています。表示されない場合は、上部の「PDFを別タブで開く」を利用してください。</p>
          </div>
          <aside className="official-answer-panel">
            <div className="official-question-heading">
              <span>IPA {currentOfficialSet.eraLabel} 午前Ⅰ</span>
              <strong>問{q.number}</strong>
            </div>
            <p className="muted-text">左の公式問題を確認して、解答だけこちらで記録します。採点は30問終了後にまとめて行います。</p>
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
              {officialIndex < 29 ? (
                <button className="primary" onClick={() => setOfficialIndex((x) => Math.min(29, x + 1))}>次へ →</button>
              ) : (
                <button className="primary" disabled={syncState === "loading"} onClick={() => void finishOfficialExam()}>採点して保存</button>
              )}
            </div>
            {answeredCount === 30 && officialIndex < 29 && (
              <button className="primary large" disabled={syncState === "loading"} onClick={() => void finishOfficialExam()}>30問を採点して保存</button>
            )}
          </aside>
        </section>
      </main>
    );
  }

  if (mode === "officialResult") {
    const results = currentOfficialQuestions.map((q) => ({ q, answer: officialSelections[q.id], correct: officialSelections[q.id]?.selected === q.answer }));
    const correct = results.filter((x) => x.correct).length;
    const rate = Math.round((correct / 30) * 100);
    const wrong = results.filter((x) => !x.correct);
    return (
      <main className="app-shell narrow official-result-shell">
        {message && <div className="notice" onClick={() => setMessage("")}>{message}</div>}
        <section className="result-card">
          <div className="result-ring"><strong>{rate}%</strong><span>{correct}/30 正解</span></div>
          <h1>{rate >= 75 ? "A-1はかなり良い位置です" : rate >= 60 ? "合格ライン付近です" : "弱点分野を優先して補強しましょう"}</h1>
          <p>{officialYear}年度春期の公式30問です。結果はSupabaseへ保存済みです。</p>
          <div className="button-stack">
            <button className="primary" onClick={() => startOfficialExam(officialYear)}>もう一度30問解く</button>
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
          <p className="muted-text">別途、2025・2024・2023年度春期の公式A-1を各30問、「公式過去問モード」で利用できます（問題本文・図表はIPA公式PDFを参照）。</p>
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
          <h1>科目A-1 トレーナー</h1>
          <p>解く → 弱点を見つける → 弱点だけ反復する。</p>
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

      <section className="summary-grid">
        <div className="summary-card"><span>累計回答</span><strong>{attempts.length}</strong><small>問</small></div>
        <div className="summary-card"><span>正答率</span><strong>{totalAccuracy ?? "—"}</strong><small>{totalAccuracy === null ? "" : "%"}</small></div>
        <div className="summary-card"><span>知らなかった</span><strong>{unknownCount}</strong><small>回</small></div>
      </section>

      <section className="panel">
        <h2>今日の学習</h2>
        <div className="action-grid">
          <button className="action primary-action" onClick={() => startQuiz("random")}>
            <span className="action-icon">▶</span><span><strong>ランダム10問</strong><small>まず現在地を確認</small></span>
          </button>
          {OFFICIAL_YEARS.map((year) => {
            const set = officialA1Sets[year];
            return (
              <button key={year} className="action official-action" onClick={() => startOfficialExam(year)}>
                <span className="action-icon">{set.shortLabel}</span><span><strong>{year}公式A-1 30問</strong><small>IPA公式PDF＋クラウド採点</small></span>
              </button>
            );
          })}
          <button className="action" onClick={() => startQuiz("mock")}>
            <span className="action-icon">30</span><span><strong>A-1模擬試験</strong><small>最大30問・本番想定</small></span>
          </button>
          <button className="action" onClick={() => startQuiz("weak")}>
            <span className="action-icon">↻</span><span><strong>苦手を優先</strong><small>誤答・低正答率・知らなかった</small></span>
          </button>
          <button className="action" onClick={() => startQuiz("wrong")}>
            <span className="action-icon">×</span><span><strong>誤答だけ</strong><small>{localWrongQuestionIds.size}問が対象</small></span>
          </button>
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
        <div className="panel-heading"><div><h2>データ</h2><p className="muted-text">標準{seedQuestions.length}問 ＋ 追加{customQuestions.length}問 ＋ 公式過去問90問 ／ 学習履歴はSupabase同期</p></div><button className="secondary small" onClick={() => setMode("manage")}>問題を追加</button></div>
      </section>

      <footer>
        <button className="text-button" onClick={() => void resetProgress()}>学習履歴をリセット</button>
        <p>標準問題はオリジナル問題。2025・2024・2023年度公式過去問はIPA公式PDFを参照して解答します。</p>
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
