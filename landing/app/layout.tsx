import type { Metadata } from "next";
import { Anton, Playfair_Display, Inter } from "next/font/google";
import "./globals.css";

// Heavy condensed grotesque — the bold "CRYPTO"-style headlines.
const anton = Anton({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

// Elegant high-contrast serif — the green "Off" / "HOT" accents.
const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});

// Clean grotesque — body copy, labels, UI.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TORU — Autonomous on-chain copy-trading",
  description: "Follow the best traders and let your TORU agent mirror their moves on-chain — non-custodial, 24/7, within the limits you set.",
  keywords: ["copy trading", "AI agents", "Mantle", "DeFi", "on-chain trading", "toru", "non-custodial"],
  authors: [{ name: "TORU" }],
  openGraph: {
    title: "TORU — Autonomous on-chain copy-trading",
    description: "Follow the best traders and let your TORU agent mirror their moves on-chain — non-custodial, 24/7, within the limits you set.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${anton.variable} ${playfair.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
