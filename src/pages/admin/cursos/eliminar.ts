
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function erro(mensagem: string, status = 400): Response {
  return new Response(mensagem, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

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

  // 4. Verificar a permissão individual para eliminar cursos.
  const {
    data: podeEliminar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "cursos",
    p_acao: "eliminar",
  });

  if (erroPermissao) {
    console.error(
      "Erro ao verificar permissão de eliminação:",
      erroPermissao.message
    );

    return erro(
      "Não foi possível verificar as permissões.",
      500
    );
  }

  if (podeEliminar !== true) {
    return erro(
      "Não tens permissão para eliminar cursos.",
      403
    );
  }

  // 5. Receber o identificador do curso.
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

  // 6. Verificar se o curso existe.
  const {
    data: curso,
    error: erroConsulta,
  } = await supabase
    .from("cursos")
    .select("id")
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

  // 7. Eliminar o curso da base de dados.
  const {
    data: eliminado,
    error: erroEliminacao,
  } = await supabase
    .from("cursos")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (erroEliminacao) {
    console.error(
      "Erro ao eliminar curso:",
      erroEliminacao.message
    );

    return erro(
      "Não foi possível eliminar o curso.",
      500
    );
  }

  if (!eliminado) {
    return erro(
      "O curso já não existe ou não foi possível eliminá-lo.",
      404
    );
  }

  // 8. Regressar à gestão de cursos.
  return Astro.redirect("/admin/cursos/", 303);
};
