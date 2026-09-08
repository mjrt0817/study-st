"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Question, seedQuestions } from "../data/questions";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Confidence = "confident" | "unsure" | "unknown";
type Attempt = {
  questionId: string;
  correct: boolean;
  confidence: Confidence;
  answeredAt: string;
};

type Mode = "home" | "quiz" | "result" | "stats" | "manage";
type QuizKind = "random" | "mock" | "weak" | "wrong" | "category";

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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("home");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [customQuestions, setCustomQuestions] = useState<Question[]>([]);
  const [quiz, setQuiz] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("unsure");
  const [sessionAnswers, setSessionAnswers] = useState<{ id: string; correct: boolean }[]>([]);
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");

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

  useEffect(() => {
    if (!user) {
      setAttempts([]);
      setBookmarks([]);
      setCustomQuestions([]);
      return;
    }

    try {
      const attemptsKey = storageKey(ATTEMPTS_KEY, user.id);
      const bookmarksKey = storageKey(BOOKMARKS_KEY, user.id);
      const customKey = storageKey(CUSTOM_KEY, user.id);

      // V1を同じブラウザで使っていた場合は、初回ログイン時だけ現在のGoogleアカウントへ引き継ぐ。
      if (!localStorage.getItem(attemptsKey) && localStorage.getItem(LEGACY_ATTEMPTS_KEY)) {
        localStorage.setItem(attemptsKey, localStorage.getItem(LEGACY_ATTEMPTS_KEY)!);
      }
      if (!localStorage.getItem(bookmarksKey) && localStorage.getItem(LEGACY_BOOKMARKS_KEY)) {
        localStorage.setItem(bookmarksKey, localStorage.getItem(LEGACY_BOOKMARKS_KEY)!);
      }
      if (!localStorage.getItem(customKey) && localStorage.getItem(LEGACY_CUSTOM_KEY)) {
        localStorage.setItem(customKey, localStorage.getItem(LEGACY_CUSTOM_KEY)!);
      }

      setAttempts(JSON.parse(localStorage.getItem(attemptsKey) || "[]"));
      setBookmarks(JSON.parse(localStorage.getItem(bookmarksKey) || "[]"));
      setCustomQuestions(JSON.parse(localStorage.getItem(customKey) || "[]"));
    } catch {
      setAttempts([]);
      setBookmarks([]);
      setCustomQuestions([]);
    }
  }, [user]);

  const allQuestions = useMemo(() => [...seedQuestions, ...customQuestions], [customQuestions]);
  const categories = useMemo(() => Array.from(new Set(allQuestions.map((q) => q.category))).sort(), [allQuestions]);

  const totalAccuracy = accuracy(attempts);
  const unknownCount = attempts.filter((a) => a.confidence === "unknown").length;
  const wrongQuestionIds = useMemo(() => {
    const latest = new Map<string, Attempt>();
    attempts.forEach((a) => latest.set(a.questionId, a));
    return new Set(Array.from(latest.values()).filter((a) => !a.correct).map((a) => a.questionId));
  }, [attempts]);

  const weakCategories = useMemo(() => {
    const map = new Map<string, Attempt[]>();
    for (const a of attempts) {
      const q = allQuestions.find((x) => x.id === a.questionId);
      if (!q) continue;
      map.set(q.category, [...(map.get(q.category) || []), a]);
    }
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, accuracy: accuracy(list) ?? 0, count: list.length }))
      .filter((x) => x.count >= 2)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }, [attempts, allQuestions]);

  async function signInWithGoogle() {
    if (!supabase) return;
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
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

  function submitAnswer() {
    if (selected === null) return;
    const q = quiz[index];
    const correct = selected === q.answer;
    const nextAttempt: Attempt = {
      questionId: q.id,
      correct,
      confidence,
      answeredAt: new Date().toISOString(),
    };
    const nextAttempts = [...attempts, nextAttempt];
    setAttempts(nextAttempts);
    if (user) localStorage.setItem(storageKey(ATTEMPTS_KEY, user.id), JSON.stringify(nextAttempts));
    setSessionAnswers((s) => [...s, { id: q.id, correct }]);
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

  function toggleBookmark(id: string) {
    const next = bookmarks.includes(id) ? bookmarks.filter((x) => x !== id) : [...bookmarks, id];
    setBookmarks(next);
    if (user) localStorage.setItem(storageKey(BOOKMARKS_KEY, user.id), JSON.stringify(next));
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error("配列ではありません");
        const normalized: Question[] = parsed.map((q, i) => {
          if (!q.id || !q.question || !Array.isArray(q.choices) || q.choices.length !== 4 || typeof q.answer !== "number") {
            throw new Error(`${i + 1}件目の形式が不正です`);
          }
          return q as Question;
        });
        const ids = new Set(seedQuestions.map((q) => q.id));
        const merged = [...customQuestions.filter((q) => !normalized.some((n) => n.id === q.id)), ...normalized.filter((q) => !ids.has(q.id))];
        setCustomQuestions(merged);
        if (user) localStorage.setItem(storageKey(CUSTOM_KEY, user.id), JSON.stringify(merged));
        setMessage(`${normalized.length}問を読み込みました。`);
      } catch (e) {
        setMessage(`読み込みに失敗しました：${e instanceof Error ? e.message : "形式を確認してください"}`);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function resetProgress() {
    if (!confirm("解答履歴とブックマークを削除します。よろしいですか？")) return;
    setAttempts([]);
    setBookmarks([]);
    if (user) {
      localStorage.removeItem(storageKey(ATTEMPTS_KEY, user.id));
      localStorage.removeItem(storageKey(BOOKMARKS_KEY, user.id));
    }
    setMessage("学習履歴をリセットしました。");
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
          <p className="auth-note">詳しい手順はREADMEの「Googleログイン設定」を参照してください。</p>
        </section>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-mark">ST</div>
          <h1>認証状態を確認しています</h1>
          <p>Googleログイン情報を確認しています。</p>
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
          <p>学習履歴をアカウント単位で分離するため、Googleアカウントでログインしてください。</p>
          {message && <div className="notice">{message}</div>}
          <button className="google-button" onClick={signInWithGoogle}>
            <span className="google-g">G</span> Googleでログイン
          </button>
          <p className="auth-note">ログイン後もV1の学習履歴はこの端末内に保存されます。別端末同期は次の段階でSupabase DBへ移行します。</p>
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
          <button className={`bookmark ${bookmarks.includes(q.id) ? "active" : ""}`} onClick={() => toggleBookmark(q.id)}>
            {bookmarks.includes(q.id) ? "★" : "☆"}
          </button>
        </header>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${((index + 1) / quiz.length) * 100}%` }} /></div>

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
              <button className="primary large" disabled={selected === null} onClick={submitAnswer}>回答する</button>
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

  if (mode === "result") {
    const correct = sessionAnswers.filter((x) => x.correct).length;
    const rate = sessionAnswers.length ? Math.round((correct / sessionAnswers.length) * 100) : 0;
    return (
      <main className="app-shell narrow">
        <section className="result-card">
          <div className="result-ring"><strong>{rate}%</strong><span>{correct}/{sessionAnswers.length} 正解</span></div>
          <h1>{rate >= 75 ? "良いペースです" : rate >= 60 ? "合格圏を狙えます" : "弱点が見えてきました"}</h1>
          <p>正答率だけでなく「知らなかった」を記録した問題も弱点モードで優先出題します。</p>
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
            {categories.map((name) => {
              const ids = new Set(allQuestions.filter((q) => q.category === name).map((q) => q.id));
              const list = attempts.filter((a) => ids.has(a.questionId));
              const rate = accuracy(list);
              return (
                <div className="stat-row" key={name}>
                  <div><strong>{name}</strong><span>{list.length}回答</span></div>
                  <div className="bar"><div style={{ width: `${rate ?? 0}%` }} /></div>
                  <div className={rate !== null && rate < 60 ? "rate weak" : "rate"}>{rate === null ? "—" : `${rate}%`}</div>
                  <button onClick={() => startQuiz("category", name)}>この分野</button>
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
        <section className="panel">
          <h2>JSON問題データを追加</h2>
          <p className="muted-text">V1では、問題データをJSONで読み込むとブラウザ内に保存されます。公式過去問を登録する場合は、年度・試験区分・時間区分・問番号等の出典を明記してください。</p>
          <label className="upload">
            JSONファイルを選択
            <input type="file" accept="application/json,.json" onChange={handleImport} />
          </label>
          <div className="info-grid">
            <div><strong>{seedQuestions.length}</strong><span>標準問題</span></div>
            <div><strong>{customQuestions.length}</strong><span>追加問題</span></div>
            <div><strong>{allQuestions.length}</strong><span>合計</span></div>
          </div>
          <a className="link-card" href="https://www.ipa.go.jp/shiken/mondai-kaiotu/index.html" target="_blank" rel="noreferrer">
            IPA公式 過去問題ページを開く ↗
          </a>
          <button className="danger" onClick={() => {
            if (!confirm("追加した問題データを全て削除しますか？")) return;
            setCustomQuestions([]);
            if (user) localStorage.removeItem(storageKey(CUSTOM_KEY, user.id));
            setMessage("追加問題を削除しました。");
          }}>追加問題を削除</button>
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
        <button className="secondary small" onClick={signOut}>ログアウト</button>
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
          <button className="action" onClick={() => startQuiz("mock")}>
            <span className="action-icon">30</span><span><strong>A-1模擬試験</strong><small>最大30問・本番想定</small></span>
          </button>
          <button className="action" onClick={() => startQuiz("weak")}>
            <span className="action-icon">↻</span><span><strong>苦手を優先</strong><small>誤答・低正答率・知らなかった</small></span>
          </button>
          <button className="action" onClick={() => startQuiz("wrong")}>
            <span className="action-icon">×</span><span><strong>誤答だけ</strong><small>{wrongQuestionIds.size}問が対象</small></span>
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
            {weakCategories.map((w) => <button key={w.name} onClick={() => startQuiz("category", w.name)}><span>{w.name}</span><strong>{w.accuracy}%</strong></button>)}
          </div>
        ) : (
          <p className="muted-text">まだ判定できません。まず10問程度解くと、正答率の低い分野がここに表示されます。</p>
        )}
      </section>

      <section className="panel compact">
        <div className="panel-heading"><div><h2>データ</h2><p className="muted-text">標準{seedQuestions.length}問 ＋ 追加{customQuestions.length}問</p></div><button className="secondary small" onClick={() => setMode("manage")}>問題を追加</button></div>
      </section>

      <footer>
        <button className="text-button" onClick={resetProgress}>学習履歴をリセット</button>
        <p>標準収録問題はV1動作確認用のオリジナル問題です。</p>
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
