# Escola Profissional do Fundão — sítio institucional

Base do novo sítio da EPF. Sítio estático feito com [Astro](https://astro.build): rápido, barato de alojar e sem base de dados para manter.

## Começar

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # gera a pasta dist/ pronta a publicar
```

## Onde se altera cada coisa

| O quê | Onde |
| --- | --- |
| Contactos, redes sociais, menu, ano letivo das inscrições | `src/data/site.ts` |
| Cursos (um ficheiro por curso) | `src/content/cursos/*.md` |
| Notícias (um ficheiro por notícia) | `src/content/noticias/*.md` |
| Listas de documentos (institucionais, EQAVET) | `src/data/documentos.ts` |
| Cores, tipos de letra, componentes visuais | `src/styles/global.css` |
| Logótipo | `src/assets/logo-epf.png` e `public/favicon.png` |
| Fotografia principal da página inicial | `src/assets/escola/edificio.webp` (importada em `src/pages/index.astro`) |
| Cartazes dos cursos | `src/assets/cursos/`, indicados no campo `cartazes` de cada curso (o primeiro aparece nos cartões) |
| Fotografias da escola | `src/assets/escola/` |
| Apoios aos alunos | `apoios` em `src/data/site.ts` |

### Publicar uma notícia

Criar `src/content/noticias/titulo-da-noticia.md`:

```md
---
titulo: "Título da notícia"
data: "2026-10-01"
categoria: "Escola e Comunidade"   # ou "Emprego e Formação" / "No País e na Europa"
resumo: "Uma frase que aparece nos cartões."
autor: "Nome"                      # opcional
imagem: "/imagens/noticia.jpg"     # opcional; ficheiro em public/imagens/
---

Texto da notícia em Markdown.
```

### Fechar ou abrir inscrições

Em `src/data/site.ts`, mudar `inscricoes.abertas` e `inscricoes.anoLetivo`.

## Por fazer antes de publicar

- **Fotografias** das notícias, dos cursos CEF e do curso de Cozinha/Software (só têm um cartaz).
- **Formulários** — sem `PUBLIC_FORMS_ENDPOINT` (ver `.env.example`), contactos e pré-inscrição abrem o email do visitante. Para receber as submissões diretamente é preciso ligar um serviço de formulários ou um pequeno backend.
- **Documentos** — as ligações em `src/data/documentos.ts` apontam para o sítio antigo. Copiar os PDF para `public/documentos/` e atualizar os endereços.
- **Validar conteúdos** com a direção: duração e condições de acesso de cada curso, datas das notícias (o sítio antigo só indica mês e ano) e texto da política de privacidade.
- **Redirecionamentos** dos endereços antigos (`/page/...`, `/courses/...`, `/blog/...`) quando o domínio passar para o novo sítio.

As imagens em `src/assets/` são redimensionadas e comprimidas automaticamente no `npm run build`.

Se, em desenvolvimento, uma alteração aos campos dos cursos ou notícias não aparecer, parar o servidor (`npx astro dev stop`), apagar a pasta `.astro/` e voltar a arrancar.
