import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      colors: {
        // Lifted well off black: the original set was atmospheric but the
        // board has to stay readable in a bright room mid-match.
        ink: {
          900: "#0e1420",
          800: "#1a2233",
          700: "#232d42",
          600: "#2f3b53",
          500: "#44526e",
        },
        signal: "#5df095",
        alert: "#ff8b95",
        gold: "#fcd34d",
        // the four agency identities — kept distinct at a glance
        nord: "#5cc9fc",
        est: "#fb8fd0",
        sud: "#6ee79a",
        ouest: "#fdad5c",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(0.8)", opacity: "0.9" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        flicker: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        popIn: {
          from: { transform: "scale(0.9)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        slideUp: {
          from: { transform: "translateY(12px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.6s ease-out infinite",
        scan: "scan 3s linear infinite",
        flicker: "flicker 2s ease-in-out infinite",
        popIn: "popIn 160ms ease-out",
        slideUp: "slideUp 220ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
