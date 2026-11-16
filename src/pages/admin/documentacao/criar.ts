import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const MAX_PDF_BYTES = 10 * 1024 * 1024;

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

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

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
      "Não foi possível ler os dados do formulário.",
      400
    );
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

  if (!titulo || titulo.length > 240) {
    return respostaErro(
      "O título é obrigatório e não pode ultrapassar 240 caracteres.",
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
    ordem < 0
  ) {
    return respostaErro(
      "A ordem de apresentação deve ser um número inteiro igual ou superior a zero.",
      400
    );
  }

  if (urlExterna) {
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

  if (ficheiroPdf && urlExterna) {
    return respostaErro(
      "Escolhe apenas uma opção: carregar um PDF ou indicar uma ligação externa.",
      400
    );
  }

  if (
    ficheiroPdf &&
    ficheiroPdf.size > MAX_PDF_BYTES
  ) {
    return respostaErro(
      "O PDF não pode ultrapassar 10 MB.",
      400
    );
  }

  if (ficheiroPdf) {
    const nomeValido = /\.pdf$/i.test(
      ficheiroPdf.name
    );

    const tipoValido =
      ficheiroPdf.type === "application/pdf" ||
      ficheiroPdf.type === "";

    if (!nomeValido || !tipoValido) {
      return respostaErro(
        "O ficheiro selecionado deve ser um PDF.",
        400
      );
    }
  }

  let caminhoPdf: string | null = null;

  if (ficheiroPdf) {
    const bytes = new Uint8Array(
      await ficheiroPdf.arrayBuffer()
    );

    const assinaturaPdf =
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d;

    if (!assinaturaPdf) {
      return respostaErro(
        "O ficheiro não contém uma assinatura PDF válida.",
        400
      );
    }

    caminhoPdf = `${randomUUID()}.pdf`;

    const { error: erroUpload } =
      await supabase.storage
        .from("documentacao-privada")
        .upload(caminhoPdf, bytes, {
          contentType: "application/pdf",
          cacheControl: "3600",
          upsert: false,
        });

    if (erroUpload) {
      console.error(
        "Erro ao carregar PDF institucional:",
        erroUpload.message
      );

      return respostaErro(
        "Não foi possível carregar o PDF. Tenta novamente.",
        500
      );
    }
  }

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
      "Erro ao guardar documento institucional:",
      erroInsercao.message
    );

    if (caminhoPdf) {
      const { error: erroLimpeza } =
        await supabase.storage
          .from("documentacao-privada")
          .remove([caminhoPdf]);

      if (erroLimpeza) {
        console.error(
          "Não foi possível remover o PDF após falha de gravação:",
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