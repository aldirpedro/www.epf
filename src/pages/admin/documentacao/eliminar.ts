import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const BUCKET = "documentacao-privada";

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

function texto(
  dados: FormData,
  campo: string
): string {
  const valor = dados.get(campo);

  return typeof valor === "string"
    ? valor.trim()
    : "";
}

function enderecoDocumento(
  id: string,
  parametro: string
): string {
  return `/admin/documentacao/${id}?${parametro}`;
}

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

  // Aceitar apenas pedidos provenientes da mesma origem.
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

  // Confirmar que existe uma sessão autenticada.
  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return redirect("/admin/login", 303);
  }

  // Confirmar que o utilizador está ativo.
  const {
    data: perfil,
    error: erroPerfil,
  } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return respostaErro(
      "Não tens autorização para eliminar documentos.",
      403
    );
  }

  // A eliminação exige uma permissão própria.
  // Não depende das permissões de editar ou publicar.
  const {
    data: podeEliminar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "documentacao",
    p_acao: "eliminar",
  });

  if (
    erroPermissao ||
    podeEliminar !== true
  ) {
    return respostaErro(
      "Não tens permissão para eliminar documentos.",
      403
    );
  }

  // Aceitar apenas formulários.
  const tipoConteudo =
    request.headers.get("content-type") ?? "";

  const formatoValido =
    tipoConteudo
      .toLowerCase()
      .startsWith("application/x-www-form-urlencoded") ||
    tipoConteudo
      .toLowerCase()
      .startsWith("multipart/form-data");

  if (!formatoValido) {
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
      "Não foi possível ler os dados do formulário.",
      400
    );
  }

  const id = texto(dados, "id");

  if (!UUID_REGEX.test(id)) {
    return respostaErro(
      "Identificador do documento inválido.",
      400
    );
  }

  // Consultar o documento antes da eliminação.
  // Esta consulta está sujeita às políticas RLS.
  const {
    data: documento,
    error: erroDocumento,
  } = await supabase
    .from("documentacao")
    .select("id, titulo, caminho_pdf, publicado")
    .eq("id", id)
    .maybeSingle();

  if (erroDocumento) {
    console.error(
      "Erro ao consultar documento para eliminação:",
      erroDocumento.message
    );

    return respostaErro(
      "Não foi possível consultar o documento.",
      500
    );
  }

  if (!documento) {
    return respostaErro(
      "Documento não encontrado ou sem acesso.",
      404
    );
  }

  // Se existir um PDF, confirmar antecipadamente
  // que o armazenamento privado está configurado.
  //
  // Não eliminamos o registo se a configuração
  // necessária para limpar o PDF estiver em falta.
  const urlSupabase =
    import.meta.env.PUBLIC_SUPABASE_URL;

  const chaveSecreta =
    import.meta.env.SUPABASE_SECRET_KEY;

  if (
    documento.caminho_pdf &&
    (!urlSupabase || !chaveSecreta)
  ) {
    console.error(
      "Configuração de armazenamento privado indisponível."
    );

    return respostaErro(
      "O serviço de armazenamento não está configurado.",
      503
    );
  }

  // Eliminar o registo através da sessão do utilizador.
  // A política RLS exige documentacao:eliminar.
  //
  // Não restringimos pelo estado "publicado":
  // a eliminação é permitida para ambos os estados.
  //
  // A condição sobre o caminho do PDF evita eliminar
  // um registo cujo ficheiro tenha sido substituído
  // entretanto.
  let consulta = supabase
    .from("documentacao")
    .delete()
    .eq("id", id);

  if (documento.caminho_pdf) {
    consulta = consulta.eq(
      "caminho_pdf",
      documento.caminho_pdf
    );
  } else {
    consulta = consulta.is("caminho_pdf", null);
  }

  const {
    data: documentoEliminado,
    error: erroEliminacao,
  } = await consulta
    .select("id, caminho_pdf")
    .maybeSingle();

  if (erroEliminacao) {
    console.error(
      "Erro ao eliminar documento institucional:",
      erroEliminacao.message
    );

    return redirect(
      enderecoDocumento(id, "erro=eliminar"),
      303
    );
  }

  if (!documentoEliminado) {
    return respostaErro(
      "O documento não foi eliminado. Pode ter sido alterado ou eliminado entretanto.",
      409
    );
  }

  // O registo já foi eliminado.
  // Se estava publicado, deixa de aparecer no website
  // e o endpoint público deixa de autorizar a consulta.
  //
  // Só agora removemos o PDF privado.
  if (documentoEliminado.caminho_pdf) {
    const armazenamento = createClient(
      urlSupabase,
      chaveSecreta,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const {
      data: ficheirosRemovidos,
      error: erroRemocaoPdf,
    } = await armazenamento.storage
      .from(BUCKET)
      .remove([documentoEliminado.caminho_pdf]);

    if (erroRemocaoPdf) {
      // A eliminação da base de dados já aconteceu.
      // Registar a falha para limpeza administrativa.
      // Não indicar que o documento ainda existe.
      console.error(
        "Documento eliminado, mas ocorreu um erro ao remover o PDF privado:",
        {
          documentoId: id,
          caminhoPdf: documentoEliminado.caminho_pdf,
          erro: erroRemocaoPdf.message,
        }
      );
    } else if (
      !ficheirosRemovidos ||
      ficheirosRemovidos.length === 0
    ) {
      console.warn(
        "Documento eliminado, mas o armazenamento não confirmou a remoção do PDF:",
        {
          documentoId: id,
          caminhoPdf: documentoEliminado.caminho_pdf,
        }
      );
    }
  }

  // Regressar à listagem após eliminar.
  return redirect(
    "/admin/documentacao/?eliminado=1",
    303
  );
};