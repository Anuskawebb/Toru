import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["800", "900"],
});

export const metadata: Metadata = {
  title: "Aionis — AI copy-trading agents on Mantle",
  description: "Deploy AI agents that copy top traders on Mantle — on-chain, in real time, fully autonomous.",
  keywords: ["copy trading", "AI agents", "Mantle", "DeFi", "on-chain trading", "aionis"],
  authors: [{ name: "Aionis" }],
  openGraph: {
    title: "Aionis — AI copy-trading agents on Mantle",
    description: "Deploy AI agents that copy top traders on Mantle — on-chain, in real time, fully autonomous.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${montserrat.variable}`}>
      <body id="midu-body">
        {children}
      </body>
    </html>
  );
}
