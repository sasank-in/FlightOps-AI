import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Light / dark theme. Charts need concrete colours (SVG presentation attributes cannot use CSS
 * variables), so the resolved token values are exposed here and re-read when the theme changes.
 */
export type Theme = "light" | "dark";

export interface ChartColors {
  series1: string;
  series2: string;
  critical: string;
  grid: string;
  axis: string;
  ink: string;
  surface: string;
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  colors: ChartColors;
}

const KEY = "flightops.theme";
const ThemeContext = createContext<ThemeState | null>(null);

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage unavailable
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    series1: v("--series-1", "#2a78d6"),
    series2: v("--series-2", "#eb6834"),
    critical: v("--status-critical", "#d03b3b"),
    grid: v("--grid", "#e7e9ec"),
    axis: v("--axis", "#cfd4da"),
    ink: v("--chart-ink", "#656c79"),
    surface: v("--card", "#ffffff"),
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [colors, setColors] = useState<ChartColors>(() => {
    document.documentElement.dataset.theme = theme;
    return readColors();
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setColors(readColors());
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // storage unavailable
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);
  const value = useMemo(() => ({ theme, toggle, colors }), [theme, toggle, colors]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
