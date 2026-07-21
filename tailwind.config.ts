import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F6F7F5",
        surface: "#FFFFFF",
        ink: "#101B17",
        muted: "#5C6B64",
        line: "#E4E8E4",
        primary: { DEFAULT: "#0E7A5F", soft: "#E3F2EC", deep: "#0A5C48" },
        saffron: { DEFAULT: "#E8A13C", soft: "#FBF0DD" },
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,27,23,0.06), 0 4px 16px rgba(16,27,23,0.05)",
        panel: "-8px 0 32px rgba(16,27,23,0.10)",
      },
    },
  },
  plugins: [],
};
export default config;
