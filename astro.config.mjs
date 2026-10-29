import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://www.epfundao.edu.pt',
  integrations: [sitemap()],
  adapter: vercel(),
});