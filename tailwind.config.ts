import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', '"SF Pro Display"', "Inter", '"Segoe UI"', "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      colors: {
        brand: { 50: "#eef5fe", 700: "#0062c4" },
        slate: {
          50: "#f5f5f7", 100: "#efeff1", 200: "#e3e3e8", 300: "#d2d2d7", 400: "#a1a1a6",
          500: "#6e6e73", 600: "#515154", 700: "#3a3a3c", 800: "#2c2c2e", 900: "#1d1d1f",
        },
        emerald: { 50: "#ecf8ef", 100: "#d4f0db", 600: "#248a3d", 700: "#1d6f31" },
        red: { 50: "#fdeeee", 600: "#d70015", 700: "#b00012" },
        amber: { 50: "#fff6e6", 600: "#b25000", 700: "#934200" },
      },
      borderRadius: { "2xl": "20px" },
      boxShadow: { card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.04)" },
      letterSpacing: { display: "-0.022em" },
    },
  },
  plugins: [],
} satisfies Config;
