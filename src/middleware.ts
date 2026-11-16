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

  // Confirmar a sessão antes de renderizar a página.
  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login");
  }

  // Consultar o perfil do utilizador.
  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("id, nome, perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil || !perfil.ativo) {
    return context.redirect("/admin/login?erro=acesso");
  }

  // Manter a proteção existente dos utilizadores.
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

  // Consultar permissões ANTES de renderizar o layout.
  const recursos = [
    "noticias",
    "cursos",
    "eventos",
    "paginas",
    "documentacao",
  ] as const;

  const acoes = [
    "ver",
    "criar",
    "editar",
    "eliminar",
    "publicar",
  ] as const;

  const eSuperAdmin = perfil.perfil === "super_admin";

  const permissoesMenu: Record<string, boolean> = {};

  if (eSuperAdmin) {
    for (const recurso of recursos) {
      permissoesMenu[recurso] = true;
    }
  } else {
    const resultados = await Promise.all(
      recursos.map(async (recurso) => {
        for (const acao of acoes) {
          const { data, error } = await supabase.rpc(
            "tem_permissao",
            {
              p_recurso: recurso,
              p_acao: acao,
            }
          );

          if (!error && data === true) {
            return [recurso, true] as const;
          }
        }

        return [recurso, false] as const;
      })
    );

    for (const [recurso, permitido] of resultados) {
      permissoesMenu[recurso] = permitido;
    }
  }

  // Partilhar as permissões com o layout sem novas
  // consultas Supabase durante a renderização.
  context.locals.permissoesMenu = permissoesMenu;

  return next();
});