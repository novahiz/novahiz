/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#0B0F19",
        card: "#111827",
        border: "#1F2937",
        primary: {
          50: "#EEF2FF",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
        },
        accent: {
          cyan: "#06B6D4",
          violet: "#8B5CF6",
          emerald: "#10B981",
          amber: "#F59E0B",
          rose: "#F43F5E",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "glow-primary": "0 0 25px -5px rgba(99, 102, 241, 0.4)",
        "glow-cyan": "0 0 25px -5px rgba(6, 182, 212, 0.4)",
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
      },
    },
  },
  plugins: [],
};
