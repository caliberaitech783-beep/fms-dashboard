/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        coal: {
          50: "#f5f7f8",
          100: "#e7ebee",
          200: "#ccd5dc",
          300: "#a6b7c2",
          400: "#7890a0",
          500: "#5d7484",
          600: "#4b5f6c",
          700: "#3f505b",
          800: "#37454d",
          900: "#111b22",
          950: "#091016"
        },
        ore: {
          500: "#14b8a6",
          600: "#0f766e",
          700: "#115e59"
        },
        safety: {
          green: "#1f9d74",
          amber: "#e3a008",
          red: "#d64545",
          blue: "#2f80ed"
        }
      },
      boxShadow: {
        command: "0 20px 50px -20px rgba(9,16,22,0.45)"
      }
    }
  },
  plugins: []
};
