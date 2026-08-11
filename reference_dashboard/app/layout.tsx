import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Novahiz Control Center — Dynamic AI Telemetry",
  description:
    "Enterprise dashboard for monitoring Novahiz agent compliance, sessions, and telemetry.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className="dark">
      <body className="antialiased min-h-screen text-slate-100 flex flex-col">
        {children}
      </body>
    </html>
  );
}
