"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  FileText,
  FileUp,
  Home,
  Layers3,
  Settings,
  Sparkles,
  Trophy,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { LogoutButton } from "@/components/layout/logout-button";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/decks", label: "Decks", icon: Layers3 },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/import", label: "Import", icon: FileUp },
  { href: "/tutor", label: "Tutor", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  user,
  children,
}: {
  user: {
    name: string;
    email: string;
    setting?: { theme: string; accentColor: string } | null;
    stats?: { level: number; xp: number; streak: number } | null;
  };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const rawAccent = user.setting?.accentColor || "#1f9d8a";
  const accentColor = rawAccent === "rainbow" ? "#1f9d8a" : rawAccent;
  const accentBackground =
    rawAccent === "rainbow"
      ? "linear-gradient(135deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)"
      : accentColor;
  const theme = user.setting?.theme || "light";
  const themeClass =
    theme === "dark"
      ? "theme-dark bg-slate-950 text-slate-100"
      : theme === "contrast"
        ? "theme-contrast bg-white text-slate-950"
        : theme === "mist"
          ? "theme-mist bg-[#f2f7fb] text-slate-950"
          : "theme-light bg-[#f7fbf8] text-slate-950";
  const shellStyle = {
    "--accent-color": accentColor,
    "--accent-bg": accentBackground,
  } as CSSProperties;

  return (
    <div className={cn("studyforge-shell min-h-screen", rawAccent === "rainbow" && "theme-rainbow", themeClass)} style={shellStyle}>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-full flex-col">
          <Link href="/dashboard" className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: "var(--accent-bg)" }}>
              <Sparkles className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold">StudyForge AI</span>
              <span className="text-xs text-slate-500">Local learning lab</span>
            </span>
          </Link>
          <nav className="flex-1 space-y-1 p-3">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100",
                    active && "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100",
                  )}
                  style={
                    active
                      ? {
                          background: "color-mix(in oklab, var(--accent-color) 12%, transparent)",
                          color: "var(--accent-color)",
                        }
                      : undefined
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-coral-100 text-sm font-bold text-coral-900">
                {initials(user.name)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-slate-500">Level {user.stats?.level ?? 1}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-bold lg:hidden">
              <Sparkles className="h-5 w-5" style={{ color: "var(--accent-color)" }} />
              StudyForge AI
            </Link>
            <div className="hidden items-center gap-2 text-sm text-slate-600 lg:flex">
              <Trophy className="h-4 w-4 text-yellow-600" />
              <span>{user.stats?.streak ?? 0} day streak</span>
              <span className="text-slate-300">/</span>
              <span>{user.stats?.xp ?? 0} XP</span>
            </div>
            <LogoutButton />
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-2 lg:hidden">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-semibold text-slate-700",
                    active && "bg-emerald-50 text-emerald-800",
                  )}
                  style={
                    active
                      ? {
                          background: "color-mix(in oklab, var(--accent-color) 12%, transparent)",
                          color: "var(--accent-color)",
                        }
                      : undefined
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="animate-page-in mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        {body ? <p className="mt-2 max-w-2xl text-sm text-slate-600">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}
