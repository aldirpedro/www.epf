import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const BUCKET = "eqavet-documentos";
const TAMANHO_MAXIMO = 20 * 1024 * 1024;

function responder(
  mensagem: string,
  estado: number
): Response {
  return new Response(
    JSON.stringify({
      sucesso: false,
      erro: mensagem,
    }),
    {
      status: estado,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

export const POST: APIRoute = async (context) => {
  // Apenas pedidos enviados a partir do próprio website.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return responder("Origem não autorizada.", 403);
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar a identidade do utilizador.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return responder("Sessão expirada. Inicia sessão novamente.", 401);
  }

  // Confirmar que a conta está ativa.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return responder("Conta sem acesso ao painel.", 403);
  }

  // Confirmar permissão para editar páginas.
  const {
    data: podeEditar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "paginas",
    p_acao: "editar",
  });

  if (erroPermissao || podeEditar !== true) {
    return responder(
      "Não tens permissão para carregar documentos.",
      403
    );
  }

  // Limitar a dimensão do pedido antes de processar o ficheiro,
  // quando o browser envia o cabeçalho Content-Length.
  const comprimento = context.request.headers.get("content-length");

  if (comprimento) {
    const tamanhoPedido = Number(comprimento);

    if (
      Number.isFinite(tamanhoPedido) &&
      tamanhoPedido > TAMANHO_MAXIMO + 1024 * 1024
    ) {
      return responder("O pedido excede o limite permitido.", 413);
    }
  }

  let formulario: FormData;

  try {
    formulario = await context.request.formData();
  } catch {
    return responder("Não foi possível ler o ficheiro.", 400);
  }

  const documento = formulario.get("documento");

  if (!(documento instanceof File)) {
    return responder("Seleciona um ficheiro PDF.", 400);
  }

  if (documento.size === 0) {
    return responder("O ficheiro está vazio.", 400);
  }

  if (documento.size > TAMANHO_MAXIMO) {
    return responder(
      "O PDF não pode ultrapassar 20 MB.",
      413
    );
  }

  const nomeOriginal = documento.name.trim();

  if (
    !nomeOriginal ||
    !nomeOriginal.toLowerCase().endsWith(".pdf")
  ) {
    return responder(
      "O ficheiro tem de ter a extensão .pdf.",
      400
    );
  }

  if (documento.type !== "application/pdf") {
    return responder(
      "O ficheiro tem de ser um PDF válido.",
      400
    );
  }

  // Verificar a assinatura inicial do formato PDF.
  const assinatura = new Uint8Array(
    await documento.slice(0, 5).arrayBuffer()
  );

  const assinaturaPdf = [37, 80, 68, 70, 45];

  const formatoValido = assinaturaPdf.every(
    (valor, indice) => assinatura[indice] === valor
  );

  if (!formatoValido) {
    return responder(
      "O ficheiro não apresenta uma assinatura PDF válida.",
      400
    );
  }

  // Cada carregamento cria um ficheiro novo.
  // Assim, substituir um PDF no editor não apaga
  // a versão que possa continuar publicada.
  const identificador = crypto.randomUUID();

  const caminho = `qualidade/${user.id}/${identificador}.pdf`;

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, documento, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });

  if (erroUpload) {
    console.error(
      "Erro ao carregar PDF do EQAVET:",
      erroUpload.message
    );

    return responder(
      "Não foi possível guardar o PDF no armazenamento.",
      500
    );
  }

  const { data: enderecoPublico } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(caminho);

  if (!enderecoPublico?.publicUrl) {
    return responder(
      "O PDF foi guardado, mas não foi possível obter o endereço.",
      500
    );
  }

  return new Response(
    JSON.stringify({
      sucesso: true,
      mensagem: "PDF carregado com sucesso.",
      url: enderecoPublico.publicUrl,
      caminho,
      nome: nomeOriginal,
    }),
    {
      status: 201,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
};