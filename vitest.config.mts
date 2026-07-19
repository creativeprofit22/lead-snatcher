import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: [
      '**/.next/**',
      '**/node_modules/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/tmp/**',
    ],
  },
});
