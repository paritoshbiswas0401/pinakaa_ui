/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./views/**/*.ejs"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'primary-fixed': '#FFF6EE',
        'on-error-container': '#93000a',
        'inverse-surface': '#2d3133',
        'on-secondary-fixed-variant': '#3f465c',
        surface: '#ffffff',
        primary: '#E84E1B',
        'on-error': '#ffffff',
        'surface-container-highest': '#f4ede8',
        'surface-tint': '#E84E1B',
        'on-primary-fixed': '#4b1b00',
        'on-background': '#191c1e',
        'on-tertiary-fixed-variant': '#38485d',
        'secondary-container': '#FFF1E0',
        'inverse-primary': '#FFD6B3',
        'on-secondary': '#ffffff',
        'tertiary-fixed-dim': '#F7DDBA',
        error: '#ba1a1a',
        'surface-container-high': '#f7efe8',
        'primary-container': '#FFB67A',
        'surface-bright': '#ffffff',
        'on-primary-fixed-variant': '#9a3000',
        outline: '#c9a78f',
        'surface-container': '#fff9f6',
        'surface-container-low': '#fffaf7',
        'surface-container-lowest': '#ffffff',
        'inverse-on-surface': '#eff1f3',
        'on-tertiary-container': '#FFF7E6',
        'on-tertiary-fixed': '#0b1c30',
        secondary: '#6B4226',
        'on-primary-container': '#4b1b00',
        'surface-dim': '#f1e7df',
        'surface-variant': '#f4ebe3',
        'on-tertiary': '#ffffff',
        'tertiary-fixed': '#FFD9AE',
        'on-surface': '#191c1e',
        'primary-fixed-dim': '#FFD6B3',
        'on-secondary-container': '#4a3a2f',
        'tertiary-container': '#7a5a45',
        'error-container': '#ffdad6',
        background: '#fffaf7',
        'on-primary': '#ffffff',
        'secondary-fixed': '#FFF1E0',
        'secondary-fixed-dim': '#F0E0CF',
        'on-secondary-fixed': '#131b2e',
        'outline-variant': '#e6d3c4',
        tertiary: '#7a5a45',
        'on-surface-variant': '#434656'
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
        full: '0.75rem'
      },
      spacing: {
        base: '8px',
        'container-max': '1200px',
        'margin-sm': '16px',
        'margin-md': '32px',
        'margin-lg': '64px',
        gutter: '24px'
      },
      fontFamily: {
        'headline-md': ['Inter'],
        'body-lg': ['Inter'],
        'label-caps': ['Inter'],
        'headline-xl': ['Inter'],
        'headline-lg': ['Inter'],
        'body-md': ['Inter'],
        'technical-md': ['JetBrains Mono'],
        'body-sm': ['Inter'],
        'technical-sm': ['JetBrains Mono']
      },
      fontSize: {
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'label-caps': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '700' }],
        'headline-xl': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'technical-md': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'technical-sm': ['12px', { lineHeight: '16px', fontWeight: '400' }]
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
};
