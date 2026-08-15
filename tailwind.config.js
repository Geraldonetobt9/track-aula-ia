/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        surface: '#131a22',
        border: '#1f2a35',
        muted: '#7d8b9a',
        accent: '#3b82f6',
      },
    },
  },
  plugins: [],
};
