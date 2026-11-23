/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Palette taken from zaproxy.org's stylesheet (--blue, --blue-dark, --orange, --blue--lightest, --blue-border).
      colors: {
        zap: { blue: "#4389ff", dark: "#00549e", orange: "#ffa400", "orange-dark": "#bf8416", lightest: "#f4faff", border: "#dceaff" },
        indigo: { 50: "#f4faff", 100: "#dceaff", 200: "#bbdefb", 300: "#8fbdf5", 400: "#4389ff", 500: "#2f74e8", 600: "#00549e", 700: "#00457f", 800: "#003a6b", 900: "#002c52" },
        slate: { 50: "#f4faff", 100: "#eaf3ff", 200: "#dceaff", 300: "#c5d6ea", 400: "#7e92a4", 500: "#5b6f82", 600: "#444b55", 700: "#2f3640", 800: "#1e293b", 900: "#0f172a" },
      },
      fontFamily: {
        sans: ['"Open Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        nav: ["Quicksand", '"Open Sans"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
