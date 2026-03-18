/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Avenir Next"', "Avenir", '"Helvetica Neue"', '"Segoe UI"', "Arial", "sans-serif"],
        display: ['"Avenir Next"', "Avenir", '"Helvetica Neue"', '"Segoe UI"', "Arial", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        cream: {
          50: "#FFFCF7",
          100: "#F7F2EA",
          200: "#EEE6D8",
          300: "#DCCFBB",
        },
        navy: {
          DEFAULT: "#342F2B",
          50: "#F6F4F0",
          100: "#ECE6DE",
          200: "#D8CEC0",
          300: "#B9AA98",
          400: "#948372",
          500: "#716254",
          600: "#54493F",
          700: "#3B332D",
          800: "#2A241F",
          900: "#1A1613",
        },
        orange: {
          DEFAULT: "#B88A52",
          50: "#FCF7F0",
          100: "#F3E7D4",
          200: "#E6CFAB",
          300: "#D2B27E",
          400: "#BE965B",
          500: "#B88A52",
          600: "#946C40",
          700: "#715232",
          800: "#543D25",
          900: "#3A2918",
        },
        dark: {
          bg: "#161412",
          card: "#221E1A",
          border: "#3A332D",
          text: "#F6F1E8",
          muted: "#B2A697",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      boxShadow: {
        float: "0 24px 60px rgba(55, 43, 30, 0.12)",
        soft: "0 16px 40px rgba(52, 47, 43, 0.08)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-slide": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-slide": "fade-slide 0.35s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
