import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://www.epfundao.edu.pt',
  adapter: node({ mode: 'standalone' }), // O adaptador do Node continua necessário para o SSR
  integrations: [sitemap()],
});