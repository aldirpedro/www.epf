import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const SLUG = "inicio";

function redirecionar(
  request: Request,
  parametro: string
): Response {
  const url = new URL(
    "/admin/paginas/inicio",
    request.url
  );

  url.searchParams.set(parametro, "1");

  return Response.redirect(url, 303);
}

export const POST: APIRoute = async (context) => {
  const { request } = context;

  // Impedir pedidos provenientes de outras origens.
  const origem = request.headers.get("origin");
  const origemEsperada = new URL(request.url).origin;

  if (origem !== origemEsperada) {
    return new Response(
      "Origem não autorizada.",
      { status: 403 }
    );
  }

  const supabase = criarSupabaseServer(context);

  // 1. Confirmar a identidade do utilizador.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return Response.redirect(
      new URL("/admin/login", request.url),
      303
    );
  }

  // 2. Confirmar que o perfil está ativo.
  const {
    data: perfil,
    error: erroPerfil,
  } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || perfil?.ativo !== true) {
    return new Response(
      "Acesso não autorizado.",
      { status: 403 }
    );
  }

  // 3. Verificar a permissão específica de publicação.
  const {
    data: podePublicar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "paginas",
    p_acao: "publicar",
  });

  if (erroPermissao || podePublicar !== true) {
    return new Response(
      "Não tens permissão para publicar páginas.",
      { status: 403 }
    );
  }

  // 4. Obter a última versão guardada do rascunho.
  const {
    data: rascunho,
    error: erroRascunho,
  } = await supabase
    .from("paginas_rascunhos")
    .select("conteudo")
    .eq("slug", SLUG)
    .maybeSingle();

  if (erroRascunho) {
    console.error(
      "Erro ao carregar rascunho da Página Inicial:",
      erroRascunho.message
    );

    return redirecionar(request, "erro");
  }

  // Nunca publicar uma página sem rascunho válido.
  if (
    !rascunho?.conteudo ||
    typeof rascunho.conteudo !== "object" ||
    Array.isArray(rascunho.conteudo)
  ) {
    return redirecionar(request, "erro");
  }

  const conteudo = rascunho.conteudo;

  // 5. Publicar o conteúdo.
  const {
    error: erroPublicar,
  } = await supabase
    .from("paginas_conteudo")
    .upsert(
      {
        slug: SLUG,
        conteudo,
        publicado: true,
        atualizado_por: user.id,
      },
      {
        onConflict: "slug",
      }
    );

  if (erroPublicar) {
    console.error(
      "Erro ao publicar a Página Inicial:",
      erroPublicar.message
    );

    return redirecionar(request, "erro");
  }

  // O rascunho é mantido para futuras edições.
  return redirecionar(request, "publicado");
};