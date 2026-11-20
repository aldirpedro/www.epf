import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const BUCKET = "documentacao-privada";
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_ANTIGO = 3 * 1024 * 1024;

function respostaErro(
  mensagem: string,
  estado: number
): Response {
  return new Response(mensagem, {
    status: estado,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function texto(dados: FormData, campo: string): string {
  const valor = dados.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function checkbox(dados: FormData, campo: string): boolean {
  return dados.get(campo) === "true";
}

function assinaturaPdfValida(
  bytes: Uint8Array
): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

  const origem = request.headers.get("origin");
  const origemEsperada = new URL(request.url).origin;

  if (origem !== origemEsperada) {
    return respostaErro("Origem não autorizada.", 403);
  }

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return respostaErro(
      "É necessário iniciar sessão.",
      401
    );
  }

  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || perfil?.ativo !== true) {
    return respostaErro(
      "Não tens autorização para criar documentos.",
      403
    );
  }

  const {
    data: podeCriar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "documentacao",
    p_acao: "criar",
  });

  if (erroPermissao || podeCriar !== true) {
    return respostaErro(
      "Não tens permissão para criar documentos.",
      403
    );
  }

  const tipoConteudo =
    request.headers.get("content-type") ?? "";

  if (
    !tipoConteudo
      .toLowerCase()
      .startsWith("multipart/form-data")
  ) {
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

  const titulo = texto(dados, "titulo");
  const descricao = texto(dados, "descricao");
  const secao = texto(dados, "secao");
  const anoLetivo = texto(dados, "ano_letivo");
  const ordemTexto = texto(dados, "ordem");
  const urlExterna = texto(dados, "url_externa");
  const caminhoUpload = texto(dados, "caminho_upload");

  const mostrarNoWebsite = checkbox(
    dados,
    "mostrar_no_website"
  );

  const permitirAbrirPdf = checkbox(
    dados,
    "permitir_abrir_pdf"
  );

  if (!titulo || titulo.length > 240) {
    return respostaErro(
      "O título é obrigatório e não pode ultrapassar 240 caracteres.",
      400
    );
  }

  if (descricao.length > 10000) {
    return respostaErro(
      "A descrição é demasiado longa.",
      400
    );
  }

  if (
    secao !== "instituicao" &&
    secao !== "organizacao"
  ) {
    return respostaErro(
      "A secção selecionada é inválida.",
      400
    );
  }

  if (anoLetivo.length > 20) {
    return respostaErro(
      "O ano letivo não pode ultrapassar 20 caracteres.",
      400
    );
  }

  const ordem = Number(ordemTexto || "0");

  if (
    !Number.isSafeInteger(ordem) ||
    ordem < 0 ||
    ordem > 2147483647
  ) {
    return respostaErro(
      "A ordem de apresentação é inválida.",
      400
    );
  }

  if (urlExterna) {
    if (urlExterna.length > 2000) {
      return respostaErro(
        "A ligação externa é demasiado longa.",
        400
      );
    }

    try {
      const url = new URL(urlExterna);

      if (
        url.protocol !== "https:" &&
        url.protocol !== "http:"
      ) {
        return respostaErro(
          "A ligação externa deve utilizar HTTP ou HTTPS.",
          400
        );
      }
    } catch {
      return respostaErro(
        "A ligação externa não é válida.",
        400
      );
    }
  }

  const valorPdf = dados.get("pdf");

  const ficheiroPdf =
    valorPdf instanceof File && valorPdf.size > 0
      ? valorPdf
      : null;

  const numeroFontes =
    Number(Boolean(ficheiroPdf)) +
    Number(Boolean(caminhoUpload)) +
    Number(Boolean(urlExterna));

  if (numeroFontes > 1) {
    return respostaErro(
      "Escolhe apenas uma fonte para o documento.",
      400
    );
  }

  const urlSupabase =
    import.meta.env.PUBLIC_SUPABASE_URL;

  const chaveSecreta =
    import.meta.env.SUPABASE_SECRET_KEY;

  if (!urlSupabase || !chaveSecreta) {
    console.error(
      "Configuração do Supabase incompleta."
    );

    return respostaErro(
      "Serviço de armazenamento indisponível.",
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

  // Novo fluxo: PDF previamente enviado ao Supabase.
  if (caminhoUpload) {
    const expressao = new RegExp(
      `^${user.id}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.pdf$`,
      "i"
    );

    if (!expressao.test(caminhoUpload)) {
      return respostaErro(
        "O caminho do PDF não está autorizado.",
        403
      );
    }

    // Confirmar que existe uma autorização pendente,
    // emitida para este utilizador e este caminho.
    const {
      data: autorizacao,
      error: erroAutorizacao,
    } = await supabaseAdmin
      .from("documentacao_uploads")
      .select(
        "id, tamanho_declarado, expira_em, estado"
      )
      .eq("utilizador_id", user.id)
      .eq("caminho_pdf", caminhoUpload)
      .eq("estado", "pendente")
      .gt("expira_em", new Date().toISOString())
      .maybeSingle();

    if (erroAutorizacao) {
      console.error(
        "Erro ao consultar autorização:",
        erroAutorizacao.message
      );

      return respostaErro(
        "Não foi possível verificar a autorização.",
        500
      );
    }

    if (!autorizacao) {
      return respostaErro(
        "A autorização do PDF é inválida, expirou ou já foi utilizada.",
        403
      );
    }

    // Confirmar que o ficheiro existe no bucket privado.
    const nomePdf = caminhoUpload.split("/").at(-1)!;

    const {
      data: ficheiros,
      error: erroListagem,
    } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(user.id, {
        search: nomePdf,
        limit: 100,
      });

    if (erroListagem) {
      console.error(
        "Erro ao consultar Storage:",
        erroListagem.message
      );

      return respostaErro(
        "Não foi possível verificar o PDF.",
        500
      );
    }

    const ficheiroArmazenado = ficheiros?.find(
      (item) => item.name === nomePdf
    );

    if (!ficheiroArmazenado) {
      return respostaErro(
        "O PDF ainda não foi carregado.",
        400
      );
    }

    const tamanhoMetadados = Number(
      ficheiroArmazenado.metadata?.size
    );

    if (
      !Number.isSafeInteger(tamanhoMetadados) ||
      tamanhoMetadados <= 0 ||
      tamanhoMetadados > MAX_PDF_BYTES ||
      tamanhoMetadados !==
        Number(autorizacao.tamanho_declarado)
    ) {
      return respostaErro(
        "O tamanho do PDF não corresponde ao carregamento autorizado.",
        400
      );
    }

    // Verificar os bytes reais do PDF no servidor.
    const {
      data: pdfArmazenado,
      error: erroLeitura,
    } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(caminhoUpload);

    if (erroLeitura || !pdfArmazenado) {
      return respostaErro(
        "Não foi possível validar o PDF.",
        400
      );
    }

    if (
      pdfArmazenado.size !== tamanhoMetadados ||
      pdfArmazenado.size > MAX_PDF_BYTES
    ) {
      return respostaErro(
        "O tamanho real do PDF é inválido.",
        400
      );
    }

    const bytes = new Uint8Array(
      await pdfArmazenado.arrayBuffer()
    );

    if (!assinaturaPdfValida(bytes)) {
      return respostaErro(
        "O ficheiro não contém uma assinatura PDF válida.",
        400
      );
    }

    // A função SQL consome a autorização e cria
    // o documento na mesma transação.
    // Uma segunda utilização falha automaticamente.
    const {
      error: erroCriacao,
    } = await supabaseAdmin.rpc(
      "criar_documento_upload_validado",
      {
        p_utilizador_id: user.id,
        p_caminho_pdf: caminhoUpload,
        p_tamanho_validado: bytes.length,
        p_titulo: titulo,
        p_descricao: descricao || null,
        p_secao: secao,
        p_ano_letivo: anoLetivo || null,
        p_ordem: ordem,
        p_mostrar_no_website: mostrarNoWebsite,
        p_permitir_abrir_pdf: permitirAbrirPdf,
      }
    );

    if (erroCriacao) {
      console.error(
        "Erro na criação transacional do documento:",
        erroCriacao.message
      );

      return respostaErro(
        "Não foi possível guardar o documento. A autorização pode ter expirado ou já ter sido utilizada.",
        409
      );
    }

    return redirect(
      "/admin/documentacao/?criado=1",
      303
    );
  }

  // Compatibilidade com carregamentos antigos e pequenos.
  // O formulário novo não envia bytes para esta função.
  let caminhoPdf: string | null = null;

  if (ficheiroPdf) {
    if (ficheiroPdf.size > MAX_UPLOAD_ANTIGO) {
      return respostaErro(
        "Utiliza o carregamento direto para este PDF.",
        413
      );
    }

    const nomeValido =
      /\.pdf$/i.test(ficheiroPdf.name);

    const tipoValido =
      ficheiroPdf.type === "application/pdf" ||
      ficheiroPdf.type === "";

    if (!nomeValido || !tipoValido) {
      return respostaErro(
        "O ficheiro selecionado deve ser um PDF.",
        400
      );
    }

    const bytes = new Uint8Array(
      await ficheiroPdf.arrayBuffer()
    );

    if (!assinaturaPdfValida(bytes)) {
      return respostaErro(
        "O ficheiro não contém uma assinatura PDF válida.",
        400
      );
    }

    caminhoPdf = `${randomUUID()}.pdf`;

    const { error: erroUpload } =
      await supabaseAdmin.storage
        .from(BUCKET)
        .upload(caminhoPdf, bytes, {
          contentType: "application/pdf",
          cacheControl: "3600",
          upsert: false,
        });

    if (erroUpload) {
      console.error(
        "Erro ao carregar PDF:",
        erroUpload.message
      );

      return respostaErro(
        "Não foi possível carregar o PDF.",
        500
      );
    }
  }

  // Documentos com ligação externa ou sem PDF,
  // e compatibilidade com pequenos carregamentos antigos.
  // Todos são criados como rascunhos.
  const { error: erroInsercao } =
    await supabase
      .from("documentacao")
      .insert({
        titulo,
        descricao: descricao || null,
        secao,
        ano_letivo: anoLetivo || null,
        ordem,
        url_externa: urlExterna || null,
        caminho_pdf: caminhoPdf,
        mostrar_no_website: mostrarNoWebsite,
        permitir_abrir_pdf: permitirAbrirPdf,
        publicado: false,
        criado_por: user.id,
        atualizado_por: user.id,
      });

  if (erroInsercao) {
    console.error(
      "Erro ao guardar documento:",
      erroInsercao.message
    );

    if (ficheiroPdf && caminhoPdf) {
      const { error: erroLimpeza } =
        await supabaseAdmin.storage
          .from(BUCKET)
          .remove([caminhoPdf]);

      if (erroLimpeza) {
        console.error(
          "Erro ao limpar PDF:",
          erroLimpeza.message
        );
      }
    }

    return respostaErro(
      "Não foi possível guardar o documento.",
      500
    );
  }

  return redirect(
    "/admin/documentacao/?criado=1",
    303
  );
};