import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

interface Documento {
  titulo: string;
  url: string;
  nota?: string;
}

const URL_MAXIMA = 2000;
const TITULO_MAXIMO = 250;
const NOTA_MAXIMA = 1000;
const MAX_DOCUMENTOS = 100;

function urlValida(valor: string): boolean {
  if (valor.startsWith("/") && !valor.startsWith("//")) {
    return !/[?#\\\u0000-\u001F\u007F]/.test(valor);
  }

  try {
    const url = new URL(valor);

    if (
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return false;
    }

    // Compatibilidade com o website antigo da EPF.
    // HTTP apenas para os documentos originais.
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
      titulo.length > TITULO_MAXIMO ||
      !url ||
      url.length > URL_MAXIMA ||
      !urlValida(url) ||
      nota.length > NOTA_MAXIMA
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

  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login", 303);
  }

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

  const {
    data: podeEditar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "paginas",
    p_acao: "editar",
  });

  if (erroPermissao || podeEditar !== true) {
    return new Response(
      "Sem permissão para editar páginas",
      { status: 403 }
    );
  }

  let formulario: FormData;

  try {
    formulario = await context.request.formData();
  } catch {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  const campo = (nome: string): string => {
    const valor = formulario.get(nome);

    return typeof valor === "string"
      ? valor.trim()
      : "";
  };

  const titulo_pagina = campo("titulo_pagina");
  const introducao = campo("introducao");
  const titulo_documentos = campo("titulo_documentos");
  const titulo_ciclo = campo("titulo_ciclo");

  const fase_1_nome = campo("fase_1_nome");
  const fase_1_texto = campo("fase_1_texto");

  const fase_2_nome = campo("fase_2_nome");
  const fase_2_texto = campo("fase_2_texto");

  const fase_3_nome = campo("fase_3_nome");
  const fase_3_texto = campo("fase_3_texto");

  const fase_4_nome = campo("fase_4_nome");
  const fase_4_texto = campo("fase_4_texto");

  const campos = [
    { valor: titulo_pagina, maximo: 200 },
    { valor: introducao, maximo: 5000 },
    { valor: titulo_documentos, maximo: 200 },
    { valor: titulo_ciclo, maximo: 200 },

    { valor: fase_1_nome, maximo: 200 },
    { valor: fase_1_texto, maximo: 3000 },

    { valor: fase_2_nome, maximo: 200 },
    { valor: fase_2_texto, maximo: 3000 },

    { valor: fase_3_nome, maximo: 200 },
    { valor: fase_3_texto, maximo: 3000 },

    { valor: fase_4_nome, maximo: 200 },
    { valor: fase_4_texto, maximo: 3000 },
  ];

  const camposInvalidos = campos.some(
    ({ valor, maximo }) =>
      !valor || valor.length > maximo
  );

  if (camposInvalidos) {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  const documentosJson = formulario.get(
    "documentos_json"
  );

  if (typeof documentosJson !== "string") {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  let documentosRecebidos: unknown;

  try {
    documentosRecebidos = JSON.parse(documentosJson);
  } catch {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  const documentos = validarDocumentos(
    documentosRecebidos
  );

  if (documentos === null) {
    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  const conteudo = {
    titulo_pagina,
    introducao,
    titulo_documentos,
    titulo_ciclo,

    fase_1_nome,
    fase_1_texto,

    fase_2_nome,
    fase_2_texto,

    fase_3_nome,
    fase_3_texto,

    fase_4_nome,
    fase_4_texto,

    documentos,
  };

  const { error: erroGuardar } = await supabase
    .from("paginas_rascunhos")
    .upsert(
      {
        slug: "qualidade",
        conteudo,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user.id,
      },
      {
        onConflict: "slug",
      }
    );

  if (erroGuardar) {
    console.error(
      "Erro ao guardar rascunho de Qualidade:",
      erroGuardar.message
    );

    return context.redirect(
      "/admin/paginas/qualidade?erro=1",
      303
    );
  }

  return context.redirect(
    "/admin/paginas/qualidade?guardado=1",
    303
  );
};