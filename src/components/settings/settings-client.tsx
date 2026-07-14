"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LogIn, Palette, Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { STUDY_LANGUAGE_CODES, studyLanguageLabels, type StudyLanguage } from "@/lib/study-language";

type AccentChoice = {
  label: string;
  value: string;
  swatch?: string;
};

type ThemeName = "light" | "dark" | "mist" | "contrast";

const themeClasses: Record<ThemeName, string[]> = {
  light: ["theme-light", "bg-[#f7fbf8]", "text-slate-950"],
  dark: ["theme-dark", "bg-slate-950", "text-slate-100"],
  mist: ["theme-mist", "bg-[#f2f7fb]", "text-slate-950"],
  contrast: ["theme-contrast", "bg-white", "text-slate-950"],
};

const allThemeClasses = Object.values(themeClasses).flat();

const accentChoices: AccentChoice[] = [
  { label: "Forge Green", value: "#1f9d8a" },
  { label: "Study Blue", value: "#2563eb" },
  { label: "Coral", value: "#e15f41" },
  { label: "Violet", value: "#7c3aed" },
  {
    label: "Rainbow",
    value: "rainbow",
    swatch: "linear-gradient(135deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)",
  },
];

function normalizeTheme(value: string): ThemeName {
  return value === "dark" || value === "mist" || value === "contrast" ? value : "light";
}

function accentValues(value: string) {
  if (value === "rainbow") {
    return {
      color: "#1f9d8a",
      background: "linear-gradient(135deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)",
    };
  }
  return { color: value, background: value };
}

export function SettingsClient({
  setting,
  stats,
  account,
}: {
  setting: { theme: string; accentColor: string; studyLanguage: string };
  stats: { dailyGoal: number };
  account: { name: string; email: string };
}) {
  const router = useRouter();
  const [theme, setTheme] = useState(setting.theme);
  const [accentColor, setAccentColor] = useState(setting.accentColor);
  const [studyLanguage, setStudyLanguage] = useState<StudyLanguage>(
    STUDY_LANGUAGE_CODES.includes(setting.studyLanguage as StudyLanguage) ? (setting.studyLanguage as StudyLanguage) : "en",
  );
  const [dailyGoal, setDailyGoal] = useState(stats.dailyGoal);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const colorInputValue = /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#1f9d8a";

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".studyforge-shell");
    if (!shell) return;

    const nextTheme = normalizeTheme(theme);
    const accent = accentValues(accentColor);
    shell.classList.remove(...allThemeClasses, "theme-rainbow");
    shell.classList.add(...themeClasses[nextTheme]);
    if (accentColor === "rainbow") shell.classList.add("theme-rainbow");
    shell.style.setProperty("--accent-color", accent.color);
    shell.style.setProperty("--accent-bg", accent.background);
  }, [theme, accentColor]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, accentColor, studyLanguage, dailyGoal }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setMessage("Preferences saved.");
        router.refresh();
      } else {
        setMessage(data.error?.message || "Could not save settings.");
      }
    } catch {
      setMessage("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-emerald-700" />
            Preferences
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-5">
            <div className="space-y-2">
              <Label>Theme</Label>
              <Select value={theme} onChange={(event) => setTheme(event.target.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="mist">Soft Mist</option>
                <option value="contrast">High Contrast</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Accent color</Label>
              <div className="flex flex-wrap gap-2">
                {accentChoices.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => setAccentColor(choice.value)}
                    className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium transition hover:bg-slate-50"
                    aria-pressed={accentColor === choice.value}
                  >
                    <span
                      className="h-4 w-4 rounded-full ring-1 ring-slate-200"
                      style={{ background: choice.swatch || choice.value }}
                    />
                    {choice.label}
                    {accentColor === choice.value ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                ))}
              </div>
              <Input type="color" value={colorInputValue} onChange={(event) => setAccentColor(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Study language</Label>
              <Select value={studyLanguage} onChange={(event) => setStudyLanguage(event.target.value as StudyLanguage)}>
                {STUDY_LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {studyLanguageLabels[code]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Daily review goal</Label>
              <Input type="number" min={1} max={200} value={dailyGoal} onChange={(event) => setDailyGoal(Number(event.target.value))} />
            </div>
            <Button className="min-w-44" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save preferences"}
            </Button>
            {message ? <p className="text-sm text-slate-600">{message}</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600">
          <div>
            <p className="font-semibold text-slate-950">{account.name}</p>
            <p>{account.email}</p>
          </div>
          <div className="grid gap-2">
            <Button asChild variant="secondary">
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                Login
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/register">
                <UserPlus className="h-4 w-4" />
                Sign up
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
