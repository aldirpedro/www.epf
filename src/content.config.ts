import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const cursos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cursos' }),
  schema: ({ image }) => z.object({
    titulo: z.string(),
    sigla: z.string().optional(),
    tipo: z.enum(['profissional', 'cef']),
    area: z.string(),
    icone: z.string(),
    perfil: z.string(),
    nivel: z.string(),
    duracao: z.string(),
    certificacao: z.string(),
    acesso: z.string(),
    ordem: z.number().default(99),
    // Cartazes do curso; o primeiro é usado nos cartões.
    cartazes: z.array(image()).default([]),
    componentes: z
      .array(z.object({ nome: z.string(), disciplinas: z.array(z.string()).default([]) }))
      .default([]),
  }),
});

const noticias = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/noticias' }),
  schema: z.object({
    titulo: z.string(),
    data: z.coerce.date(),
    categoria: z.enum(['Escola e Comunidade', 'Emprego e Formação', 'No País e na Europa']),
    resumo: z.string(),
    autor: z.string().optional(),
    imagem: z.string().optional(),
  }),
});

export const collections = { cursos, noticias };
