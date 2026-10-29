
import { defineMiddleware } from "astro:middleware";
import { criarSupabaseServer } from "./lib/supabase/server";

export const onRequest = defineMiddleware(async (context, next) => {
  const caminho = context.url.pathname;

  // Proteger apenas a área administrativa.
  if (!caminho.startsWith("/admin")) {
    return next();
  }

  // Permitir as páginas de autenticação.
  if (
    caminho === "/admin/login" ||
    caminho === "/admin/entrar"
  ) {
    return next();
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar a sessão do utilizador.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login");
  }

  // Consultar o perfil e verificar se está ativo.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("id, nome, perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil || !perfil.ativo) {
    return context.redirect("/admin/login?erro=acesso");
  }

  // Apenas o Super Admin pode entrar na futura
  // área de gestão de utilizadores.
  if (
    caminho.startsWith("/admin/utilizadores") &&
    perfil.perfil !== "super_admin"
  ) {
    return context.redirect("/admin/?erro=permissao");
  }

  // Guardar o perfil para as páginas seguintes.
  context.locals.perfilAdmin = {
    id: perfil.id,
    nome: perfil.nome,
    perfil: perfil.perfil,
    ativo: perfil.ativo,
  };

  return next();
});
