import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "מיפוי משפטי לעסקים",
  description: "מיפוי סיכונים משפטיים בליווי עורך/ת דין — דיני עבודה, פרילנסרים ופרטיות במקום העבודה.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
