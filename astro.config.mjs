import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.epfundao.edu.pt',
  integrations: [sitemap()],
});
