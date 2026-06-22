import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Floor",
  description: "Phase 1 isometric floor foundation"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
