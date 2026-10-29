
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

function texto(formulario: FormData, nome: string): string {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

function disciplinas(
  formulario: FormData,
  nome: string
): string[] {
  return texto(formulario, nome)
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function erro(mensagem: string, status = 400): Response {
  return new Response(mensagem, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (Astro) => {
  // 1. Proteger contra pedidos de outros sites.
  const origem = Astro.request.headers.get("origin");

  if (origem !== Astro.url.origin) {
    return erro("Origem não autorizada.", 403);
  }

  const supabase = criarSupabaseServer(Astro);

  // 2. Confirmar que o utilizador iniciou sessão.
  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return Astro.redirect("/admin/login", 303);
  }

  // 3. Confirmar que a conta está ativa.
  const {
    data: perfil,
    error: erroPerfil,
  } = await supabase
    .from("perfis")
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return erro("Acesso não autorizado.", 403);
  }

  // 4. Verificar a permissão individual para editar cursos.
  const {
    data: podeEditar,
    error: erroPermissaoEditar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "cursos",
    p_acao: "editar",
  });

  if (erroPermissaoEditar) {
    console.error(
      "Erro ao verificar permissão de edição:",
      erroPermissaoEditar.message
    );

    return erro(
      "Não foi possível verificar as permissões.",
      500
    );
  }

  if (podeEditar !== true) {
    return erro(
      "Não tens permissão para editar cursos.",
      403
    );
  }

  // 5. Ler o formulário.
  let formulario: FormData;

  try {
    formulario = await Astro.request.formData();
  } catch {
    return erro("Não foi possível ler o formulário.");
  }

  const id = texto(formulario, "id");
  const titulo = texto(formulario, "titulo");
  const sigla = texto(formulario, "sigla");
  const slug = texto(formulario, "slug").toLowerCase();
  const tipo = texto(formulario, "tipo");
  const area = texto(formulario, "area");
  const icone = texto(formulario, "icone");
  const nivel = texto(formulario, "nivel");
  const duracao = texto(formulario, "duracao");
  const certificacao = texto(formulario, "certificacao");
  const acesso = texto(formulario, "acesso");
  const perfilProfissional = texto(formulario, "perfil");
  const conteudo = texto(formulario, "conteudo");
  const publicado = formulario.get("publicado") === "true";

  if (!UUID.test(id)) {
    return erro("Identificador do curso inválido.");
  }

  // 6. Validar os campos obrigatórios.
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
    return erro("Preenche todos os campos obrigatórios.");
  }

  if (
    titulo.length > 200 ||
    sigla.length > 20 ||
    slug.length > 120
  ) {
    return erro(
      "Um dos campos ultrapassa o tamanho permitido."
    );
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return erro(
      "O slug só pode conter letras minúsculas, números e hífenes."
    );
  }

  if (tipo !== "profissional" && tipo !== "cef") {
    return erro("Tipo de curso inválido.");
  }

  const ordemTexto = texto(formulario, "ordem");
  const ordem = ordemTexto === "" ? 0 : Number(ordemTexto);

  if (!Number.isSafeInteger(ordem) || ordem < 0) {
    return erro(
      "A ordem deve ser um número inteiro positivo ou zero."
    );
  }

  // 7. Procurar o curso existente, incluindo
  // o estado atual de publicação.
  const {
    data: cursoAtual,
    error: erroCurso,
  } = await supabase
    .from("cursos")
    .select("id, slug, cartazes, publicado")
    .eq("id", id)
    .maybeSingle();

  if (erroCurso) {
    console.error(
      "Erro ao consultar curso:",
      erroCurso.message
    );

    return erro(
      "Não foi possível consultar o curso.",
      500
    );
  }

  if (!cursoAtual) {
    return erro("Curso não encontrado.", 404);
  }

  // 8. Se o estado de publicação mudar,
  // verificar a permissão cursos:publicar.
  //
  // Isto complementa o trigger de segurança
  // que já criámos no Supabase.
  if (publicado !== cursoAtual.publicado) {
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

      return erro(
        "Não foi possível verificar a permissão de publicação.",
        500
      );
    }

    if (podePublicar !== true) {
      return erro(
        "Não tens permissão para publicar ou despublicar cursos.",
        403
      );
    }
  }

  // 9. Verificar se o novo slug já pertence a outro curso.
  const {
    data: cursoDuplicado,
    error: erroDuplicado,
  } = await supabase
    .from("cursos")
    .select("id")
    .eq("slug", slug)
    .neq("id", id)
    .maybeSingle();

  if (erroDuplicado) {
    console.error(
      "Erro ao verificar slug:",
      erroDuplicado.message
    );

    return erro(
      "Não foi possível verificar o slug.",
      500
    );
  }

  if (cursoDuplicado) {
    return erro(
      "Já existe outro curso com este identificador (slug).",
      409
    );
  }

  // 10. Preparar o plano de formação.
  const componentes = [
    {
      nome: "Formação Sociocultural",
      disciplinas: disciplinas(formulario, "sociocultural"),
    },
    {
      nome: "Formação Científica",
      disciplinas: disciplinas(formulario, "cientifica"),
    },
    {
      nome: "Formação Técnica",
      disciplinas: disciplinas(formulario, "tecnica"),
    },
    {
      nome: "Formação em Contexto de Trabalho",
      disciplinas: disciplinas(formulario, "fct"),
    },
  ];

  // 11. Verificar se foi escolhida uma nova imagem.
  const ficheiro = formulario.get("imagem");

  let novaImagem: File | null = null;

  if (ficheiro instanceof File && ficheiro.size > 0) {
    novaImagem = ficheiro;

    const tiposPermitidos = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!tiposPermitidos.includes(novaImagem.type)) {
      return erro("O cartaz deve ser JPG, PNG ou WebP.");
    }

    if (novaImagem.size > 5 * 1024 * 1024) {
      return erro("O cartaz não pode ultrapassar 5 MB.");
    }

    // Confirmar a assinatura real do ficheiro.
    const bytes = new Uint8Array(
      await novaImagem.slice(0, 12).arrayBuffer()
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
      (novaImagem.type === "image/jpeg" && jpeg) ||
      (novaImagem.type === "image/png" && png) ||
      (novaImagem.type === "image/webp" && webp);

    if (!formatoValido) {
      return erro(
        "O ficheiro selecionado não é uma imagem válida."
      );
    }
  }

  // 12. Manter os cartazes atuais por defeito.
  let cartazes: string[] = Array.isArray(cursoAtual.cartazes)
    ? cursoAtual.cartazes
    : [];

  let caminhoNovoCartaz: string | null = null;

  // Se houver nova imagem, carregá-la para o Storage.
  if (novaImagem) {
    const extensoes: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };

    const extensao = extensoes[novaImagem.type];

    caminhoNovoCartaz =
      `${crypto.randomUUID()}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from("cursos")
      .upload(caminhoNovoCartaz, novaImagem, {
        contentType: novaImagem.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (erroUpload) {
      console.error(
        "Erro ao carregar novo cartaz:",
        erroUpload.message
      );

      return erro(
        "Não foi possível carregar o cartaz. Verifica as permissões do Storage.",
        500
      );
    }

    const { data: dadosCartaz } = supabase.storage
      .from("cursos")
      .getPublicUrl(caminhoNovoCartaz);

    // Substituir apenas o primeiro cartaz.
    // Os cartazes adicionais continuam guardados.
    cartazes = [
      dadosCartaz.publicUrl,
      ...cartazes.slice(1),
    ];
  }

  // 13. Atualizar os dados do curso.
  const {
    data: atualizado,
    error: erroAtualizacao,
  } = await supabase
    .from("cursos")
    .update({
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
      conteudo: conteudo || null,
      componentes,
      cartazes,
      publicado,
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (erroAtualizacao || !atualizado) {
    console.error(
      "Erro ao atualizar curso:",
      erroAtualizacao
    );

    // Se a atualização falhar, tentar limpar
    // o cartaz que acabámos de carregar.
    if (caminhoNovoCartaz) {
      const { error: erroLimpeza } =
        await supabase.storage
          .from("cursos")
          .remove([caminhoNovoCartaz]);

      if (erroLimpeza) {
        console.error(
          "Erro ao limpar cartaz:",
          erroLimpeza.message
        );
      }
    }

    if (erroAtualizacao?.code === "23505") {
      return erro(
        "Já existe um curso com este slug.",
        409
      );
    }

    return erro(
      "Não foi possível guardar as alterações. Consulta o Terminal.",
      500
    );
  }

  // 14. Regressar à lista de cursos.
  return Astro.redirect("/admin/cursos/", 303);
};
