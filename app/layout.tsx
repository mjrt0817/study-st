import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ST A-1 Trainer",
  description: "ITストラテジスト 科目A-1 学習アプリ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
