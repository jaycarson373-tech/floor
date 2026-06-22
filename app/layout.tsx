import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const _spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const _inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "The Floor — Solana Trading MMO",
  description: "An isometric trading floor MMO on Solana. Pick a side. Make your move.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${_spaceGrotesk.variable} ${_inter.variable} bg-background`}>
      <body>{children}</body>
    </html>
  );
}
