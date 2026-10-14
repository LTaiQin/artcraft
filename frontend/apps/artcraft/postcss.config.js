import { fileURLToPath } from 'node:url';

export default {
  plugins: {
    'postcss-import': {},
    'tailwindcss/nesting': 'postcss-nesting',
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) },
    autoprefixer: {},
  }
}