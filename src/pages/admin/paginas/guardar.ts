import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const origemPedido = context.request.headers.get("origin");

  if (origemPedido !== context.url.origin) {
    return new Response("Origem não autorizada", { status: 403 });
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
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    return new Response("Sem permissão", { status: 403 });
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
    return context.redirect("/admin/paginas/sobre-nos?erro=1", 303);
  }

  function campo(nome: string): string {
    const valor = form.get(nome);
    return typeof valor === "string" ? valor.trim() : "";
  }

  const missao_titulo = campo("missao_titulo");
  const missao_texto = campo("missao_texto");
  const missao_complemento = campo("missao_complemento");
  const missao_final = campo("missao_final");
  const historia_titulo = campo("historia_titulo");
  const marcosTexto = campo("marcos");

  if (
    !missao_titulo ||
    !missao_texto ||
    !missao_complemento ||
    !missao_final ||
    !historia_titulo ||
    !marcosTexto ||
    missao_titulo.length > 200 ||
    historia_titulo.length > 200 ||
    missao_texto.length > 10000 ||
    missao_complemento.length > 10000 ||
    missao_final.length > 10000 ||
    marcosTexto.length > 30000
  ) {
    return context.redirect("/admin/paginas/sobre-nos?erro=1", 303);
  }

  const linhas = marcosTexto
    .split(/\r?\n/)
    .filter((linha) => linha.trim());

  if (linhas.length === 0 || linhas.length > 100) {
    return context.redirect("/admin/paginas/sobre-nos?erro=1", 303);
  }

  const marcos: { ano: string; texto: string }[] = [];

  for (const linha of linhas) {
    const separador = linha.indexOf("|");

    if (separador === -1) {
      return context.redirect("/admin/paginas/sobre-nos?erro=1", 303);
    }

    const ano = linha.slice(0, separador).trim();
    const texto = linha.slice(separador + 1).trim();

    if (!/^\d{4}$/.test(ano) || !texto || texto.length > 3000) {
      return context.redirect("/admin/paginas/sobre-nos?erro=1", 303);
    }

    marcos.push({ ano, texto });
  }

  const { data: rascunhoAtual } = await supabase
    .from("paginas_rascunhos")
    .select("conteudo")
    .eq("slug", "sobre-nos")
    .maybeSingle();

  const { data: paginaAtual } = await supabase
    .from("paginas_conteudo")
    .select("conteudo")
    .eq("slug", "sobre-nos")
    .maybeSingle();

  const imagens: Record<string, string> = {};

  const origem = import.meta.env.PUBLIC_SUPABASE_URL;

  const prefixo =
    typeof origem === "string"
      ? `${origem.replace(/\/$/, "")}/storage/v1/object/public/paginas-imagens/sobre-nos/`
      : "";

  for (const numero of [1, 2, 3]) {
    const chave = `imagem_${numero}`;

    const valor =
      campo(chave) ||
      rascunhoAtual?.conteudo?.[chave] ||
      paginaAtual?.conteudo?.[chave] ||
      "";

    if (
      typeof valor !== "string" ||
      (valor &&
        (!prefixo ||
          !valor.startsWith(prefixo) ||
          valor.length > 2000 ||
          !/^https:\/\/[^\s]+$/.test(valor)))
    ) {
      return context.redirect("/admin/paginas/sobre-nos?erro=1", 303);
    }

    imagens[chave] = valor;
  }

  const conteudo = {
    ...imagens,
    missao_titulo,
    missao_texto,
    missao_complemento,
    missao_final,
    historia_titulo,
    marcos,
  };

  const { error } = await supabase
    .from("paginas_rascunhos")
    .upsert(
      {
        slug: "sobre-nos",
        conteudo,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user.id,
      },
      { onConflict: "slug" }
    );

  if (error) {
    console.error("Erro ao guardar rascunho:", error.message);

    return context.redirect(
      "/admin/paginas/sobre-nos?erro=1",
      303
    );
  }

  return context.redirect(
    "/admin/paginas/sobre-nos?guardado=1",
    303
  );
};