/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./ui/comp/**/*.templ",
    "./ui/pages/**/*.templ",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary:   "var(--bp)",
          secondary: "var(--bs)",
        },
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
    },
  },
  plugins: [],
}
