
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const RECURSOS = [
  "noticias",
  "cursos",
  "eventos",
  "documentacao",
  "utilizadores",
] as const;

const ACOES = [
  "ver",
  "criar",
  "editar",
  "eliminar",
  "publicar",
] as const;

const RECURSOS_VALIDOS = new Set<string>(RECURSOS);
const ACOES_VALIDAS = new Set<string>(ACOES);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;

  const origem = request.headers.get("origin");

  if (origem && origem !== new URL(request.url).origin) {
    return new Response("Origem não autorizada.", { status: 403 });
  }

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return redirect("/admin/login");
  }

  // A autorização é novamente verificada no servidor.
  const { data: administrador, error: erroAdmin } = await supabase
    .from("perfis")
    .select("id, perfil, ativo")
    .eq("id", user.id)
    .single();

  if (
    erroAdmin ||
    !administrador?.ativo ||
    administrador.perfil !== "super_admin"
  ) {
    return new Response("Acesso não autorizado.", { status: 403 });
  }

  let formulario: FormData;

  try {
    formulario = await request.formData();
  } catch {
    return new Response("Formulário inválido.", { status: 400 });
  }

  const utilizadorId = String(
    formulario.get("utilizador_id") || ""
  ).trim();

  if (!UUID_REGEX.test(utilizadorId)) {
    return new Response("Identificador inválido.", { status: 400 });
  }

  if (utilizadorId === user.id) {
    return new Response(
      "Não podes alterar as permissões da tua própria conta.",
      { status: 403 }
    );
  }

  const { data: destinatario, error: erroDestinatario } =
    await supabase
      .from("perfis")
      .select("id, perfil")
      .eq("id", utilizadorId)
      .single();

  if (erroDestinatario || !destinatario) {
    return new Response("Utilizador não encontrado.", {
      status: 404,
    });
  }

  if (destinatario.perfil === "super_admin") {
    return new Response(
      "As permissões do Super Administrador não podem ser alteradas.",
      { status: 403 }
    );
  }

  const valores = formulario.getAll("permissoes");

  if (valores.length > RECURSOS.length * ACOES.length) {
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

    selecionadas.add(`${recurso}:${acao}`);
  }

  // Guardamos uma linha para cada combinação.
  // As caixas desmarcadas ficam explicitamente como false.
  const registos = RECURSOS.flatMap((recurso) =>
    ACOES.map((acao) => ({
      utilizador_id: utilizadorId,
      recurso,
      acao,
      permitido: selecionadas.has(`${recurso}:${acao}`),
    }))
  );

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

  return redirect(
    `/admin/utilizadores/editar/${utilizadorId}?guardado=1`,
    303
  );
};
