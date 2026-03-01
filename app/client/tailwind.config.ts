import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#f5e6c8",
        "hq-dark": "#1a0e00",
        "hq-brown": "#3d1f00",
        "hq-amber": "#d97706",
        "hq-red": "#dc2626",
        "hq-green": "#16a34a",
      },
      fontFamily: {
        display: ["Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
