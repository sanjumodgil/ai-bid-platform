/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm neutral brand palette
        sand: {
          50:  "#FDFBF8",
          100: "#F7F3EE",   // page background
          200: "#EDE7DC",
          300: "#DED5C7",
          400: "#C8B99A",
          500: "#B09A7E",
        },
        clay: {
          50:  "#FAF4EC",
          100: "#F0E3CC",
          200: "#E2C89A",
          300: "#D4AC6A",
          400: "#C8A882",   // primary accent
          500: "#A8885C",
          600: "#8A6C42",
          700: "#6B5130",
        },
        ink: {
          50:  "#F4F1EF",
          100: "#E0D9D5",
          200: "#B8ABA3",
          300: "#8F7E74",
          400: "#6B5A51",
          500: "#2C2420",   // primary text
          600: "#1E1814",
          700: "#140F0C",
        },
        smoke: {
          50:  "#F9F7F6",
          100: "#EDE8E5",
          200: "#D4CCC7",
          300: "#B8AFA9",
          400: "#9E9490",
          500: "#8A7E75",   // secondary text
          600: "#6E6259",
          700: "#534840",
        },
        // Status colours (kept warm)
        go:      { DEFAULT: "#5E8A6A", light: "#EBF3EE" },
        caution: { DEFAULT: "#C8962A", light: "#FDF3DC" },
        nogo:    { DEFAULT: "#B85450", light: "#FBEDED" },
        info:    { DEFAULT: "#5B7FA8", light: "#EBF0F7" },
      },
      fontFamily: {
        sans:    ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        body:    ["Inter", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "Fira Code", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      boxShadow: {
        "warm-sm": "0 1px 2px 0 rgba(44, 36, 32, 0.06)",
        "warm":    "0 2px 8px 0 rgba(44, 36, 32, 0.08), 0 1px 2px 0 rgba(44, 36, 32, 0.04)",
        "warm-md": "0 4px 16px 0 rgba(44, 36, 32, 0.10), 0 2px 4px 0 rgba(44, 36, 32, 0.06)",
        "warm-lg": "0 8px 32px 0 rgba(44, 36, 32, 0.12), 0 4px 8px 0 rgba(44, 36, 32, 0.06)",
      },
      borderRadius: {
        "xl": "0.875rem",
        "2xl": "1.25rem",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "pulse-warm": "pulseWarm 2s cubic-bezier(0.4,0,0.6,1) infinite",
      },
      keyframes: {
        fadeIn:    { "0%": { opacity: "0" },           "100%": { opacity: "1" } },
        slideUp:   { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        pulseWarm: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".6" } },
      },
    },
  },
  plugins: [],
}
