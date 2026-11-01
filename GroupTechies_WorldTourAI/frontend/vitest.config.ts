import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Component tests (My trips). Pure-rule tests run with node's own test runner (see "test" in package.json).
export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: 'automatic' },
  test: { env: { VITE_SERVER_URL: 'http://api.test', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_dummy' }, environment: 'jsdom', include: ['test/**/*.test.tsx'], setupFiles: ['test/setup.ts'], restoreMocks: true },
})
