import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://www.nseaswimteam.com',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
