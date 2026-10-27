import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loker terbaru",
  description: "Lowongan terbaru dari JobStreet dan Glints",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
