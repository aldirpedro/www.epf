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

function texto(
  dados: FormData,
  campo: string
): string {
  const valor = dados.get(campo);

  return typeof valor === "string"
    ? valor.trim()
    : "";
}

function checkbox(
  dados: FormData,
  campo: string
): boolean {
  return dados.get(campo) === "true";
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

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return redirect("/admin/login");
  }

  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || !perfil?.ativo) {
    return respostaErro(
      "Não tens autorização para editar documentos.",
      403
    );
  }

  const {
    data: podeEditar,
    error: erroPermissaoEditar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "documentacao",
    p_acao: "editar",
  });

  if (
    erroPermissaoEditar ||
    podeEditar !== true
  ) {
    return respostaErro(
      "Não tens permissão para editar documentos.",
      403
    );
  }

  const tipoConteudo =
    request.headers.get("content-type") ?? "";

  if (
    !tipoConteudo
      .toLowerCase()
      .startsWith("application/x-www-form-urlencoded") &&
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

  // Consultar o documento e o respetivo estado.
  const {
    data: documento,
    error: erroDocumento,
  } = await supabase
    .from("documentacao")
    .select("id, publicado, caminho_pdf")
    .eq("id", id)
    .maybeSingle();

  if (erroDocumento) {
    console.error(
      "Erro ao consultar documento para edição:",
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

  // Para editar documentos publicados, é necessária
  // também a permissão documentacao:publicar.
  // Esta regra corresponde à política RLS do Supabase.
  if (documento.publicado) {
    const {
      data: podePublicar,
      error: erroPermissaoPublicar,
    } = await supabase.rpc("tem_permissao", {
      p_recurso: "documentacao",
      p_acao: "publicar",
    });

    if (
      erroPermissaoPublicar ||
      podePublicar !== true
    ) {
      return respostaErro(
        "Para alterar documentos publicados são necessárias as permissões de editar e publicar.",
        403
      );
    }
  }

  const titulo = texto(dados, "titulo");
  const descricao = texto(dados, "descricao");
  const secao = texto(dados, "secao");
  const anoLetivo = texto(dados, "ano_letivo");
  const ordemTexto = texto(dados, "ordem");
  const urlExterna = texto(dados, "url_externa");

  const mostrarNoWebsite = checkbox(
    dados,
    "mostrar_no_website"
  );

  const permitirAbrirPdf = checkbox(
    dados,
    "permitir_abrir_pdf"
  );

  if (
    titulo.length < 1 ||
    titulo.length > 240
  ) {
    return redirect(
      enderecoDocumento(id, "erro=validacao"),
      303
    );
  }

  if (
    secao !== "instituicao" &&
    secao !== "organizacao"
  ) {
    return redirect(
      enderecoDocumento(id, "erro=validacao"),
      303
    );
  }

  if (anoLetivo.length > 20) {
    return redirect(
      enderecoDocumento(id, "erro=validacao"),
      303
    );
  }

  const ordem = Number(ordemTexto || "0");

  if (
    !Number.isSafeInteger(ordem) ||
    ordem < 0
  ) {
    return redirect(
      enderecoDocumento(id, "erro=validacao"),
      303
    );
  }

  if (urlExterna) {
    if (urlExterna.length > 2000) {
      return redirect(
        enderecoDocumento(id, "erro=validacao"),
        303
      );
    }

    try {
      const url = new URL(urlExterna);

      if (
        url.protocol !== "https:" &&
        url.protocol !== "http:"
      ) {
        return redirect(
          enderecoDocumento(id, "erro=validacao"),
          303
        );
      }
    } catch {
      return redirect(
        enderecoDocumento(id, "erro=validacao"),
        303
      );
    }
  }

  // Um documento com PDF privado não pode receber
  // simultaneamente uma ligação externa.
  if (documento.caminho_pdf && urlExterna) {
    return redirect(
      enderecoDocumento(id, "erro=validacao"),
      303
    );
  }

  // Atualizar apenas os campos autorizados.
  // O campo "publicado" não é modificado:
  // - um rascunho continua em rascunho;
  // - um documento publicado continua publicado.
  //
  // A condição sobre o estado evita que o documento
  // mude de estado entre a consulta e a atualização.
  const {
    data: documentoAtualizado,
    error: erroAtualizacao,
  } = await supabase
    .from("documentacao")
    .update({
      titulo,
      descricao: descricao || null,
      secao,
      ano_letivo: anoLetivo || null,
      ordem,
      url_externa: urlExterna || null,
      mostrar_no_website: mostrarNoWebsite,
      permitir_abrir_pdf: permitirAbrirPdf,
      atualizado_em: new Date().toISOString(),
      atualizado_por: user.id,
    })
    .eq("id", id)
    .eq("publicado", documento.publicado)
    .select("id")
    .maybeSingle();

  if (erroAtualizacao) {
    console.error(
      "Erro ao atualizar documento institucional:",
      erroAtualizacao.message
    );

    return redirect(
      enderecoDocumento(id, "erro=guardar"),
      303
    );
  }

  if (!documentoAtualizado) {
    return respostaErro(
      "O documento não foi atualizado. O seu estado pode ter sido alterado entretanto ou deixou de estar acessível.",
      409
    );
  }

  return redirect(
    enderecoDocumento(id, "guardado=1"),
    303
  );
};