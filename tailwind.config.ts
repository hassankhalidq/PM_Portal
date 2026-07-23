import type { Config } from "tailwindcss";

// Tailwind's runtime accepts a callback here (used to support the `/opacity`
// modifier on a CSS-var-backed color), but its TS types only declare string
// values — the cast reflects what Tailwind actually does at build time.
function withOpacity(rgbVar: string): string {
  return (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined ? `rgb(var(${rgbVar}))` : `rgb(var(${rgbVar}) / ${opacityValue})`) as unknown as string;
}

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        text: { DEFAULT: "var(--text)", muted: withOpacity("--text-muted-rgb") },
        border: "var(--border)",
        accent: { DEFAULT: withOpacity("--accent-rgb"), hover: "var(--accent-hover)" },
        success: withOpacity("--success-rgb"),
        danger: withOpacity("--danger-rgb"),
        info: withOpacity("--info-rgb"),
        warning: withOpacity("--warning-rgb"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
