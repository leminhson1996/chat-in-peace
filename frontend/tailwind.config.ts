import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Discord-like palette
        discord: {
          bg:        '#1e1f22',
          sidebar:   '#2b2d31',
          channel:   '#313338',
          hover:     '#35373c',
          active:    '#404249',
          text:      '#dcddde',
          muted:     '#949ba4',
          accent:    '#5865f2',
          'accent-hover': '#4752c4',
          mention:   '#eb459e',
          green:     '#57f287',
          red:       '#ed4245',
          header:    '#1e1f22',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
