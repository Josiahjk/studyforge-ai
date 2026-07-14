import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudyForge AI",
  description: "A local AI study workspace for flashcards, quizzes, spaced repetition, and tutoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
