/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { 
    extend: {
      boxShadow: {
        'neo': '4px 4px 0px 0px rgba(0,0,0,1)',
        'neo-sm': '2px 2px 0px 0px rgba(0,0,0,1)',
        'neo-hover': '2px 2px 0px 0px rgba(0,0,0,1)',
        'neo-lg': '6px 6px 0px 0px rgba(0,0,0,1)',
      },
      colors: {
        // Bold flat accent palette (from reference image)
        'neo-orange': '#F4603A',   // primary CTA, card accent
        'neo-teal':   '#00C9A7',   // success, exact match
        'neo-yellow': '#FFD600',   // warning, highlight
        'neo-blue':   '#2B5BFF',   // info, links
        'neo-red':    '#FF3B30',   // error, missing
        'neo-purple': '#7B61FF',   // extra/misc

        // Surfaces
        'neo-bg':     '#FFF5F5',   // page background (warm off-white)
        'neo-card':   '#FFFFFF',   // card background

        // Legacy pastel aliases (used in a few places, keep for compat)
        'neo-peach':    '#F4603A',
        'neo-lavender': '#7B61FF',
        'neo-mint':     '#00C9A7',
        'neo-pink':     '#FF3B30',
      }
    } 
  },
  plugins: [],
};
