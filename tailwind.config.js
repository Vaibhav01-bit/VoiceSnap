/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: "class",
    content: ["./popup/**/*.{html,js}"],
    theme: {
        extend: {
            colors: {
                "primary": "#0db9f2",
                "background-light": "#f5f8f8",
                "background-dark": "#020617",
            },
            fontFamily: {
                "display": ["Space Grotesk", "sans-serif"]
            }
        }
    },
    plugins: [],
}
