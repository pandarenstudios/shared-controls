import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/maps': 'http://localhost:3001',
    },
  },
});
