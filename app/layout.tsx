import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'UGC動画量産スタジオ',
  description: '静的書き出し対応のUGC動画デモ制作アプリ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
