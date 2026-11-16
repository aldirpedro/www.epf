import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

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

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response("Acesso negado", { status: 403 });
  }

  const { data: autorizado, error: erroPermissao } =
    await supabase.rpc("tem_permissao", {
      p_recurso: "paginas",
      p_acao: "publicar",
    });

  if (erroPermissao || autorizado !== true) {
    return new Response("Sem permissão para publicar", {
      status: 403,
    });
  }

  const { data: rascunho, error: erroRascunho } =
    await supabase
      .from("paginas_rascunhos")
      .select("conteudo")
      .eq("slug", "sobre-nos")
      .maybeSingle();

  if (erroRascunho || !rascunho) {
    return context.redirect(
      "/admin/paginas/sobre-nos?erro=1",
      303
    );
  }

  const conteudo = rascunho.conteudo;

  if (
    !conteudo ||
    typeof conteudo !== "object" ||
    Array.isArray(conteudo) ||
    typeof conteudo.missao_titulo !== "string" ||
    typeof conteudo.missao_texto !== "string" ||
    typeof conteudo.missao_complemento !== "string" ||
    typeof conteudo.missao_final !== "string" ||
    typeof conteudo.historia_titulo !== "string" ||
    !Array.isArray(conteudo.marcos) ||
    !conteudo.marcos.every(
      (m: unknown) =>
        typeof m === "object" &&
        m !== null &&
        "ano" in m &&
        "texto" in m &&
        typeof m.ano === "string" &&
        /^\d{4}$/.test(m.ano) &&
        typeof m.texto === "string" &&
        m.texto.trim().length > 0
    )
  ) {
    return context.redirect(
      "/admin/paginas/sobre-nos?erro=1",
      303
    );
  }

  const { error: erroPublicacao } = await supabase
    .from("paginas_conteudo")
    .upsert(
      {
        slug: "sobre-nos",
        conteudo,
        publicado: true,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user.id,
      },
      { onConflict: "slug" }
    );

  if (erroPublicacao) {
    console.error(
      "Erro ao publicar Sobre Nós:",
      erroPublicacao.message
    );

    return context.redirect(
      "/admin/paginas/sobre-nos?erro=1",
      303
    );
  }

  return context.redirect(
    "/admin/paginas/sobre-nos?publicado=1",
    303
  );
};