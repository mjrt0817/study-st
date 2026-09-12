import type { Question } from "./questions";
export type OfficialA1Year =
  "2025-fall"
  | "2025-spring"
  | "2024-fall"
  | "2024-spring"
  | "2023-fall"
  | "2023-spring"
  | "2022-fall"
  | "2022-spring"
  | "2021-fall"
  | "2021-spring";

export type OfficialA1Question = Question & {
  year: OfficialA1Year;
  number: number;
  pdfPage: number;
  learningPoint: string;
};

export type OfficialA1Set = {
  year: OfficialA1Year;
  calendarYear: string;
  eraLabel: string;
  shortLabel: string;
  season: "春期" | "秋期";
  pdfUrl: string;
  answerPdfUrl: string;
  questions: OfficialA1Question[];
};

type PageAnchor = readonly [question: number, page: number];

type Source = {
  calendarYear: string;
  eraLabel: string;
  shortLabel: string;
  season: "春期" | "秋期";
  pdf: string;
  answer: string;
  explanationCode: string;
  pageCount: number;
  pageAnchors: readonly PageAnchor[];
  answers: string;
};

const sources: Record<OfficialA1Year, Source> = {
  "2025-fall": {
    calendarYear: "2025", eraLabel: "令和7年度秋期", shortLabel: "R7秋", season: "秋期", pageCount: 40,
    pageAnchors: [[1, 4], [14, 10], [40, 20], [64, 30], [80, 38]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07a_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07a_ap_am_ans.pdf",
    explanationCode: "07_aki",
    answers: "エイイウイイアエイアイウアイエイウイエアアウエウウイエアイウアアイエエイウアエアアアウイアエイイエエアエウアアアイエウイアエイウイウウイアイイイウエウエイエアア",
  },
  "2025-spring": {
    calendarYear: "2025", eraLabel: "令和7年度春期", shortLabel: "R7春", season: "春期", pageCount: 44,
    pageAnchors: [[1, 4], [13, 10], [36, 20], [56, 30], [80, 41]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_ap_am_ans.pdf",
    explanationCode: "07_haru",
    answers: "エアイイウウウウエアエイエイウアエウイイウウウエウイアイイイエウアウウイイウウイイイウウアアイエウイエイエウイウアウウアイアエウアイウアウウイエウエウエウイイエ",
  },
  "2024-fall": {
    calendarYear: "2024", eraLabel: "令和6年度秋期", shortLabel: "R6秋", season: "秋期", pageCount: 40,
    pageAnchors: [[1, 4], [15, 10], [37, 20], [62, 30], [80, 38]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06a_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06a_ap_am_ans.pdf",
    explanationCode: "06_aki",
    answers: "ウエウアウイウウウイウエエイアウアエウウウウウウイエイウイイイウウウエアウウアウウイエイイアウイイエウエアエエウイアアウイエイイウアエウウウウアイウイイアイアウ",
  },
  "2024-spring": {
    calendarYear: "2024", eraLabel: "令和6年度春期", shortLabel: "R6春", season: "春期", pageCount: 44,
    pageAnchors: [[1, 4], [10, 10], [34, 20], [55, 30], [80, 41]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_ap_am_ans.pdf",
    explanationCode: "06_haru",
    answers: "エエアエウエアエウエアウアイウイイイエエウウアエアウエウウイアエエイイウアイイウイアイウイエウエイイアエエアウエウアアウウアエエエエウエアエエアエエウエウアウエ",
  },
  "2023-fall": {
    calendarYear: "2023", eraLabel: "令和5年度秋期", shortLabel: "R5秋", season: "秋期", pageCount: 44,
    pageAnchors: [[1, 4], [14, 10], [35, 20], [57, 30], [80, 39]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05a_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05a_ap_am_ans.pdf",
    explanationCode: "05_aki",
    answers: "ウエアアウウイウウアイイイエエエアイエエウウアアイエアアイアウイイイエウアウアアイウアアエウエアアアエウアエアイイウウイイアエウアエアウイウエイイエエイエエアイ",
  },
  "2023-spring": {
    calendarYear: "2023", eraLabel: "令和5年度春期", shortLabel: "R5春", season: "春期", pageCount: 44,
    pageAnchors: [[1, 3], [17, 10], [37, 20], [57, 30], [80, 40]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05h_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05h_ap_am_ans.pdf",
    explanationCode: "05_haru",
    answers: "アアアウウエアイウイアアイイエエウアエアイアエエウウエアエアイウウエイアウウウイアイエエエウウイイエエアイエエイウイアエアアウエアエウイイウイウエウウアエイエエ",
  },
  "2022-fall": {
    calendarYear: "2022", eraLabel: "令和4年度秋期", shortLabel: "R4秋", season: "秋期", pageCount: 40,
    pageAnchors: [[1, 3], [19, 10], [43, 20], [61, 30], [80, 38]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt80000008smf-att/2022r04a_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt80000008smf-att/2022r04a_ap_am_ans.pdf",
    explanationCode: "04_aki",
    answers: "イエアイイエエイイエイウウエアイウウウウウエウアエイイウウイウアウエエウアウアイイイアイイアイイエウウイエウイウイエウアエイウイエエエウイエウイウイエウイウエア",
  },
  "2022-spring": {
    calendarYear: "2022", eraLabel: "令和4年度春期", shortLabel: "R4春", season: "春期", pageCount: 40,
    pageAnchors: [[1, 3], [20, 10], [43, 20], [68, 30], [80, 35]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt80000009sgk-att/2022r04h_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt80000009sgk-att/2022r04h_ap_am_ans.pdf",
    explanationCode: "04_haru",
    answers: "アアウアアエエエイエイウアアエウイウイエウウウウアウアウアアイウイアエエウエアイエウイウウエイアエアエアウアウエイアイアアエイウアアウウエエウウアウイエエアウエ",
  },
  "2021-fall": {
    calendarYear: "2021", eraLabel: "令和3年度秋期", shortLabel: "R3秋", season: "秋期", pageCount: 44,
    pageAnchors: [[1, 4], [15, 10], [38, 20], [55, 30], [80, 42]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000apad-att/2021r03a_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000apad-att/2021r03a_ap_am_ans.pdf",
    explanationCode: "03_aki",
    answers: "エエウアウイウエエイアイエアエアアウアアアアイエウエイイイエアアエイエイイウアウアアアイエイアウアイエイイエウイエウイウアウアイイエアイエアエイアウアウアアエア",
  },
  "2021-spring": {
    calendarYear: "2021", eraLabel: "令和3年度春期", shortLabel: "R3春", season: "春期", pageCount: 44,
    pageAnchors: [[1, 4], [15, 10], [38, 20], [54, 30], [80, 40]],
    pdf: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000d5ru-att/2021r03h_ap_am_qs.pdf",
    answer: "https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000d5ru-att/2021r03h_ap_am_ans.pdf",
    explanationCode: "03_haru",
    answers: "アアウアウエウウウイイイウエアアイイエエエウウアウエウイアイエアエウエイイイウアアウアイウウエアアエアエアエエアイウアウウウアアエウウウイイイイエウイエイエイイ",
  },
};

const choiceMap: Record<string, number> = { "ア": 0, "イ": 1, "ウ": 2, "エ": 3 };

function fieldFor(number: number) {
  if (number <= 50) return "テクノロジ系";
  if (number <= 60) return "マネジメント系";
  return "ストラテジ系";
}

function mappedPdfPage(number: number, anchors: readonly PageAnchor[]) {
  // IPA公式PDFを実際に確認した複数の基準点から、区間ごとに掲載ページを補間する。
  // PDF全体を単純均等割りする旧方式より、年度ごとの改ページ差を反映できる。
  if (number <= anchors[0][0]) return anchors[0][1];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [q1, p1] = anchors[i];
    const [q2, p2] = anchors[i + 1];
    if (number <= q2) {
      const ratio = (number - q1) / (q2 - q1);
      return Math.round(p1 + ratio * (p2 - p1));
    }
  }

  return anchors[anchors.length - 1][1];
}

function buildQuestions(key: OfficialA1Year): OfficialA1Question[] {
  const s = sources[key];
  const answerChars = Array.from(s.answers);
  if (answerChars.length !== 80) throw new Error(`${key}: AP午前解答が80問ではありません (${answerChars.length})`);

  return answerChars.map((char, index) => {
    const number = index + 1;
    const category = fieldFor(number);
    const explanationUrl = `https://www.ap-siken.com/kakomon/${s.explanationCode}/q${number}.html`;
    const learningPoint = `${s.eraLabel} 応用情報技術者試験 午前 問${number}。IPA公式問題で解き、問題別の詳しい解説で正答根拠・計算過程・他肢の違いまで確認する。`;
    return {
      id: `a1-ap-${key}-q${String(number).padStart(2, "0")}`,
      exam: "A-1",
      number,
      pdfPage: mappedPdfPage(number, s.pageAnchors),
      category,
      subcategory: `応用情報 午前・問${number}`,
      question: `IPA公式 ${s.eraLabel} 応用情報技術者試験 午前 問${number}を公式PDFで確認して解答してください。`,
      choices: ["ア", "イ", "ウ", "エ"],
      answer: choiceMap[char],
      explanation: learningPoint,
      learningPoint,
      source: `IPA ${s.eraLabel} 応用情報技術者試験 午前 問${number}`,
      sourceUrl: s.pdf,
      explanationUrl,
      year: key,
      official: true,
    };
  });
}

export const officialA1Sessions: OfficialA1Year[] = [
  "2025-fall",
  "2025-spring",
  "2024-fall",
  "2024-spring",
  "2023-fall",
  "2023-spring",
  "2022-fall",
  "2022-spring",
  "2021-fall",
  "2021-spring",
];

export const officialA1Sets = Object.fromEntries(
  officialA1Sessions.map((key) => {
    const s = sources[key];
    return [key, {
      year: key,
      calendarYear: s.calendarYear,
      eraLabel: s.eraLabel,
      shortLabel: s.shortLabel,
      season: s.season,
      pdfUrl: s.pdf,
      answerPdfUrl: s.answer,
      questions: buildQuestions(key),
    } satisfies OfficialA1Set];
  }),
) as Record<OfficialA1Year, OfficialA1Set>;

export const officialA1AllQuestions = officialA1Sessions.flatMap((key) => officialA1Sets[key].questions);
