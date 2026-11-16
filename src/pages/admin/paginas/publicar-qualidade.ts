import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";
import { eqavet, type Documento } from "../../../data/documentos";

export const prerender = false;

const MAX_DOCUMENTOS = 100;

const CAMPOS_OBRIGATORIOS = [
  ["titulo_pagina", 200],
  ["introducao", 5000],
  ["titulo_documentos", 200],
  ["titulo_ciclo", 200],

  ["fase_1_nome", 200],
  ["fase_1_texto", 3000],

  ["fase_2_nome", 200],
  ["fase_2_texto", 3000],

  ["fase_3_nome", 200],
  ["fase_3_texto", 3000],

  ["fase_4_nome", 200],
  ["fase_4_texto", 3000],
] as const;

function urlValida(valor: string): boolean {
  if (valor.startsWith("/") && !valor.startsWith("//")) {
    return !/[?#\\\u0000-\u001F\u007F]/.test(valor);
  }

  try {
    const url = new URL(valor);

    if (url.username || url.password || !url.hostname) {
      return false;
    }

    // Compatibilidade com os links do antigo website da EPF.
    if (url.protocol === "http:") {
      return (
        url.hostname === "www.epfundao.edu.pt" &&
        url.port === "8069" &&
        url.pathname.startsWith("/page/")
      );
    }

    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function validarDocumentos(
  valor: unknown
): Documento[] | null {
  if (
    !Array.isArray(valor) ||
    valor.length > MAX_DOCUMENTOS
  ) {
    return null;
  }

  const documentos: Documento[] = [];

  for (const item of valor) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      return null;
    }

    const dados = item as Record<string, unknown>;

    if (
      typeof dados.titulo !== "string" ||
      typeof dados.url !== "string" ||
      (
        dados.nota !== undefined &&
        typeof dados.nota !== "string"
      )
    ) {
      return null;
    }

    const titulo = dados.titulo.trim();
    const url = dados.url.trim();

    const nota =
      typeof dados.nota === "string"
        ? dados.nota.trim()
        : "";

    if (
      !titulo ||
      titulo.length > 250 ||
      !url ||
      url.length > 2000 ||
      !urlValida(url) ||
      nota.length > 1000
    ) {
      return null;
    }

    documentos.push({
      titulo,
      url,
      ...(nota ? { nota } : {}),
    });
  }

  return documentos;
}

export const POST: APIRoute = async (context) => {
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // 1. Confirmar autenticação.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login", 303);
  }

  // 2. Confirmar que o utilizador está ativo.
  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response("Acesso negado", {
      status: 403,
    });
  }

  // 3. Confirmar permissão para publicar páginas.
  const {
    data: podePublicar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "paginas",
    p_acao: "publicar",
  });

  if (erroPermissao || podePublicar !== true) {
    return new Response(
      "Sem permissão para publicar páginas",
      {
        status: 403,
      }
    );
  }

  // 4. Obter o último rascunho guardado.
  const { data: rascunho, error: erroRascunho } =
    await supabase
      .from("paginas_rascunhos")
      .select("conteudo")
      .eq("slug", "qualidade")
      .maybeSingle();

  if (erroRascunho || !rascunho?.conteudo) {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  const conteudo = rascunho.conteudo;

  if (
    typeof conteudo !== "object" ||
    Array.isArray(conteudo)
  ) {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  const dados = conteudo as Record<string, unknown>;

  // 5. Validar todos os textos obrigatórios.
  const textosValidos = CAMPOS_OBRIGATORIOS.every(
    ([campo, tamanhoMaximo]) => {
      const valor = dados[campo];

      return (
        typeof valor === "string" &&
        valor.trim().length > 0 &&
        valor.trim().length <= tamanhoMaximo
      );
    }
  );

  if (!textosValidos) {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  // 6. Validar a lista de documentos.
  //
  // Compatibilidade com rascunhos anteriores:
  // se o campo ainda não existir, manter a lista
  // original de documentos EQAVET.
  //
  // Uma lista vazia é válida quando o administrador
  // remove intencionalmente todos os documentos.
  const documentosRecebidos =
    dados.documentos === undefined
      ? eqavet
      : dados.documentos;

  const documentos = validarDocumentos(
    documentosRecebidos
  );

  if (documentos === null) {
    console.error(
      "Publicação EQAVET: lista de documentos inválida."
    );

    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  // 7. Preparar a versão final para publicação.
  const conteudoPublicado = {
    ...dados,

    titulo_pagina: (
      dados.titulo_pagina as string
    ).trim(),

    introducao: (
      dados.introducao as string
    ).trim(),

    titulo_documentos: (
      dados.titulo_documentos as string
    ).trim(),

    titulo_ciclo: (
      dados.titulo_ciclo as string
    ).trim(),

    fase_1_nome: (
      dados.fase_1_nome as string
    ).trim(),

    fase_1_texto: (
      dados.fase_1_texto as string
    ).trim(),

    fase_2_nome: (
      dados.fase_2_nome as string
    ).trim(),

    fase_2_texto: (
      dados.fase_2_texto as string
    ).trim(),

    fase_3_nome: (
      dados.fase_3_nome as string
    ).trim(),

    fase_3_texto: (
      dados.fase_3_texto as string
    ).trim(),

    fase_4_nome: (
      dados.fase_4_nome as string
    ).trim(),

    fase_4_texto: (
      dados.fase_4_texto as string
    ).trim(),

    documentos,
  };

  // 8. Publicar os textos e os documentos em conjunto.
  const { error: erroPublicacao } = await supabase
    .from("paginas_conteudo")
    .upsert(
      {
        slug: "qualidade",
        conteudo: conteudoPublicado,
        publicado: true,
        atualizado_por: user.id,
        atualizado_em: new Date().toISOString(),
      },
      {
        onConflict: "slug",
      }
    );

  if (erroPublicacao) {
    console.error(
      "Erro ao publicar Qualidade:",
      erroPublicacao.message
    );

    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  // 9. Confirmar publicação.
  return context.redirect(
    "/admin/paginas/qualidade?publicado=1",
    303
  );
};