import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const BUCKET = "documentacao-privada";
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_AUTORIZACOES_PENDENTES = 10;

function resposta(
  mensagem: string,
  estado: number,
  dados: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      sucesso: estado >= 200 && estado < 300,
      mensagem,
      ...dados,
    }),
    {
      status: estado,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

export const POST: APIRoute = async (context) => {
  const { request } = context;

  // Aceitar apenas pedidos da mesma origem.
  const origem = request.headers.get("origin");
  const origemEsperada = new URL(request.url).origin;

  if (origem !== origemEsperada) {
    return resposta("Origem não autorizada.", 403);
  }

  const tipoConteudo =
    request.headers.get("content-type") ?? "";

  if (
    !tipoConteudo
      .toLowerCase()
      .startsWith("application/json")
  ) {
    return resposta("Formato do pedido inválido.", 415);
  }

  // Autenticação pela sessão existente.
  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return resposta("É necessário iniciar sessão.", 401);
  }

  // Verificar perfil ativo.
  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || perfil?.ativo !== true) {
    return resposta("Perfil sem autorização.", 403);
  }

  // Verificar a permissão específica.
  const {
    data: podeCriar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "documentacao",
    p_acao: "criar",
  });

  if (erroPermissao || podeCriar !== true) {
    return resposta(
      "Não tens permissão para carregar documentos.",
      403
    );
  }

  // Evitar pedidos de metadados excessivamente grandes.
  const tamanhoPedido = request.headers.get("content-length");

  if (
    tamanhoPedido !== null &&
    (
      !Number.isFinite(Number(tamanhoPedido)) ||
      Number(tamanhoPedido) > 4096
    )
  ) {
    return resposta("Pedido demasiado grande.", 413);
  }

  let corpo: string;

  try {
    corpo = await request.text();
  } catch {
    return resposta("Não foi possível ler o pedido.", 400);
  }

  if (new TextEncoder().encode(corpo).length > 4096) {
    return resposta("Pedido demasiado grande.", 413);
  }

  let dados: unknown;

  try {
    dados = JSON.parse(corpo);
  } catch {
    return resposta("Pedido JSON inválido.", 400);
  }

  if (
    !dados ||
    typeof dados !== "object" ||
    Array.isArray(dados)
  ) {
    return resposta("Dados inválidos.", 400);
  }

  const entrada = dados as Record<string, unknown>;

  const nome =
    typeof entrada.nome === "string"
      ? entrada.nome.trim()
      : "";

  const tamanho = entrada.tamanho;

  const tipo =
    typeof entrada.tipo === "string"
      ? entrada.tipo
      : "";

  if (
    !nome ||
    nome.length > 255 ||
    !/\.pdf$/i.test(nome)
  ) {
    return resposta(
      "Seleciona um ficheiro PDF válido.",
      400
    );
  }

  if (
    typeof tamanho !== "number" ||
    !Number.isSafeInteger(tamanho) ||
    tamanho <= 0 ||
    tamanho > MAX_PDF_BYTES
  ) {
    return resposta(
      "O PDF deve ter no máximo 25 MB.",
      413
    );
  }

  if (tipo !== "application/pdf" && tipo !== "") {
    return resposta(
      "O formato do ficheiro deve ser PDF.",
      415
    );
  }

  // Credenciais administrativas exclusivamente no servidor.
  const urlSupabase =
    import.meta.env.PUBLIC_SUPABASE_URL;

  const chaveSecreta =
    import.meta.env.SUPABASE_SECRET_KEY;

  if (!urlSupabase || !chaveSecreta) {
    console.error(
      "Configuração do Supabase Storage incompleta."
    );

    return resposta(
      "O serviço de carregamento está indisponível.",
      500
    );
  }

  const supabaseAdmin = createClient(
    urlSupabase,
    chaveSecreta,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  // Limitar o número de autorizações pendentes por utilizador.
  const agora = new Date();

  const {
    count: autorizacoesPendentes,
    error: erroContagem,
  } = await supabaseAdmin
    .from("documentacao_uploads")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("utilizador_id", user.id)
    .eq("estado", "pendente")
    .gt("expira_em", agora.toISOString());

  if (erroContagem) {
    console.error(
      "Erro ao consultar autorizações pendentes:",
      erroContagem.message
    );

    return resposta(
      "Não foi possível verificar os carregamentos pendentes.",
      500
    );
  }

  if (
    (autorizacoesPendentes ?? 0) >=
    MAX_AUTORIZACOES_PENDENTES
  ) {
    return resposta(
      "Atingiste o limite de carregamentos pendentes. Tenta novamente mais tarde.",
      429
    );
  }

  // Caminho único e associado ao utilizador autenticado.
  const caminho = `${user.id}/${randomUUID()}.pdf`;

  // A validade acompanha a autorização temporária
  // de carregamento do Supabase Storage.
  const expiraEm = new Date(
    agora.getTime() + 2 * 60 * 60 * 1000
  );

  // Registar primeiro a intenção de carregamento.
  const {
    data: registo,
    error: erroRegisto,
  } = await supabaseAdmin
    .from("documentacao_uploads")
    .insert({
      utilizador_id: user.id,
      caminho_pdf: caminho,
      tamanho_declarado: tamanho,
      estado: "pendente",
      expira_em: expiraEm.toISOString(),
    })
    .select("id")
    .single();

  if (erroRegisto || !registo) {
    console.error(
      "Erro ao registar autorização de carregamento:",
      erroRegisto?.message
    );

    return resposta(
      "Não foi possível registar o carregamento.",
      500
    );
  }

  // Criar a autorização temporária para o caminho registado.
  const {
    data: autorizacao,
    error: erroUpload,
  } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(caminho, {
      upsert: false,
    });

  if (erroUpload || !autorizacao) {
    console.error(
      "Erro ao preparar carregamento do PDF:",
      erroUpload?.message
    );

    // Invalidar o registo se a autorização não foi criada.
    const { error: erroInvalidacao } =
      await supabaseAdmin
        .from("documentacao_uploads")
        .update({
          estado: "rejeitado",
        })
        .eq("id", registo.id)
        .eq("estado", "pendente");

    if (erroInvalidacao) {
      console.error(
        "Erro ao invalidar carregamento:",
        erroInvalidacao.message
      );
    }

    return resposta(
      "Não foi possível preparar o carregamento.",
      500
    );
  }

  // O token é entregue apenas ao utilizador autorizado.
  // A chave secreta nunca é incluída na resposta.
  return resposta(
    "Carregamento autorizado.",
    200,
    {
      caminho,
      token: autorizacao.token,
    }
  );
};