export type OfficialB1Year = "2025" | "2024";
export type OfficialB1Question = {
  year: OfficialB1Year;
  number: 1 | 2 | 3;
  title: string;
  category: string;
  pdfPage: number;
  focus: string[];
};
export type OfficialB1Set = {
  year: OfficialB1Year;
  eraLabel: string;
  shortLabel: string;
  pdfUrl: string;
  answerPdfUrl: string;
  commentaryPdfUrl: string;
  questions: OfficialB1Question[];
};

export const officialB1Sets: Record<OfficialB1Year, OfficialB1Set> = {
  2025: {
    year: "2025",
    eraLabel: "令和7年度春期",
    shortLabel: "R7",
    pdfUrl: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_st_pm1_qs.pdf",
    answerPdfUrl: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_st_pm1_ans.pdf",
    commentaryPdfUrl: "https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_st_pm1_cmnt.pdf",
    questions: [
      { year: "2025", number: 1, title: "スタートアップ企業の新サービス開発", category: "事業戦略・新サービス", pdfPage: 3, focus: ["市場ニーズと自社の強みを対応付ける", "設問で問われた主体・狙いを外さない", "IT施策が課題解決へどうつながるかまで書く"] },
      { year: "2025", number: 2, title: "自治体の子育て支援強化", category: "社会課題・事業戦略", pdfPage: 9, focus: ["環境変化と施策の成果を区別する", "利用者側の課題と行政側の問題を分ける", "地域一体の支援モデルを本文根拠から組み立てる"] },
      { year: "2025", number: 3, title: "ドラッグストアの新規サービス", category: "顧客体験・サービス戦略", pdfPage: 15, focus: ["企業の戦略上の狙いを答える", "店舗とオンラインの融合を具体化する", "顧客ニーズと業務課題を混同しない"] },
    ],
  },
  2024: {
    year: "2024",
    eraLabel: "令和6年度春期",
    shortLabel: "R6",
    pdfUrl: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_st_pm1_qs.pdf",
    answerPdfUrl: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_st_pm1_ans.pdf",
    commentaryPdfUrl: "https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_st_pm1_cmnt.pdf",
    questions: [
      { year: "2024", number: 1, title: "総合金融サービスと経済圏戦略", category: "事業戦略・金融サービス", pdfPage: 3, focus: ["競争優位を事実ベースで説明する", "顧客ニーズと施策の対応を示す", "将来構想は経営戦略との整合性まで見る"] },
      { year: "2024", number: 2, title: "地方新聞社のデジタルメディア変革", category: "ビジネスモデル変革", pdfPage: 9, focus: ["従来の強みと新しい役割を区別する", "双方向コミュニケーションの価値を捉える", "地域活性化と事業成果の両面を見る"] },
      { year: "2024", number: 3, title: "旅館のIT活用による業務改革", category: "業務改革・ナレッジ活用", pdfPage: 15, focus: ["外形的特徴ではなく競争力の源泉を答える", "暗黙知の形式知化と活用先をつなぐ", "業務効率化と顧客体験の両立を意識する"] },
    ],
  },
};

export const officialB1Years: OfficialB1Year[] = ["2025", "2024"];
