
import type { APIRoute } from "astro";
import { TZDate } from "@date-fns/tz";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const MAX_IMAGEM = 5 * 1024 * 1024;

const TIPOS_PERMITIDOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Converter uma data introduzida no formulário
// segundo o fuso horário de Portugal continental.
function dataValida(valor: string): Date | null {
  const correspondencia =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor);

  if (!correspondencia) {
    return null;
  }

  const [
    ,
    anoTexto,
    mesTexto,
    diaTexto,
    horaTexto,
    minutoTexto,
  ] = correspondencia;

  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);
  const hora = Number(horaTexto);
  const minuto = Number(minutoTexto);

  if (
    ano < 2000 ||
    ano > 2100 ||
    mes < 1 ||
    mes > 12 ||
    dia < 1 ||
    dia > 31 ||
    hora > 23 ||
    minuto > 59
  ) {
    return null;
  }

  const data = new TZDate(
    ano,
    mes - 1,
    dia,
    hora,
    minuto,
    0,
    0,
    "Europe/Lisbon"
  );

  if (
    data.getFullYear() !== ano ||
    data.getMonth() + 1 !== mes ||
    data.getDate() !== dia ||
    data.getHours() !== hora ||
    data.getMinutes() !== minuto
  ) {
    return null;
  }

  return data;
}

// Confirmar que o conteúdo do ficheiro corresponde
// ao formato de imagem declarado.
async function imagemValida(imagem: File): Promise<boolean> {
  const extensao = TIPOS_PERMITIDOS[imagem.type];

  if (!extensao || imagem.size > MAX_IMAGEM) {
    return false;
  }

  const cabecalho = new Uint8Array(
    await imagem.slice(0, 12).arrayBuffer()
  );

  const ehJpeg =
    cabecalho[0] === 0xff &&
    cabecalho[1] === 0xd8 &&
    cabecalho[2] === 0xff;

  const ehPng =
    cabecalho[0] === 0x89 &&
    cabecalho[1] === 0x50 &&
    cabecalho[2] === 0x4e &&
    cabecalho[3] === 0x47 &&
    cabecalho[4] === 0x0d &&
    cabecalho[5] === 0x0a &&
    cabecalho[6] === 0x1a &&
    cabecalho[7] === 0x0a;

  const ehWebp =
    String.fromCharCode(
      ...cabecalho.slice(0, 4)
    ) === "RIFF" &&
    String.fromCharCode(
      ...cabecalho.slice(8, 12)
    ) === "WEBP";

  return (
    (extensao === "jpg" && ehJpeg) ||
    (extensao === "png" && ehPng) ||
    (extensao === "webp" && ehWebp)
  );
}

export const POST: APIRoute = async (context) => {
  // Rejeitar pedidos enviados de outras origens.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar a sessão.
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
    return new Response("Conta sem acesso autorizado", {
      status: 403,
    });
  }

  // Verificar a permissão Eventos → Editar.
  const {
    data: podeEditar,
    error: erroPermissaoEditar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "eventos",
    p_acao: "editar",
  });

  if (erroPermissaoEditar || podeEditar !== true) {
    return new Response(
      "Não tens permissão para editar eventos.",
      { status: 403 }
    );
  }

  // Ler o formulário.
  let form: FormData;

  try {
    form = await context.request.formData();
  } catch {
    return context.redirect("/admin/eventos/", 303);
  }

  const id = String(form.get("id") ?? "").trim();

  if (!UUID_REGEX.test(id)) {
    return new Response("Identificador inválido", {
      status: 400,
    });
  }

  const voltarEdicao =
    `/admin/eventos/editar/${id}`;

  const voltarComErro = (tipo: string) =>
    context.redirect(
      `${voltarEdicao}?erro=${encodeURIComponent(tipo)}`,
      303
    );

  // Carregar o estado atual do evento.
  const {
    data: eventoAtual,
    error: erroEventoAtual,
  } = await supabase
    .from("eventos")
    .select("id, imagem_url, publicado")
    .eq("id", id)
    .single();

  if (erroEventoAtual || !eventoAtual) {
    return new Response("Evento não encontrado", {
      status: 404,
    });
  }

  const titulo = String(form.get("titulo") ?? "").trim();

  const descricao = String(
    form.get("descricao") ?? ""
  ).trim();

  const inicioTexto = String(
    form.get("data_inicio") ?? ""
  ).trim();

  const fimTexto = String(
    form.get("data_fim") ?? ""
  ).trim();

  const local = String(form.get("local") ?? "").trim();

  // Quem não pode publicar deve manter o estado atual.
  const {
    data: podePublicar,
    error: erroPermissaoPublicar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "eventos",
    p_acao: "publicar",
  });

  if (erroPermissaoPublicar) {
    return new Response(
      "Não foi possível verificar a permissão de publicação.",
      { status: 500 }
    );
  }

  const publicado =
    podePublicar === true
      ? form.get("publicado") === "true"
      : eventoAtual.publicado;

  // Validar os campos.
  if (
    !titulo ||
    titulo.length > 200 ||
    !descricao ||
    local.length > 200
  ) {
    return voltarComErro("campos");
  }

  const dataInicio = dataValida(inicioTexto);

  const dataFim = fimTexto
    ? dataValida(fimTexto)
    : null;

  if (
    !dataInicio ||
    (fimTexto && !dataFim) ||
    (dataFim && dataFim < dataInicio)
  ) {
    return voltarComErro("datas");
  }

  // Manter a imagem atual, salvo se for enviada outra.
  let imagemUrl: string | null = eventoAtual.imagem_url;

  let caminhoImagemNova: string | null = null;

  const imagem = form.get("imagem");

  if (imagem instanceof File && imagem.size > 0) {
    if (!(await imagemValida(imagem))) {
      return voltarComErro("imagem");
    }

    const extensao = TIPOS_PERMITIDOS[imagem.type];

    const nomeFicheiro =
      `${crypto.randomUUID()}.${extensao}`;

    caminhoImagemNova = `${user.id}/${nomeFicheiro}`;

    // Carregar a nova imagem sem apagar a anterior.
    const { error: erroUpload } = await supabase.storage
      .from("eventos")
      .upload(caminhoImagemNova, imagem, {
        contentType: imagem.type,
        upsert: false,
      });

    if (erroUpload) {
      console.error(
        "Erro ao carregar imagem do evento:",
        erroUpload.message
      );

      return voltarComErro("upload");
    }

    const { data: imagemPublica } = supabase.storage
      .from("eventos")
      .getPublicUrl(caminhoImagemNova);

    imagemUrl = imagemPublica.publicUrl;
  }

  // Atualizar o evento no Supabase.
  const { data: eventoAtualizado, error: erroAtualizacao } =
    await supabase
      .from("eventos")
      .update({
        titulo,
        descricao,
        data_inicio: dataInicio.toISOString(),
        data_fim: dataFim
          ? dataFim.toISOString()
          : null,
        local: local || null,
        imagem_url: imagemUrl,
        publicado,
      })
      .eq("id", id)
      .select("id")
      .single();

  if (erroAtualizacao || !eventoAtualizado) {
    console.error(
      "Erro ao atualizar evento:",
      erroAtualizacao?.message ??
        "A atualização não devolveu nenhum registo."
    );

    // Se o registo não foi atualizado, tentar remover
    // a nova imagem que ficou sem utilização.
    if (caminhoImagemNova) {
      const { error: erroLimpeza } =
        await supabase.storage
          .from("eventos")
          .remove([caminhoImagemNova]);

      if (erroLimpeza) {
        console.warn(
          "Não foi possível limpar a imagem:",
          erroLimpeza.message
        );
      }
    }

    return voltarComErro("guardar");
  }

  // Não apagamos automaticamente a imagem antiga:
  // isso evita perder ficheiros caso haja algum erro
  // ou a política de Storage não permita a remoção.

  return context.redirect("/admin/eventos/", 303);
};
