
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  // Impedir pedidos enviados a partir de outros sites.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // 1. Confirmar que o utilizador iniciou sessão.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login", 303);
  }

  // 2. Confirmar que a conta está ativa.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response(
      "A tua conta não está autorizada a aceder à administração.",
      { status: 403 }
    );
  }

  // 3. Verificar a permissão individual para eliminar notícias.
  // O Super Administrador ativo tem acesso automático
  // através da função tem_permissao do Supabase.
  const {
    data: podeEliminar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "noticias",
    p_acao: "eliminar",
  });

  if (erroPermissao) {
    console.error(
      "Erro ao verificar permissão para eliminar notícias:",
      erroPermissao.message
    );

    return new Response(
      "Não foi possível verificar as permissões.",
      { status: 500 }
    );
  }

  if (podeEliminar !== true) {
    return new Response(
      "Não tens permissão para eliminar notícias.",
      { status: 403 }
    );
  }

  // 4. Ler e validar o identificador da notícia.
  let form: FormData;

  try {
    form = await context.request.formData();
  } catch {
    return new Response("Formulário inválido", {
      status: 400,
    });
  }

  const id = String(form.get("id") ?? "").trim();

  if (!UUID_REGEX.test(id)) {
    return new Response("Identificador inválido", {
      status: 400,
    });
  }

  // 5. Procurar a notícia e a respetiva imagem.
  const {
    data: noticia,
    error: erroConsulta,
  } = await supabase
    .from("noticias")
    .select("id, imagem_url")
    .eq("id", id)
    .maybeSingle();

  if (erroConsulta) {
    console.error(
      "Erro ao consultar notícia:",
      erroConsulta.message
    );

    return new Response(
      "Não foi possível consultar a notícia.",
      { status: 500 }
    );
  }

  if (!noticia) {
    return new Response("Notícia não encontrada", {
      status: 404,
    });
  }

  // 6. Eliminar a notícia da base de dados.
  // A operação devolve o ID para confirmar a eliminação.
  const {
    data: noticiaEliminada,
    error: erroEliminar,
  } = await supabase
    .from("noticias")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (erroEliminar) {
    console.error(
      "Erro ao eliminar notícia:",
      erroEliminar.message
    );

    return new Response(
      "Não foi possível eliminar a notícia.",
      { status: 500 }
    );
  }

  if (!noticiaEliminada) {
    return new Response(
      "A notícia não foi eliminada. Verifica as permissões da base de dados.",
      { status: 403 }
    );
  }

  // 7. Tentar eliminar a imagem associada.
  // Se a remoção da imagem falhar, a notícia continua eliminada.
  if (noticia.imagem_url) {
    const marcador = "/storage/v1/object/public/noticias/";

    const posicao = noticia.imagem_url.indexOf(marcador);

    if (posicao !== -1) {
      const caminhoCodificado = noticia.imagem_url
        .slice(posicao + marcador.length)
        .split("?")[0];

      let caminho: string | null = null;

      try {
        caminho = decodeURIComponent(caminhoCodificado);
      } catch {
        console.warn(
          "Não foi possível interpretar o caminho da imagem."
        );
      }

      if (caminho) {
        const partes = caminho.split("/");

        // As imagens são guardadas numa pasta UUID
        // com um nome de ficheiro único.
        const caminhoValido =
          partes.length === 2 &&
          UUID_REGEX.test(partes[0]) &&
          /^[0-9a-f-]+\.(jpg|png|webp)$/i.test(partes[1]) &&
          !caminho.includes("..");

        if (caminhoValido) {
          const { error: erroImagem } =
            await supabase.storage
              .from("noticias")
              .remove([caminho]);

          if (erroImagem) {
            console.error(
              "A notícia foi eliminada, mas a imagem não pôde ser removida:",
              erroImagem.message
            );
          }
        }
      }
    }
  }

  // 8. Regressar à lista de notícias.
  return context.redirect("/admin/noticias", 303);
};
