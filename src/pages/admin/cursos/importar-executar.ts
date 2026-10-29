
import type { APIRoute } from "astro";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const EXCLUIDOS = new Set(["tecnico-audiovisuais.md"]);

type Resultado = {
  importados: string[];
  ignorados: string[];
  erros: string[];
};

function escaparHtml(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paginaResultado(resultado: Resultado): Response {
  const secao = (titulo: string, itens: string[]) => `
    <h2>${titulo} (${itens.length})</h2>
    ${
      itens.length
        ? `<ul>${itens
            .map((item) => `<li>${escaparHtml(item)}</li>`)
            .join("")}</ul>`
        : "<p>Nenhum.</p>"
    }
  `;

  return new Response(
    `<!doctype html>
    <html lang="pt">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Resultado da importação | EPF</title>
        <style>
          body {
            margin: 0;
            padding: 30px 20px;
            background: #f3f6fa;
            color: #1e293b;
            font-family: system-ui, sans-serif;
          }
          main {
            max-width: 850px;
            margin: auto;
            padding: 30px;
            background: white;
            border-radius: 12px;
          }
          h1, h2 { color: #16365c; }
          li { margin-bottom: 10px; }
          a { color: #16365c; font-weight: 600; }
        </style>
      </head>
      <body>
        <main>
          <h1>Resultado da importação</h1>
          ${secao("Cursos importados", resultado.importados)}
          ${secao("Cursos já existentes", resultado.ignorados)}
          ${secao("Erros", resultado.erros)}
          <p><a href="/admin/cursos/">← Voltar à gestão de cursos</a></p>
        </main>
      </body>
    </html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    }
  );
}

export const POST: APIRoute = async (Astro) => {
  const supabase = criarSupabaseServer(Astro);

  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return Astro.redirect("/admin/login", 303);
  }

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (
    erroPerfil ||
    !perfil?.ativo ||
    perfil.perfil !== "coordenador"
  ) {
    return new Response("Acesso não autorizado.", {
      status: 403,
    });
  }

  // Esta importação só pode correr no ambiente local.
  // Não disponibilizar este endpoint na Vercel.
  if (import.meta.env.PROD) {
    return new Response(
      "A importação está desativada em produção.",
      { status: 403 }
    );
  }

  const resultado: Resultado = {
    importados: [],
    ignorados: [],
    erros: [],
  };

  const pastaCursos = path.resolve("src/content/cursos");

  let ficheiros: string[];

  try {
    ficheiros = (await fs.readdir(pastaCursos))
      .filter((ficheiro) => ficheiro.endsWith(".md"))
      .filter((ficheiro) => !EXCLUIDOS.has(ficheiro))
      .sort();
  } catch {
    return new Response(
      "Não foi possível encontrar a pasta dos cursos.",
      { status: 500 }
    );
  }

  for (const ficheiro of ficheiros) {
    const slug = path.basename(ficheiro, ".md");

    try {
      // 1. Não substituir cursos existentes.
      const { data: existente, error: erroExistente } =
        await supabase
          .from("cursos")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();

      if (erroExistente) {
        throw new Error(
          `Erro ao verificar curso existente: ${erroExistente.message}`
        );
      }

      if (existente) {
        resultado.ignorados.push(slug);
        continue;
      }

      // 2. Ler o ficheiro Markdown.
      const caminhoMarkdown = path.join(pastaCursos, ficheiro);

      const { data, content } = matter(
        await fs.readFile(caminhoMarkdown, "utf8")
      );

      if (
        typeof data.titulo !== "string" ||
        !["profissional", "cef"].includes(data.tipo)
      ) {
        throw new Error("Dados do curso inválidos.");
      }

      const caminhosCartazes: string[] = Array.isArray(data.cartazes)
        ? data.cartazes
        : [];

      const imagens: {
        caminho: string;
        conteudo: Buffer;
      }[] = [];

      // 3. Ler todos os cartazes antes de fazer alterações.
      for (const cartaz of caminhosCartazes) {
        if (typeof cartaz !== "string") {
          throw new Error("Caminho de cartaz inválido.");
        }

        const caminhoImagem = path.resolve(
          path.dirname(caminhoMarkdown),
          cartaz
        );

        const conteudo = await fs.readFile(caminhoImagem);

        if (conteudo.length > 5 * 1024 * 1024) {
          throw new Error(
            `O cartaz ${path.basename(cartaz)} ultrapassa 5 MB.`
          );
        }

        imagens.push({
          caminho: path.basename(cartaz),
          conteudo,
        });
      }

      // 4. Carregar os cartazes para o Supabase Storage.
      const urlsCartazes: string[] = [];

      for (const imagem of imagens) {
        const caminhoStorage =
          `importacao/${slug}/${imagem.caminho}`;

        const { error: erroUpload } = await supabase.storage
          .from("cursos")
          .upload(caminhoStorage, imagem.conteudo, {
            contentType: "image/webp",
            upsert: false,
          });

        if (erroUpload) {
          // Se o ficheiro já existe, reutilizar a sua URL.
          // Para outros erros, interromper este curso.
          if (
            !/already exists|duplicate/i.test(erroUpload.message)
          ) {
            throw new Error(
              `Erro no cartaz ${imagem.caminho}: ${erroUpload.message}`
            );
          }
        }

        const { data: urlPublica } = supabase.storage
          .from("cursos")
          .getPublicUrl(caminhoStorage);

        urlsCartazes.push(urlPublica.publicUrl);
      }

      // 5. Preservar as componentes de formação.
      const componentes = Array.isArray(data.componentes)
        ? data.componentes.map((componente) => ({
            nome: componente.nome,
            disciplinas: Array.isArray(componente.disciplinas)
              ? componente.disciplinas
              : [],
          }))
        : [];

      // 6. Criar o curso no Supabase.
      const { error: erroInsercao } = await supabase
        .from("cursos")
        .insert({
          slug,
          titulo: data.titulo,
          sigla: data.sigla ?? null,
          tipo: data.tipo,
          nivel: data.nivel ?? "",
          duracao: data.duracao ?? "",
          certificacao: data.certificacao ?? "",
          acesso: data.acesso ?? "",
          area: data.area ?? "",
          icone: data.icone ?? "livro",
          ordem: data.ordem ?? 0,
          perfil: data.perfil ?? "",
          conteudo: content.trim(),
          componentes,
          cartazes: urlsCartazes,
          publicado: true,
        });

      if (erroInsercao) {
        throw new Error(
          `Erro ao criar curso: ${erroInsercao.message}`
        );
      }

      resultado.importados.push(data.titulo);
    } catch (erro) {
      const mensagem =
        erro instanceof Error ? erro.message : "Erro desconhecido";

      console.error(`Erro ao importar ${slug}:`, erro);
      resultado.erros.push(`${slug}: ${mensagem}`);
    }
  }

  return paginaResultado(resultado);
};
