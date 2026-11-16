import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (context.request.headers.get("origin") !== context.url.origin) {
    return new Response("Origem não autorizada", { status: 403 });
  }

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return new Response("Sessão inválida", { status: 401 });
  }

  const { data: perfil } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (!perfil?.ativo) {
    return new Response("Acesso negado", { status: 403 });
  }

  const { data: permitido, error: erroPermissao } =
    await supabase.rpc("tem_permissao", {
      p_recurso: "paginas",
      p_acao: "editar",
    });

  if (erroPermissao || permitido !== true) {
    return new Response("Sem permissão", { status: 403 });
  }

  const dados = await context.request.formData();
  const campo = dados.get("campo");
  const ficheiro = dados.get("imagem");

  if (
    typeof campo !== "string" ||
    !["imagem_1", "imagem_2", "imagem_3"].includes(campo)
  ) {
    return new Response("Campo inválido", { status: 400 });
  }

  if (
    !(ficheiro instanceof File) ||
    !ficheiro.size ||
    ficheiro.size > 5 * 1024 * 1024
  ) {
    return new Response(
      "Imagem inválida ou superior a 5 MB",
      { status: 400 }
    );
  }

  const extensoes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  const extensao = extensoes[ficheiro.type];

  if (!extensao) {
    return new Response("Formato não permitido", { status: 400 });
  }

  const caminho =
    `sobre-nos/${campo}-${crypto.randomUUID()}.${extensao}`;

  const { error } = await supabase.storage
    .from("paginas-imagens")
    .upload(caminho, ficheiro, {
      contentType: ficheiro.type,
      upsert: false,
    });

  if (error) {
    console.error("Erro no upload:", error.message);
    return new Response(
      "Não foi possível carregar a fotografia",
      { status: 500 }
    );
  }

  const { data } = supabase.storage
    .from("paginas-imagens")
    .getPublicUrl(caminho);

  return Response.json({
    campo,
    url: data.publicUrl,
  });
};