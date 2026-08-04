import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@nodemelivre/core/test-utils': resolve('packages/core/src/test-utils.ts'),
      '@nodemelivre/core': resolve('packages/core/src/index.ts'),
      '@nodemelivre/types': resolve('packages/types/src/index.ts'),
      '@nodemelivre/auth': resolve('packages/auth/src/index.ts'),
      '@nodemelivre/items': resolve('packages/items/src/index.ts'),
      '@nodemelivre/orders': resolve('packages/orders/src/index.ts'),
      '@nodemelivre/users': resolve('packages/users/src/index.ts'),
      '@nodemelivre/shipments': resolve('packages/shipments/src/index.ts'),
      '@nodemelivre/questions': resolve('packages/questions/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
  },
})
