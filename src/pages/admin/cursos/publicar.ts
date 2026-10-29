
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

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

  // 2. Verificar se o utilizador iniciou sessão.
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
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return erro("Acesso não autorizado.", 403);
  }

  // 4. Confirmar permissão para editar cursos.
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

  // 5. Confirmar permissão para publicar cursos.
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
      "Não foi possível verificar as permissões.",
      500
    );
  }

  if (podePublicar !== true) {
    return erro(
      "Não tens permissão para publicar ou despublicar cursos.",
      403
    );
  }

  // 6. Receber o identificador do curso.
  let formulario: FormData;

  try {
    formulario = await Astro.request.formData();
  } catch {
    return erro("Formulário inválido.");
  }

  const valorId = formulario.get("id");

  const id =
    typeof valorId === "string"
      ? valorId.trim()
      : "";

  if (!UUID.test(id)) {
    return erro("Identificador do curso inválido.");
  }

  // 7. Consultar o estado atual do curso.
  const {
    data: curso,
    error: erroConsulta,
  } = await supabase
    .from("cursos")
    .select("id, publicado")
    .eq("id", id)
    .maybeSingle();

  if (erroConsulta) {
    console.error(
      "Erro ao consultar curso:",
      erroConsulta.message
    );

    return erro(
      "Não foi possível consultar o curso.",
      500
    );
  }

  if (!curso) {
    return erro("Curso não encontrado.", 404);
  }

  // 8. Inverter o estado de publicação.
  const novoEstado = !curso.publicado;

  const {
    data: cursoAtualizado,
    error: erroAtualizacao,
  } = await supabase
    .from("cursos")
    .update({
      publicado: novoEstado,
    })
    .eq("id", id)
    .eq("publicado", curso.publicado)
    .select("id")
    .maybeSingle();

  if (erroAtualizacao) {
    console.error(
      "Erro ao alterar publicação do curso:",
      erroAtualizacao.message
    );

    return erro(
      "Não foi possível alterar a publicação do curso.",
      500
    );
  }

  // Se alguém alterou o estado entretanto,
  // não devemos inverter novamente sem confirmação.
  if (!cursoAtualizado) {
    return erro(
      "O estado do curso foi alterado entretanto. Atualiza a página e tenta novamente.",
      409
    );
  }

  // 9. Regressar à gestão de cursos.
  return Astro.redirect("/admin/cursos/", 303);
};
