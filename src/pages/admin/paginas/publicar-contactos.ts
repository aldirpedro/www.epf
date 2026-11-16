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
    return new Response("Acesso negado", {
      status: 403,
    });
  }

  const { data: podePublicar, error: erroPermissao } =
    await supabase.rpc("tem_permissao", {
      p_recurso: "paginas",
      p_acao: "publicar",
    });

  if (erroPermissao || podePublicar !== true) {
    return new Response("Sem permissão para publicar páginas", {
      status: 403,
    });
  }

  const { data: rascunho, error: erroRascunho } =
    await supabase
      .from("paginas_rascunhos")
      .select("conteudo")
      .eq("slug", "contactos")
      .maybeSingle();

  if (erroRascunho || !rascunho?.conteudo) {
    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  const conteudo = rascunho.conteudo;

  if (
    typeof conteudo !== "object" ||
    Array.isArray(conteudo)
  ) {
    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  const camposObrigatorios = [
    "titulo_pagina",
    "introducao",
    "titulo_formulario",
    "entidade",
    "morada",
    "telefone",
    "email",
    "mapa",
  ];

  const dados = conteudo as Record<string, unknown>;

  const valido = camposObrigatorios.every(
    (campo) =>
      typeof dados[campo] === "string" &&
      (dados[campo] as string).trim().length > 0
  );

  if (!valido) {
    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  const { error: erroPublicacao } = await supabase
    .from("paginas_conteudo")
    .upsert(
      {
        slug: "contactos",
        conteudo,
        publicado: true,
      },
      {
        onConflict: "slug",
      }
    );

  if (erroPublicacao) {
    console.error(
      "Erro ao publicar Contactos:",
      erroPublicacao.message
    );

    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  return context.redirect(
    "/admin/paginas/contactos?publicado=1",
    303
  );
};