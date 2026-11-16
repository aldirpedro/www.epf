import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const BUCKET = "inicio-imagens";
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

type TipoImagem = {
  extensao: string;
  mime: string;
};

function resposta(
  mensagem: string,
  estado: number,
  dados: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      sucesso: estado >= 200 && estado < 300,
      mensagem,
      ...dados,
    }),
    {
      status: estado,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function identificarImagem(
  bytes: Uint8Array
): TipoImagem | null {
  // JPEG
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return {
      extensao: "jpg",
      mime: "image/jpeg",
    };
  }

  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return {
      extensao: "png",
      mime: "image/png",
    };
  }

  const textoAscii = (
    inicio: number,
    fim: number
  ): string =>
    Array.from(bytes.slice(inicio, fim))
      .map((byte) => String.fromCharCode(byte))
      .join("");

  // WebP
  if (
    bytes.length >= 12 &&
    textoAscii(0, 4) === "RIFF" &&
    textoAscii(8, 12) === "WEBP"
  ) {
    return {
      extensao: "webp",
      mime: "image/webp",
    };
  }

  // AVIF
  if (
    bytes.length >= 16 &&
    textoAscii(4, 8) === "ftyp" &&
    ["avif", "avis"].includes(textoAscii(8, 12))
  ) {
    return {
      extensao: "avif",
      mime: "image/avif",
    };
  }

  return null;
}

export const POST: APIRoute = async (context) => {
  const { request } = context;

  // 1. Validar a origem do pedido.
  const origem = request.headers.get("origin");
  const origemEsperada = new URL(request.url).origin;

  if (origem !== origemEsperada) {
    return resposta(
      "Origem não autorizada.",
      403
    );
  }

  // 2. Confirmar a sessão.
  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAuth,
  } = await supabase.auth.getUser();

  if (erroAuth || !user) {
    return resposta(
      "É necessário iniciar sessão.",
      401
    );
  }

  // 3. Confirmar que o perfil está ativo.
  const {
    data: perfil,
    error: erroPerfil,
  } = await supabase
    .from("perfis")
    .select("ativo")
    .eq("id", user.id)
    .single();

  if (erroPerfil || perfil?.ativo !== true) {
    return resposta(
      "Perfil sem autorização.",
      403
    );
  }

  // 4. Verificar a permissão de edição.
  const {
    data: podeEditar,
    error: erroPermissao,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "paginas",
    p_acao: "editar",
  });

  if (erroPermissao || podeEditar !== true) {
    return resposta(
      "Não tens permissão para carregar imagens.",
      403
    );
  }

  // 5. Verificar o tamanho declarado do pedido.
  const tamanhoPedido = Number(
    request.headers.get("content-length")
  );

  if (
    Number.isFinite(tamanhoPedido) &&
    tamanhoPedido > TAMANHO_MAXIMO + 1024 * 1024
  ) {
    return resposta(
      "O ficheiro ultrapassa o tamanho máximo permitido.",
      413
    );
  }

  // 6. Ler o ficheiro enviado.
  let formulario: FormData;

  try {
    formulario = await request.formData();
  } catch {
    return resposta(
      "Não foi possível ler o ficheiro.",
      400
    );
  }

  const ficheiros = formulario.getAll("imagem");

  if (
    ficheiros.length !== 1 ||
    !(ficheiros[0] instanceof File)
  ) {
    return resposta(
      "Seleciona uma fotografia válida.",
      400
    );
  }

  const ficheiro = ficheiros[0];

  if (
    ficheiro.size === 0 ||
    ficheiro.size > TAMANHO_MAXIMO
  ) {
    return resposta(
      "A fotografia deve ter no máximo 10 MB.",
      413
    );
  }

  const tiposPermitidos = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
  ];

  if (!tiposPermitidos.includes(ficheiro.type)) {
    return resposta(
      "Formato não permitido. Utiliza JPEG, PNG, WebP ou AVIF.",
      415
    );
  }

  // 7. Confirmar o formato real pelos primeiros bytes.
  let conteudo: ArrayBuffer;

  try {
    conteudo = await ficheiro.arrayBuffer();
  } catch {
    return resposta(
      "Não foi possível processar a fotografia.",
      400
    );
  }

  const bytes = new Uint8Array(conteudo);
  const tipoReal = identificarImagem(bytes);

  if (
    !tipoReal ||
    tipoReal.mime !== ficheiro.type
  ) {
    return resposta(
      "O conteúdo do ficheiro não corresponde a uma imagem permitida.",
      415
    );
  }

  // 8. Gerar um nome único, sem utilizar o nome original.
  const identificador = crypto.randomUUID();

  const caminho =
    `inicio/${user.id}/${identificador}.${tipoReal.extensao}`;

  // 9. Enviar para o Supabase Storage.
  const {
    data: carregamento,
    error: erroCarregamento,
  } = await supabase.storage
    .from(BUCKET)
    .upload(
      caminho,
      conteudo,
      {
        contentType: tipoReal.mime,
        cacheControl: "3600",
        upsert: false,
      }
    );

  if (erroCarregamento || !carregamento) {
    console.error(
      "Erro ao carregar imagem da Página Inicial:",
      erroCarregamento?.message
    );

    return resposta(
      "Não foi possível guardar a fotografia no Supabase Storage.",
      500
    );
  }

  // 10. Obter o endereço público da fotografia.
  const {
    data: enderecoPublico,
  } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(carregamento.path);

  if (!enderecoPublico.publicUrl) {
    return resposta(
      "A fotografia foi carregada, mas não foi possível obter o endereço.",
      500
    );
  }

  return resposta(
    "Fotografia carregada com sucesso.",
    201,
    {
      url: enderecoPublico.publicUrl,
      caminho: carregamento.path,
      tipo: tipoReal.mime,
    }
  );
};