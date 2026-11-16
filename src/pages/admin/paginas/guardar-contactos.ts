import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return context.redirect("/admin/login", 303);
  }

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response("Acesso negado", { status: 403 });
  }

  const { data: podeEditar, error: erroPermissao } =
    await supabase.rpc("tem_permissao", {
      p_recurso: "paginas",
      p_acao: "editar",
    });

  if (erroPermissao || podeEditar !== true) {
    return new Response("Sem permissão para editar páginas", {
      status: 403,
    });
  }

  let form: FormData;

  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  const campo = (nome: string): string => {
    const valor = form.get(nome);
    return typeof valor === "string" ? valor.trim() : "";
  };

  const titulo_pagina = campo("titulo_pagina");
  const introducao = campo("introducao");
  const titulo_formulario = campo("titulo_formulario");
  const entidade = campo("entidade");
  const morada = campo("morada");
  const telefone = campo("telefone");
  const email = campo("email");
  const mapa = campo("mapa");

  const invalido =
    !titulo_pagina ||
    titulo_pagina.length > 200 ||
    !introducao ||
    introducao.length > 5000 ||
    !titulo_formulario ||
    titulo_formulario.length > 200 ||
    !entidade ||
    entidade.length > 250 ||
    !morada ||
    morada.length > 2000 ||
    !telefone ||
    telefone.length > 50 ||
    !/^[+()\d\s-]{6,50}$/.test(telefone) ||
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !mapa ||
    mapa.length > 2000 ||
    !/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+\/)/i.test(
      mapa
    );

  if (invalido) {
    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  const conteudo = {
    titulo_pagina,
    introducao,
    titulo_formulario,
    entidade,
    morada,
    telefone,
    email,
    mapa,
  };

  const { error } = await supabase
    .from("paginas_rascunhos")
    .upsert(
      {
        slug: "contactos",
        conteudo,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user.id,
      },
      { onConflict: "slug" }
    );

  if (error) {
    console.error(
      "Erro ao guardar rascunho de Contactos:",
      error.message
    );

    return context.redirect(
      "/admin/paginas/contactos?erro=1",
      303
    );
  }

  return context.redirect(
    "/admin/paginas/contactos?guardado=1",
    303
  );
};