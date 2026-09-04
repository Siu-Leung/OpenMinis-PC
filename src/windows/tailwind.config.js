/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 语义化 design token (对标原版 ChatColors.kt)
        accent: "var(--accent-color)",
      },
      borderRadius: {
        "minis-sm": "12px",
        "minis-md": "20px",
        "minis-lg": "24px",
        "minis-xl": "28px",
      },
    },
  },
  plugins: [],
}
