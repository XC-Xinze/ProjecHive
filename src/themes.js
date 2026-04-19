// ── Theme Definitions ──
// Each theme provides a full set of CSS custom properties.
// Colors marked as primary/secondary come from the design specs;
// surface, text, error, warning, and shadow colors are derived to
// complement each theme's palette.

const themes = {
  serene: {
    id: 'serene',
    name: 'Serene Architect',
    description: 'Indigo & warm neutrals',
    preview: ['#4456ba', '#8596ff', '#f9f9f7'],
    fonts: {
      body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "'Manrope', 'Inter', sans-serif",
    },
    colors: {
      '--color-primary': '#4456ba',
      '--color-primary-light': '#8596ff',
      '--color-primary-dim': '#3a4a9e',
      '--color-primary-surface': '#eef0ff',
      '--color-secondary': '#4a6800',
      '--color-secondary-light': '#bae26e',
      '--color-surface': '#f9f9f7',
      '--color-surface-low': '#f1f1ee',
      '--color-surface-card': '#ffffff',
      '--color-surface-highest': '#e8e8e4',
      '--color-on-surface': '#2f3332',
      '--color-on-surface-variant': '#6b706e',
      '--color-on-surface-dim': '#9ca19f',
      '--color-error': '#a83836',
      '--color-error-surface': '#fef2f2',
      '--color-warning': '#b8860b',
      '--color-warning-surface': '#fef9ee',
      '--shadow-card': '0 1px 3px rgba(47, 51, 50, 0.04)',
      '--shadow-lifted': '0 8px 30px rgba(47, 51, 50, 0.08)',
      '--shadow-float': '0 12px 40px rgba(47, 51, 50, 0.12)',
    },
  },

  modern: {
    id: 'modern',
    name: 'Modern Blue',
    description: 'Professional blue tones',
    preview: ['#1275e2', '#5da3f5', '#f7f8fa'],
    fonts: {
      body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    colors: {
      '--color-primary': '#1275e2',
      '--color-primary-light': '#5da3f5',
      '--color-primary-dim': '#0f62bf',
      '--color-primary-surface': '#e8f2fd',
      '--color-secondary': '#5f78a3',
      '--color-secondary-light': '#8fa4c4',
      '--color-surface': '#f7f8fa',
      '--color-surface-low': '#eef0f4',
      '--color-surface-card': '#ffffff',
      '--color-surface-highest': '#e2e5eb',
      '--color-on-surface': '#1a1c20',
      '--color-on-surface-variant': '#5a6070',
      '--color-on-surface-dim': '#8d929e',
      '--color-error': '#d32f2f',
      '--color-error-surface': '#fef2f2',
      '--color-warning': '#c55b00',
      '--color-warning-surface': '#fff3e0',
      '--shadow-card': '0 1px 3px rgba(26, 28, 32, 0.05)',
      '--shadow-lifted': '0 8px 30px rgba(26, 28, 32, 0.08)',
      '--shadow-float': '0 12px 40px rgba(26, 28, 32, 0.12)',
    },
  },

  triceratops: {
    id: 'triceratops',
    name: 'Triceratops',
    description: 'Natural Geometry',
    preview: ['#66BB6A', '#AED581', '#f8faf7'],
    fonts: {
      body: "'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    colors: {
      '--color-primary': '#66BB6A',
      '--color-primary-light': '#AED581',
      '--color-primary-dim': '#4caf50',
      '--color-primary-surface': '#e8f5e9',
      '--color-secondary': '#AED581',
      '--color-secondary-light': '#c5e1a5',
      '--color-surface': '#f8faf7',
      '--color-surface-low': '#eff3ec',
      '--color-surface-card': '#ffffff',
      '--color-surface-highest': '#e0e6db',
      '--color-on-surface': '#1b2618',
      '--color-on-surface-variant': '#4a5d4e',
      '--color-on-surface-dim': '#8a9e8d',
      '--color-error': '#e53935',
      '--color-error-surface': '#fef2f2',
      '--color-warning': '#e68a00',
      '--color-warning-surface': '#fff8e1',
      '--shadow-card': '0 1px 3px rgba(27, 38, 24, 0.04)',
      '--shadow-lifted': '0 8px 30px rgba(27, 38, 24, 0.07)',
      '--shadow-float': '0 12px 40px rgba(27, 38, 24, 0.11)',
    },
  },

  xzFlame: {
    id: 'xzFlame',
    name: 'XZ Flame',
    description: 'Passion · Energy · Warmth',
    preview: ['#D90429', '#F77F00', '#faf8f7'],
    fonts: {
      body: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    colors: {
      '--color-primary': '#D90429',
      '--color-primary-light': '#F77F00',
      '--color-primary-dim': '#b50321',
      '--color-primary-surface': '#fde8ec',
      '--color-secondary': '#F77F00',
      '--color-secondary-light': '#FCBF49',
      '--color-surface': '#faf8f7',
      '--color-surface-low': '#f3efed',
      '--color-surface-card': '#ffffff',
      '--color-surface-highest': '#e8e2df',
      '--color-on-surface': '#2d1f1f',
      '--color-on-surface-variant': '#6e5a5a',
      '--color-on-surface-dim': '#9a8e8e',
      '--color-error': '#c62828',
      '--color-error-surface': '#fef2f2',
      '--color-warning': '#FCBF49',
      '--color-warning-surface': '#fffde7',
      '--shadow-card': '0 1px 3px rgba(45, 31, 31, 0.05)',
      '--shadow-lifted': '0 8px 30px rgba(45, 31, 31, 0.08)',
      '--shadow-float': '0 12px 40px rgba(45, 31, 31, 0.12)',
    },
  },

  xzCool: {
    id: 'xzCool',
    name: 'XZ Cool',
    description: 'Calm · Rational · Order',
    preview: ['#334155', '#64748b', '#f8fafc'],
    fonts: {
      body: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      display: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    colors: {
      '--color-primary': '#334155',
      '--color-primary-light': '#64748b',
      '--color-primary-dim': '#1e293b',
      '--color-primary-surface': '#e8ecf1',
      '--color-secondary': '#64748b',
      '--color-secondary-light': '#94a3b8',
      '--color-surface': '#f8fafc',
      '--color-surface-low': '#f1f5f9',
      '--color-surface-card': '#ffffff',
      '--color-surface-highest': '#e2e8f0',
      '--color-on-surface': '#0f172a',
      '--color-on-surface-variant': '#475569',
      '--color-on-surface-dim': '#94a3b8',
      '--color-error': '#b91c1c',
      '--color-error-surface': '#fef2f2',
      '--color-warning': '#92400e',
      '--color-warning-surface': '#fffbeb',
      '--shadow-card': '0 1px 3px rgba(15, 23, 42, 0.05)',
      '--shadow-lifted': '0 8px 30px rgba(15, 23, 42, 0.08)',
      '--shadow-float': '0 12px 40px rgba(15, 23, 42, 0.12)',
    },
  },
}

export const THEME_LIST = Object.values(themes)
export const DEFAULT_THEME = 'serene'

export function getTheme(id) {
  return themes[id] || themes[DEFAULT_THEME]
}

export function applyTheme(id) {
  const theme = getTheme(id)
  const root = document.documentElement

  // Apply color variables
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value)
  }

  // Apply fonts
  root.style.setProperty('--font-body', theme.fonts.body)
  root.style.setProperty('--font-display', theme.fonts.display)
  document.body.style.fontFamily = theme.fonts.body
}
