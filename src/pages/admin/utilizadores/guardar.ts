
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const RECURSOS = [
  "noticias",
  "cursos",
  "eventos",
  "documentacao",
  "paginas",
  "utilizadores",
] as const;

const ACOES = [
  "ver",
  "criar",
  "editar",
  "eliminar",
  "publicar",
] as const;

const ACOES_PAGINAS = [
  "ver",
  "editar",
  "publicar",
] as const;

const RECURSOS_VALIDOS = new Set<string>(RECURSOS);
const ACOES_VALIDAS = new Set<string>(ACOES);
const ACOES_PAGINAS_VALIDAS = new Set<string>(ACOES_PAGINAS);

const TOTAL_PERMISSOES =
  (RECURSOS.length - 1) * ACOES.length +
  ACOES_PAGINAS.length;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

  const origem = request.headers.get("origin");

  if (origem && origem !== new URL(request.url).origin) {
    return new Response("Origem não autorizada.", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return redirect("/admin/login", 303);
  }

  // Apenas um Super Administrador ativo
  // pode gerir as permissões dos utilizadores.
  const {
    data: administrador,
    error: erroAdmin,
  } = await supabase
    .from("perfis")
    .select("id, perfil, ativo")
    .eq("id", user.id)
    .single();

  if (
    erroAdmin ||
    !administrador?.ativo ||
    administrador.perfil !== "super_admin"
  ) {
    return new Response("Acesso não autorizado.", {
      status: 403,
    });
  }

  let formulario: FormData;

  try {
    formulario = await request.formData();
  } catch {
    return new Response("Formulário inválido.", {
      status: 400,
    });
  }

  const utilizadorId = String(
    formulario.get("utilizador_id") || ""
  ).trim();

  if (!UUID_REGEX.test(utilizadorId)) {
    return new Response("Identificador inválido.", {
      status: 400,
    });
  }

  // Impedir a alteração das próprias permissões.
  if (utilizadorId === user.id) {
    return new Response(
      "Não podes alterar as permissões da tua própria conta.",
      { status: 403 }
    );
  }

  // Confirmar que o utilizador existe.
  const {
    data: destinatario,
    error: erroDestinatario,
  } = await supabase
    .from("perfis")
    .select("id, perfil")
    .eq("id", utilizadorId)
    .single();

  if (erroDestinatario || !destinatario) {
    return new Response("Utilizador não encontrado.", {
      status: 404,
    });
  }

  // Proteger as contas de Super Administrador.
  if (destinatario.perfil === "super_admin") {
    return new Response(
      "As permissões do Super Administrador não podem ser alteradas.",
      { status: 403 }
    );
  }

  const valores = formulario.getAll("permissoes");

  if (valores.length > TOTAL_PERMISSOES) {
    return new Response("Demasiadas permissões.", {
      status: 400,
    });
  }

  const selecionadas = new Set<string>();

  for (const valor of valores) {
    if (typeof valor !== "string") {
      return new Response("Permissão inválida.", {
        status: 400,
      });
    }

    const partes = valor.split(":");

    if (partes.length !== 2) {
      return new Response("Permissão inválida.", {
        status: 400,
      });
    }

    const [recurso, acao] = partes;

    if (
      !RECURSOS_VALIDOS.has(recurso) ||
      !ACOES_VALIDAS.has(acao)
    ) {
      return new Response("Permissão desconhecida.", {
        status: 400,
      });
    }

    // Nas páginas do website só existem
    // as permissões Ver, Editar e Publicar.
    if (
      recurso === "paginas" &&
      !ACOES_PAGINAS_VALIDAS.has(acao)
    ) {
      return new Response(
        "Esta ação não está disponível para Páginas do Website.",
        { status: 400 }
      );
    }

    if (selecionadas.has(`${recurso}:${acao}`)) {
      return new Response("Permissão duplicada.", {
        status: 400,
      });
    }

    selecionadas.add(`${recurso}:${acao}`);
  }

  // Guardar as permissões de cada área.
  // As opções desmarcadas ficam com permitido = false.
  const registos = RECURSOS.flatMap((recurso) => {
    const acoesPermitidas =
      recurso === "paginas"
        ? ACOES_PAGINAS
        : ACOES;

    return acoesPermitidas.map((acao) => ({
      utilizador_id: utilizadorId,
      recurso,
      acao,
      permitido: selecionadas.has(`${recurso}:${acao}`),
    }));
  });

  const { error: erroGuardar } = await supabase
    .from("permissoes_utilizador")
    .upsert(registos, {
      onConflict: "utilizador_id,recurso,acao",
    });

  if (erroGuardar) {
    console.error(
      "Erro ao guardar permissões:",
      erroGuardar.message
    );

    return new Response(
      "Não foi possível guardar as permissões.",
      { status: 500 }
    );
  }

  // Regressar à lista de utilizadores.
  return redirect("/admin/utilizadores/", 303);
};
