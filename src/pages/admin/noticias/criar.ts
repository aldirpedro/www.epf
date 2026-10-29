
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
  // Impede pedidos enviados a partir de outras origens.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // Verifica se existe uma sessão autenticada.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return context.redirect("/admin/login", 303);
  }

  // Confirma se a conta está ativa.
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

  // Consulta a permissão individual para criar notícias.
  // O Super Administrador tem acesso automático através
  // da função tem_permissao definida no Supabase.
  const {
    data: podeCriar,
    error: erroPermissaoCriar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "noticias",
    p_acao: "criar",
  });

  if (erroPermissaoCriar || podeCriar !== true) {
    return new Response(
      "Não tens permissão para criar notícias.",
      { status: 403 }
    );
  }

  // Lê os dados enviados pelo formulário.
  const form = await context.request.formData();

  const titulo = String(form.get("titulo") ?? "").trim();
  const resumo = String(form.get("resumo") ?? "").trim();
  const conteudo = String(form.get("conteudo") ?? "").trim();
  const publicada = form.get("publicada") === "true";

  // Criar e publicar são permissões diferentes.
  // Se o utilizador pretende publicar imediatamente,
  // também precisa da permissão noticias:publicar.
  if (publicada) {
    const {
      data: podePublicar,
      error: erroPermissaoPublicar,
    } = await supabase.rpc("tem_permissao", {
      p_recurso: "noticias",
      p_acao: "publicar",
    });

    if (erroPermissaoPublicar || podePublicar !== true) {
      return new Response(
        "Não tens permissão para publicar notícias. Podes guardar a notícia como rascunho.",
        { status: 403 }
      );
    }
  }

  // Valida os campos obrigatórios e os limites.
  if (
    !titulo ||
    titulo.length > 200 ||
    resumo.length > 500 ||
    !conteudo
  ) {
    return context.redirect(
      "/admin/noticias/nova?erro=campos",
      303
    );
  }

  const imagem = form.get("imagem");

  let imagemUrl: string | null = null;
  let caminhoImagem: string | null = null;

  // Processa a imagem, caso tenha sido selecionada.
  if (imagem instanceof File && imagem.size > 0) {
    const extensao = TIPOS_PERMITIDOS[imagem.type];

    // Verifica o formato e o tamanho máximo.
    if (!extensao || imagem.size > MAX_IMAGEM) {
      return context.redirect(
        "/admin/noticias/nova?erro=imagem",
        303
      );
    }

    // Verifica a assinatura real do ficheiro,
    // não apenas o tipo MIME declarado.
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
      return context.redirect(
        "/admin/noticias/nova?erro=imagem",
        303
      );
    }

    // Cria um nome único para evitar conflitos.
    const nomeFicheiro = `${crypto.randomUUID()}.${extensao}`;

    // Guarda a imagem numa pasta associada ao utilizador.
    caminhoImagem = `${user.id}/${nomeFicheiro}`;

    // Envia a imagem para o Supabase Storage.
    const { error: erroUpload } = await supabase.storage
      .from("noticias")
      .upload(caminhoImagem, imagem, {
        contentType: imagem.type,
        upsert: false,
      });

    if (erroUpload) {
      console.error(
        "Erro no upload:",
        erroUpload.message
      );

      return context.redirect(
        "/admin/noticias/nova?erro=upload",
        303
      );
    }

    // Obtém o endereço público da imagem.
    const { data: imagemPublica } = supabase.storage
      .from("noticias")
      .getPublicUrl(caminhoImagem);

    imagemUrl = imagemPublica.publicUrl;
  }

  // Guarda a notícia na base de dados.
  const { error: erroNoticia } = await supabase
    .from("noticias")
    .insert({
      titulo,
      resumo: resumo || null,
      conteudo,
      imagem_url: imagemUrl,
      publicada,
    });

  if (erroNoticia) {
    console.error(
      "Erro ao criar notícia:",
      erroNoticia.message
    );

    // A eliminação de imagens exige uma política
    // DELETE no Supabase Storage.
    if (caminhoImagem) {
      console.warn(
        "Imagem carregada sem notícia associada:",
        caminhoImagem
      );
    }

    return context.redirect(
      "/admin/noticias/nova?erro=guardar",
      303
    );
  }

  // Regressa à lista depois de guardar.
  return context.redirect("/admin/noticias", 303);
};
