import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respostaErro(
  mensagem: string,
  estado: number
): Response {
  return new Response(mensagem, {
    status: estado,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

  // Proteger contra pedidos de outras origens.
  const origem = request.headers.get("origin");

  if (origem) {
    let origemValida = false;

    try {
      origemValida =
        new URL(origem).origin ===
        new URL(request.url).origin;
    } catch {
      origemValida = false;
    }

    if (!origemValida) {
      return respostaErro(
        "Origem do pedido não autorizada.",
        403
      );
    }
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar a identidade do utilizador.
  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return redirect("/admin/login");
  }

  // Confirmar que o perfil está ativo.
  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || !perfil?.ativo) {
    return respostaErro(
      "Não tens autorização para publicar documentos.",
      403
    );
  }

  // Verificar a permissão específica.
  const {
    data: podePublicar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "documentacao",
    p_acao: "publicar",
  });

  if (erroPermissao || podePublicar !== true) {
    return respostaErro(
      "Não tens permissão para publicar documentos.",
      403
    );
  }

  // Aceitar apenas formulários tradicionais.
  const tipoConteudo =
    request.headers.get("content-type") ?? "";

  const tipoValido =
    tipoConteudo
      .toLowerCase()
      .startsWith("application/x-www-form-urlencoded") ||
    tipoConteudo
      .toLowerCase()
      .startsWith("multipart/form-data");

  if (!tipoValido) {
    return respostaErro(
      "Formato de formulário inválido.",
      415
    );
  }

  let dados: FormData;

  try {
    dados = await request.formData();
  } catch {
    return respostaErro(
      "Não foi possível ler o formulário.",
      400
    );
  }

  const valorId = dados.get("id");

  const id =
    typeof valorId === "string"
      ? valorId.trim()
      : "";

  if (!UUID_REGEX.test(id)) {
    return respostaErro(
      "Identificador do documento inválido.",
      400
    );
  }

  // Consultar o documento antes da publicação.
  const {
    data: documento,
    error: erroDocumento,
  } = await supabase
    .from("documentacao")
    .select("id, publicado, titulo")
    .eq("id", id)
    .maybeSingle();

  if (erroDocumento) {
    console.error(
      "Erro ao consultar documento para publicação:",
      erroDocumento.message
    );

    return respostaErro(
      "Não foi possível consultar o documento.",
      500
    );
  }

  if (!documento) {
    return respostaErro(
      "Documento não encontrado.",
      404
    );
  }

  if (documento.publicado) {
    return redirect(
      `/admin/documentacao/${id}?publicado=1`,
      303
    );
  }

  // A função SQL confirma novamente a permissão
  // e altera exclusivamente o estado de publicação.
  const {
    data: publicado,
    error: erroPublicacao,
  } = await supabase.rpc("publicar_documento", {
    p_id: id,
  });

  if (erroPublicacao) {
    console.error(
      "Erro ao publicar documento institucional:",
      erroPublicacao.message
    );

    return redirect(
      `/admin/documentacao/${id}?erro=publicar`,
      303
    );
  }

  if (publicado !== true) {
    return respostaErro(
      "O documento não foi publicado. Pode ter sido alterado entretanto.",
      409
    );
  }

  return redirect(
    `/admin/documentacao/${id}?publicado=1`,
    303
  );
};