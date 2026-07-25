// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://munadmahinoor.com',
  integrations: [sitemap()],
  build: {
    // The whole site's CSS is ~9KB. Astro's 'auto' leaves anything over 4KB
    // as a <link>, which costs a render-blocking round-trip and — because
    // @font-face lives in that file — pushes the Archivo woff2 out to a
    // third hop. Inlining collapses both into the HTML response.
    inlineStylesheets: 'always',
  },
});
