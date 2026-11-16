import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const BUCKET = "documentacao-privada";
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

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

function enderecoDocumento(
  id: string,
  parametro: string
): string {
  return `/admin/documentacao/${id}?${parametro}`;
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

function ePdf(conteudo: Uint8Array): boolean {
  if (conteudo.length < 5) {
    return false;
  }

  return (
    conteudo[0] === 0x25 &&
    conteudo[1] === 0x50 &&
    conteudo[2] === 0x44 &&
    conteudo[3] === 0x46 &&
    conteudo[4] === 0x2d
  );
}

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

  // Proteger contra pedidos provenientes de outras origens.
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
    return redirect("/admin/login", 303);
  }

  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || !perfil?.ativo) {
    return respostaErro(
      "Não tens autorização para substituir documentos.",
      403
    );
  }

  // A substituição exige a permissão de editar.
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
      .startsWith("multipart/form-data")
  ) {
    return respostaErro(
      "O pedido deve conter um formulário com ficheiro.",
      415
    );
  }

  const tamanhoPedido =
    Number(request.headers.get("content-length"));

  if (
    Number.isFinite(tamanhoPedido) &&
    tamanhoPedido > TAMANHO_MAXIMO + 1024 * 1024
  ) {
    return respostaErro(
      "O pedido excede o tamanho permitido.",
      413
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

  const id = texto(dados, "id");

  if (!UUID_REGEX.test(id)) {
    return respostaErro(
      "Identificador do documento inválido.",
      400
    );
  }

  const ficheiro = dados.get("pdf");

  if (!(ficheiro instanceof File)) {
    return redirect(
      enderecoDocumento(id, "erro=pdf"),
      303
    );
  }

  if (
    ficheiro.size === 0 ||
    ficheiro.size > TAMANHO_MAXIMO ||
    !ficheiro.name.toLowerCase().endsWith(".pdf") ||
    (
      ficheiro.type !== "" &&
      ficheiro.type !== "application/pdf"
    )
  ) {
    return redirect(
      enderecoDocumento(id, "erro=pdf"),
      303
    );
  }

  // Consultar o estado e a origem atuais do documento.
  const {
    data: documento,
    error: erroDocumento,
  } = await supabase
    .from("documentacao")
    .select(
      "id, publicado, caminho_pdf, url_externa"
    )
    .eq("id", id)
    .maybeSingle();

  if (erroDocumento) {
    console.error(
      "Erro ao consultar documento para substituir PDF:",
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

  // Um documento publicado exige também a
  // permissão de publicar, conforme a política RLS.
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
        "Para substituir o PDF de um documento publicado são necessárias as permissões de editar e publicar.",
        403
      );
    }
  }

  // Não associar simultaneamente PDF privado
  // e ligação externa.
  if (documento.url_externa) {
    return redirect(
      enderecoDocumento(id, "erro=validacao"),
      303
    );
  }

  let conteudo: Uint8Array;

  try {
    conteudo = new Uint8Array(
      await ficheiro.arrayBuffer()
    );
  } catch {
    return redirect(
      enderecoDocumento(id, "erro=pdf"),
      303
    );
  }

  if (
    conteudo.byteLength === 0 ||
    conteudo.byteLength > TAMANHO_MAXIMO ||
    !ePdf(conteudo)
  ) {
    return redirect(
      enderecoDocumento(id, "erro=pdf"),
      303
    );
  }

  // Cliente privilegiado exclusivamente no servidor.
  // A autorização do utilizador foi verificada acima.
  const urlSupabase =
    import.meta.env.PUBLIC_SUPABASE_URL;

  const chaveSecreta =
    import.meta.env.SUPABASE_SECRET_KEY;

  if (!urlSupabase || !chaveSecreta) {
    console.error(
      "Configuração de armazenamento privado indisponível."
    );

    return respostaErro(
      "O serviço de armazenamento não está configurado.",
      503
    );
  }

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

  // Criar sempre um caminho novo. Nunca substituir
  // diretamente o ficheiro anterior: assim, se
  // o carregamento falhar, o PDF atual permanece.
  const novoCaminho =
    `${id}/${randomUUID()}.pdf`;

  const {
    error: erroUpload,
  } = await armazenamento.storage
    .from(BUCKET)
    .upload(
      novoCaminho,
      conteudo,
      {
        contentType: "application/pdf",
        cacheControl: "0",
        upsert: false,
      }
    );

  if (erroUpload) {
    console.error(
      "Erro ao carregar novo PDF:",
      erroUpload.message
    );

    return redirect(
      enderecoDocumento(id, "erro=pdf"),
      303
    );
  }

  // Atualização condicional:
  // - mantém o estado de publicação;
  // - confirma que a origem não mudou;
  // - confirma que o PDF anterior ainda é o mesmo.
  //
  // Isto evita sobrescrever outra substituição
  // concluída entretanto.
  let consulta = supabase
    .from("documentacao")
    .update({
      caminho_pdf: novoCaminho,
      atualizado_em: new Date().toISOString(),
      atualizado_por: user.id,
    })
    .eq("id", id)
    .eq("publicado", documento.publicado)
    .is("url_externa", null);

  if (documento.caminho_pdf) {
    consulta = consulta.eq(
      "caminho_pdf",
      documento.caminho_pdf
    );
  } else {
    consulta = consulta.is("caminho_pdf", null);
  }

  const {
    data: documentoAtualizado,
    error: erroAtualizacao,
  } = await consulta
    .select("id")
    .maybeSingle();

  if (
    erroAtualizacao ||
    !documentoAtualizado
  ) {
    if (erroAtualizacao) {
      console.error(
        "Erro ao associar novo PDF ao documento:",
        erroAtualizacao.message
      );
    }

    // O novo PDF ainda não está associado ao
    // documento. Removê-lo para evitar ficheiros
    // abandonados.
    const { error: erroLimpeza } =
      await armazenamento.storage
        .from(BUCKET)
        .remove([novoCaminho]);

    if (erroLimpeza) {
      console.error(
        "Erro ao limpar PDF não associado:",
        erroLimpeza.message
      );
    }

    return redirect(
      enderecoDocumento(id, "erro=pdf"),
      303
    );
  }

  // Só depois de a nova versão estar associada
  // tentamos remover o PDF anterior.
  //
  // Uma falha nesta limpeza não afeta a versão nova.
  if (documento.caminho_pdf) {
    const { error: erroRemocao } =
      await armazenamento.storage
        .from(BUCKET)
        .remove([documento.caminho_pdf]);

    if (erroRemocao) {
      console.error(
        "O novo PDF foi guardado, mas não foi possível remover o anterior:",
        erroRemocao.message
      );
    }
  }

  return redirect(
    enderecoDocumento(id, "pdf_substituido=1"),
    303
  );
};