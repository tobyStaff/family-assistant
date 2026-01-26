/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,js}',
    './public/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        // Trust Blue Palette
        'alabaster': '#FAF9F6',
        'trust-blue': '#2A5C82',
        'trust-blue-dark': '#1E4562',
        'sky': '#E3F2FD',
        'growth-green': '#4CAF50',
        'warm-sand': '#FFF8E1',
        'soft-mint': '#E8F5E9',
      },
      fontFamily: {
        'display': ['Fraunces', 'Georgia', 'serif'],
        'body': ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'snug': '24px',
      },
      boxShadow: {
        'ambient': '0 25px 50px -12px rgba(42, 92, 130, 0.08)',
        'ambient-hover': '0 25px 50px -12px rgba(42, 92, 130, 0.15)',
        'card': '0 4px 6px -1px rgba(42, 92, 130, 0.05), 0 2px 4px -2px rgba(42, 92, 130, 0.05)',
      },
    },
  },
  plugins: [],
};
