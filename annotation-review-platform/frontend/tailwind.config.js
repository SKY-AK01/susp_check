/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { 
    extend: {
      boxShadow: {
        'neo': '4px 4px 0px 0px rgba(0,0,0,1)',
        'neo-sm': '2px 2px 0px 0px rgba(0,0,0,1)',
        'neo-hover': '2px 2px 0px 0px rgba(0,0,0,1)',
      },
      colors: {
        'neo-peach': '#F5D0B5',
        'neo-lavender': '#C2B5F5',
        'neo-mint': '#B5F5D0',
        'neo-yellow': '#F5F2B5',
        'neo-pink': '#F5B5D0',
        'neo-bg': '#FFFBF5',
      }
    } 
  },
  plugins: [],
};
