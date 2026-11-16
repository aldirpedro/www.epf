import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const SLUG = "inicio";

const CAMPOS: Record<string, number> = {
  heroi_sobretitulo: 200,
  heroi_titulo: 200,
  heroi_destaque: 200,
  heroi_descricao: 1500,
  botao_inscricoes: 200,
  botao_oferta: 200,

  destaque_1_rotulo: 200,
  destaque_2_rotulo: 200,

  atalho_1_nome: 200,
  atalho_1_nota: 200,
  atalho_2_nome: 200,
  atalho_2_nota: 200,
  atalho_3_nome: 200,
  atalho_3_nota: 200,
  atalho_4_nome: 200,
  atalho_4_nota: 200,
  atalho_5_nome: 200,
  atalho_5_nota: 200,
  atalho_6_nome: 200,
  atalho_6_nota: 200,

  oferta_sobretitulo: 200,
  oferta_titulo: 200,
  oferta_descricao: 1500,
  cef_titulo: 200,
  cef_descricao: 1500,

  porque_sobretitulo: 200,
  porque_titulo: 200,

  pilar_1_titulo: 200,
  pilar_1_texto: 2000,
  pilar_2_titulo: 200,
  pilar_2_texto: 2000,
  pilar_3_titulo: 200,
  pilar_3_texto: 2000,

  noticias_sobretitulo: 200,
  noticias_titulo: 200,

  eventos_sobretitulo: 200,
  eventos_titulo: 200,
  eventos_descricao: 1500,
};

type ImagemHeroi = {
  url: string;
  alt: string;
};

function enderecoValido(valor: string): boolean {
  if (!valor || valor.length > 2000) {
    return false;
  }

  if (
    valor.startsWith("/") &&
    !valor.startsWith("//") &&
    !valor.includes("\\")
  ) {
    return true;
  }

  try {
    const url = new URL(valor);

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function validarImagens(
  valor: FormDataEntryValue | null
): ImagemHeroi[] | null {
  if (typeof valor !== "string") {
    return null;
  }

  let dados: unknown;

  try {
    dados = JSON.parse(valor);
  } catch {
    return null;
  }

  if (!Array.isArray(dados) || dados.length > 100) {
    return null;
  }

  const imagens: ImagemHeroi[] = [];

  for (const item of dados) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      return null;
    }

    const imagem = item as Record<string, unknown>;

    if (
      typeof imagem.url !== "string" ||
      typeof imagem.alt !== "string"
    ) {
      return null;
    }

    const url = imagem.url.trim();
    const alt = imagem.alt.trim();

    if (!enderecoValido(url) || alt.length > 300) {
      return null;
    }

    imagens.push({ url, alt });
  }

  return imagens;
}

function redirecionar(
  request: Request,
  parametro: string
): Response {
  const url = new URL(
    "/admin/paginas/inicio",
    request.url
  );

  url.searchParams.set(parametro, "1");

  return Response.redirect(url, 303);
}

export const POST: APIRoute = async (context) => {
  const { request } = context;

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
    return Response.redirect(
      new URL("/admin/login", request.url),
      303
    );
  }

  const { data: perfil, error: erroPerfil } =
    await supabase
      .from("perfis")
      .select("ativo")
      .eq("id", user.id)
      .single();

  if (erroPerfil || perfil?.ativo !== true) {
    return new Response("Acesso não autorizado.", {
      status: 403,
    });
  }

  const {
    data: podeEditar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "paginas",
    p_acao: "editar",
  });

  if (erroPermissao || podeEditar !== true) {
    return new Response(
      "Não tens permissão para editar páginas.",
      { status: 403 }
    );
  }

  let formulario: FormData;

  try {
    formulario = await request.formData();
  } catch {
    return redirecionar(request, "erro");
  }

  const conteudo: Record<string, unknown> = {};

  for (const [nome, maximo] of Object.entries(CAMPOS)) {
    const valores = formulario.getAll(nome);

    if (
      valores.length !== 1 ||
      typeof valores[0] !== "string"
    ) {
      return redirecionar(request, "erro");
    }

    const valor = valores[0].trim();

    if (!valor || valor.length > maximo) {
      return redirecionar(request, "erro");
    }

    conteudo[nome] = valor;
  }

  const valoresImagens = formulario.getAll(
    "heroi_imagens"
  );

  if (valoresImagens.length !== 1) {
    return redirecionar(request, "erro");
  }

  const imagens = validarImagens(valoresImagens[0]);

  if (imagens === null) {
    return redirecionar(request, "erro");
  }

  conteudo.heroi_imagens = imagens;

  const valoresImagemAlunos = formulario.getAll(
    "imagem_alunos"
  );

  if (
    valoresImagemAlunos.length !== 1 ||
    typeof valoresImagemAlunos[0] !== "string"
  ) {
    return redirecionar(request, "erro");
  }

  const imagemAlunos = valoresImagemAlunos[0].trim();

  if (
    imagemAlunos &&
    !enderecoValido(imagemAlunos)
  ) {
    return redirecionar(request, "erro");
  }

  conteudo.imagem_alunos = imagemAlunos;

  const { error: erroGuardar } = await supabase
    .from("paginas_rascunhos")
    .upsert(
      {
        slug: SLUG,
        conteudo,
        atualizado_por: user.id,
      },
      {
        onConflict: "slug",
      }
    );

  if (erroGuardar) {
    console.error(
      "Erro ao guardar rascunho da Página Inicial:",
      erroGuardar.message
    );

    return redirecionar(request, "erro");
  }

  return redirecionar(request, "guardado");
};