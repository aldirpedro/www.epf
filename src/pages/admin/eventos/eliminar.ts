
import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  // Aceitar apenas pedidos do próprio website.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada.", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar a autenticação.
  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return context.redirect("/admin/login", 303);
  }

  // Confirmar que a conta está ativa.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response("Conta sem acesso autorizado.", {
      status: 403,
    });
  }

  // Verificar a permissão Eventos → Eliminar.
  const {
    data: podeEliminar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "eventos",
    p_acao: "eliminar",
  });

  if (erroPermissao || podeEliminar !== true) {
    return new Response(
      "Não tens permissão para eliminar eventos.",
      { status: 403 }
    );
  }

  // Ler o identificador do evento.
  let form: FormData;

  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(
      "/admin/eventos/?erro=pedido",
      303
    );
  }

  const id = String(form.get("id") ?? "").trim();

  if (!UUID_REGEX.test(id)) {
    return new Response("Identificador inválido.", {
      status: 400,
    });
  }

  // Confirmar que o evento existe e obter a imagem.
  const { data: evento, error: erroEvento } = await supabase
    .from("eventos")
    .select("id, imagem_url")
    .eq("id", id)
    .single();

  if (erroEvento || !evento) {
    return context.redirect(
      "/admin/eventos/?erro=nao-encontrado",
      303
    );
  }

  // Eliminar o registo da base de dados.
  // As políticas RLS continuam a ser aplicadas.
  const { data: eliminado, error: erroEliminar } =
    await supabase
      .from("eventos")
      .delete()
      .eq("id", id)
      .select("id")
      .single();

  if (erroEliminar || !eliminado) {
    console.error(
      "Erro ao eliminar evento:",
      erroEliminar?.message ??
        "Nenhum registo foi eliminado."
    );

    return context.redirect(
      "/admin/eventos/?erro=eliminar",
      303
    );
  }

  // A imagem não é apagada automaticamente.
  // Primeiro garantimos que o evento foi eliminado
  // com sucesso. A limpeza de ficheiros poderá ser
  // tratada posteriormente, com políticas próprias.

  return context.redirect("/admin/eventos/", 303);
};
