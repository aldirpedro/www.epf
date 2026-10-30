
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

function obterTexto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

function obterDisciplinas(
  formulario: FormData,
  campo: string
): string[] {
  return obterTexto(formulario, campo)
    .split(/\r?\n/)
    .map((disciplina) => disciplina.trim())
    .filter(Boolean);
}

function respostaErro(mensagem: string, estado: number): Response {
  return new Response(mensagem, {
    status: estado,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const POST: APIRoute = async (Astro) => {
  // 1. Impedir pedidos enviados a partir de outros sites.
  const origem = Astro.request.headers.get("origin");

  if (origem !== Astro.url.origin) {
    return respostaErro("Origem não autorizada.", 403);
  }

  const supabase = criarSupabaseServer(Astro);

  // 2. Confirmar que o utilizador iniciou sessão.
  const {
    data: { user },
    error: erroUtilizador,
  } = await supabase.auth.getUser();

  if (erroUtilizador || !user) {
    return Astro.redirect("/admin/login", 303);
  }

  // 3. Confirmar que a conta está ativa.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return respostaErro(
      "A tua conta não está autorizada a gerir cursos.",
      403
    );
  }

  // 4. Verificar a permissão individual para criar cursos.
  // A função tem_permissao reconhece automaticamente
  // o Super Administrador ativo.
  const {
    data: podeCriar,
    error: erroPermissaoCriar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "cursos",
    p_acao: "criar",
  });

  if (erroPermissaoCriar) {
    console.error(
      "Erro ao verificar permissão de criação:",
      erroPermissaoCriar.message
    );

    return respostaErro(
      "Não foi possível verificar as permissões.",
      500
    );
  }

  if (podeCriar !== true) {
    return respostaErro(
      "Não tens permissão para criar cursos.",
      403
    );
  }

  // 5. Ler os dados do formulário.
  let formulario: FormData;

  try {
    formulario = await Astro.request.formData();
  } catch {
    return respostaErro("Formulário inválido.", 400);
  }

  const titulo = obterTexto(formulario, "titulo");
  const sigla = obterTexto(formulario, "sigla");
  const slug = obterTexto(formulario, "slug").toLowerCase();
  const tipo = obterTexto(formulario, "tipo");
  const area = obterTexto(formulario, "area");
  const icone = obterTexto(formulario, "icone");
  const nivel = obterTexto(formulario, "nivel");
  const duracao = obterTexto(formulario, "duracao");
  const certificacao = obterTexto(formulario, "certificacao");
  const acesso = obterTexto(formulario, "acesso");
  const perfilProfissional = obterTexto(formulario, "perfil");
  const conteudo = obterTexto(formulario, "conteudo");
  const publicado = formulario.get("publicado") === "true";

  // 6. Criar e publicar são permissões diferentes.
  // Se o curso for publicado imediatamente,
  // é necessária também a permissão cursos:publicar.
  if (publicado) {
    const {
      data: podePublicar,
      error: erroPermissaoPublicar,
    } = await supabase.rpc("tem_permissao", {
      p_recurso: "cursos",
      p_acao: "publicar",
    });

    if (erroPermissaoPublicar) {
      console.error(
        "Erro ao verificar permissão de publicação:",
        erroPermissaoPublicar.message
      );

      return respostaErro(
        "Não foi possível verificar a permissão de publicação.",
        500
      );
    }

    if (podePublicar !== true) {
      return respostaErro(
        "Não tens permissão para publicar cursos. Guarda o curso como rascunho.",
        403
      );
    }
  }

  // 7. Validar os campos obrigatórios.
  if (
    !titulo ||
    !slug ||
    !area ||
    !nivel ||
    !duracao ||
    !certificacao ||
    !acesso ||
    !perfilProfissional
  ) {
    return respostaErro(
      "Faltam preencher campos obrigatórios.",
      400
    );
  }

  if (
    titulo.length > 200 ||
    sigla.length > 20 ||
    slug.length > 120
  ) {
    return respostaErro(
      "Um dos campos ultrapassa o tamanho permitido.",
      400
    );
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return respostaErro(
      "O identificador (slug) é inválido.",
      400
    );
  }

  if (tipo !== "profissional" && tipo !== "cef") {
    return respostaErro(
      "O tipo de curso é inválido.",
      400
    );
  }

  const ordemTexto = obterTexto(formulario, "ordem");
  const ordem = ordemTexto === "" ? 0 : Number(ordemTexto);

  if (!Number.isSafeInteger(ordem) || ordem < 0) {
    return respostaErro(
      "A ordem deve ser um número inteiro igual ou superior a zero.",
      400
    );
  }

  // 8. Preparar o plano de formação.
  const componentes = [
    {
      nome: "Formação Sociocultural",
      disciplinas: obterDisciplinas(formulario, "sociocultural"),
    },
    {
      nome: "Formação Científica",
      disciplinas: obterDisciplinas(formulario, "cientifica"),
    },
    {
      nome: "Formação Técnica",
      disciplinas: obterDisciplinas(formulario, "tecnica"),
    },
    {
      nome: "Formação em Contexto de Trabalho",
      disciplinas: obterDisciplinas(formulario, "fct"),
    },
  ];

  // 9. Verificar a imagem selecionada.
  const imagemSelecionada = formulario.get("imagem");

  let imagem: File | null = null;

  if (
    imagemSelecionada instanceof File &&
    imagemSelecionada.size > 0
  ) {
    imagem = imagemSelecionada;

    const tiposPermitidos = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    const tamanhoMaximo = 5 * 1024 * 1024;

    if (!tiposPermitidos.includes(imagem.type)) {
      return respostaErro(
        "A imagem deve ser JPG, PNG ou WebP.",
        400
      );
    }

    if (imagem.size > tamanhoMaximo) {
      return respostaErro(
        "A imagem não pode ultrapassar 5 MB.",
        400
      );
    }

    // Verificar também a assinatura real do ficheiro.
    const bytes = new Uint8Array(
      await imagem.slice(0, 12).arrayBuffer()
    );

    const jpeg =
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;

    const png =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;

    const webp =
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

    const formatoValido =
      (imagem.type === "image/jpeg" && jpeg) ||
      (imagem.type === "image/png" && png) ||
      (imagem.type === "image/webp" && webp);

    if (!formatoValido) {
      return respostaErro(
        "O ficheiro selecionado não é uma imagem válida.",
        400
      );
    }
  }

  // 10. Verificar se já existe um curso com o mesmo slug.
  const { data: cursoExistente, error: erroConsulta } =
    await supabase
      .from("cursos")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

  if (erroConsulta) {
    console.error(
      "Erro ao verificar curso:",
      erroConsulta.message
    );

    return respostaErro(
      "Não foi possível verificar o curso.",
      500
    );
  }

  if (cursoExistente) {
    return respostaErro(
      "Já existe um curso com este identificador (slug).",
      409
    );
  }

  // 11. Carregar o cartaz para o Supabase Storage.
  let cartazes: string[] = [];
  let caminhoImagem: string | null = null;

  if (imagem) {
    const extensoes: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };

    const extensao = extensoes[imagem.type];

    // Nome único para evitar conflitos entre ficheiros.
    caminhoImagem = `${crypto.randomUUID()}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from("cursos")
      .upload(caminhoImagem, imagem, {
        contentType: imagem.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (erroUpload) {
      console.error(
        "Erro ao carregar cartaz:",
        erroUpload.message
      );

      return respostaErro(
        "Não foi possível carregar a imagem. Verifica as permissões do bucket cursos.",
        500
      );
    }

    const { data: dadosImagem } = supabase.storage
      .from("cursos")
      .getPublicUrl(caminhoImagem);

    cartazes = [dadosImagem.publicUrl];
  }

  // 12. Guardar o curso na base de dados.
  const { error: erroCriacao } = await supabase
    .from("cursos")
    .insert({
      titulo,
      sigla: sigla || null,
      slug,
      tipo,
      area,
      icone: icone || null,
      ordem,
      nivel,
      duracao,
      certificacao,
      acesso,
      perfil: perfilProfissional,

      // CORREÇÃO:
      // A coluna conteudo não aceita NULL.
      // Se estiver vazia, guardar "" em vez de null.
      conteudo,

      componentes,
      cartazes,
      publicado,
    });

  if (erroCriacao) {
    console.error("Erro ao criar curso:", {
      code: erroCriacao.code,
      message: erroCriacao.message,
    });

    // Se o curso não foi guardado, tentar eliminar
    // a imagem carregada para não deixar ficheiros soltos.
    if (caminhoImagem) {
      const { error: erroLimpeza } = await supabase.storage
        .from("cursos")
        .remove([caminhoImagem]);

      if (erroLimpeza) {
        console.error(
          "Não foi possível limpar a imagem:",
          erroLimpeza.message
        );
      }
    }

    if (erroCriacao.code === "23505") {
      return respostaErro(
        "Já existe um curso com este identificador (slug).",
        409
      );
    }

    return respostaErro(
      "Não foi possível guardar o curso. Consulta o Terminal do Astro.",
      500
    );
  }

  // 13. Voltar à lista depois de guardar.
  return Astro.redirect("/admin/cursos/", 303);
};
