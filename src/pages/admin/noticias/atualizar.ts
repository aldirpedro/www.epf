
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const MAX_IMAGEM = 5 * 1024 * 1024;

const TIPOS_PERMITIDOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const POST: APIRoute = async (context) => {
  // Proteção contra pedidos enviados de outros sites.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar que o utilizador iniciou sessão.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login", 303);
  }

  // Consultar o estado da conta.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response("Conta sem acesso autorizado", {
      status: 403,
    });
  }

  // Verificar a permissão individual para editar notícias.
  const {
    data: podeEditar,
    error: erroPermissaoEditar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "noticias",
    p_acao: "editar",
  });

  if (erroPermissaoEditar || podeEditar !== true) {
    return new Response(
      "Não tens permissão para editar notícias.",
      { status: 403 }
    );
  }

  // Ler os dados enviados pelo formulário.
  const form = await context.request.formData();

  const id = String(form.get("id") ?? "").trim();
  const titulo = String(form.get("titulo") ?? "").trim();
  const resumo = String(form.get("resumo") ?? "").trim();
  const conteudo = String(form.get("conteudo") ?? "").trim();
  const publicada = form.get("publicada") === "true";

  // Verificar se o identificador é um UUID válido.
  const idValido =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id
    );

  // Validar os campos.
  if (
    !idValido ||
    !titulo ||
    titulo.length > 200 ||
    resumo.length > 500 ||
    !conteudo
  ) {
    return new Response("Dados inválidos", {
      status: 400,
    });
  }

  // Procurar a notícia que vai ser editada.
  // Incluímos o estado atual de publicação para detetar
  // se o utilizador pretende publicar ou despublicar.
  const { data: noticiaAtual, error: erroConsulta } =
    await supabase
      .from("noticias")
      .select("id, imagem_url, publicada")
      .eq("id", id)
      .single();

  if (erroConsulta || !noticiaAtual) {
    return new Response("Notícia não encontrada", {
      status: 404,
    });
  }

  // Só é necessária a permissão de publicar quando
  // o estado de publicação vai realmente mudar.
  const estadoPublicacaoMudou =
    publicada !== noticiaAtual.publicada;

  if (estadoPublicacaoMudou) {
    const {
      data: podePublicar,
      error: erroPermissaoPublicar,
    } = await supabase.rpc("tem_permissao", {
      p_recurso: "noticias",
      p_acao: "publicar",
    });

    if (erroPermissaoPublicar || podePublicar !== true) {
      return new Response(
        "Não tens permissão para publicar ou despublicar notícias.",
        { status: 403 }
      );
    }
  }

  let imagemUrl = noticiaAtual.imagem_url;
  let novoCaminhoImagem: string | null = null;

  const imagem = form.get("imagem");

  // Só substituir a imagem se o utilizador escolher uma nova.
  if (imagem instanceof File && imagem.size > 0) {
    const extensao = TIPOS_PERMITIDOS[imagem.type];

    if (!extensao || imagem.size > MAX_IMAGEM) {
      return new Response(
        "Imagem inválida. Usa JPG, PNG ou WebP até 5 MB.",
        { status: 400 }
      );
    }

    // Confirmar a assinatura real do ficheiro.
    const cabecalho = new Uint8Array(
      await imagem.slice(0, 12).arrayBuffer()
    );

    const ehJpeg =
      cabecalho[0] === 0xff &&
      cabecalho[1] === 0xd8 &&
      cabecalho[2] === 0xff;

    const ehPng =
      cabecalho[0] === 0x89 &&
      cabecalho[1] === 0x50 &&
      cabecalho[2] === 0x4e &&
      cabecalho[3] === 0x47 &&
      cabecalho[4] === 0x0d &&
      cabecalho[5] === 0x0a &&
      cabecalho[6] === 0x1a &&
      cabecalho[7] === 0x0a;

    const ehWebp =
      String.fromCharCode(...cabecalho.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...cabecalho.slice(8, 12)) === "WEBP";

    const assinaturaValida =
      (extensao === "jpg" && ehJpeg) ||
      (extensao === "png" && ehPng) ||
      (extensao === "webp" && ehWebp);

    if (!assinaturaValida) {
      return new Response("Formato de imagem inválido", {
        status: 400,
      });
    }

    // Criar um nome único para a nova imagem.
    novoCaminhoImagem =
      `${user.id}/${crypto.randomUUID()}.${extensao}`;

    // Enviar a imagem para o Supabase Storage.
    const { error: erroUpload } = await supabase.storage
      .from("noticias")
      .upload(novoCaminhoImagem, imagem, {
        contentType: imagem.type,
        upsert: false,
      });

    if (erroUpload) {
      console.error(
        "Erro ao carregar imagem:",
        erroUpload.message
      );

      return new Response(
        "Não foi possível carregar a nova imagem.",
        { status: 500 }
      );
    }

    // Obter o endereço público da nova imagem.
    const { data: imagemPublica } = supabase.storage
      .from("noticias")
      .getPublicUrl(novoCaminhoImagem);

    imagemUrl = imagemPublica.publicUrl;
  }

  // Atualizar os dados da notícia.
  const { data: noticiaAtualizada, error: erroAtualizacao } =
    await supabase
      .from("noticias")
      .update({
        titulo,
        resumo: resumo || null,
        conteudo,
        imagem_url: imagemUrl,
        publicada,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .single();

  if (erroAtualizacao || !noticiaAtualizada) {
    console.error(
      "Erro ao atualizar notícia:",
      erroAtualizacao?.message ??
        "A atualização não devolveu nenhum registo."
    );

    if (novoCaminhoImagem) {
      console.warn(
        "Nova imagem carregada, mas não associada à notícia:",
        novoCaminhoImagem
      );
    }

    return new Response(
      "Não foi possível guardar as alterações.",
      { status: 500 }
    );
  }

  // Regressar à lista de notícias.
  return context.redirect("/admin/noticias", 303);
};
