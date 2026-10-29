
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

// Converte uma data introduzida no formulário
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

  // Rejeitar datas impossíveis, como 31 de fevereiro,
  // e horas inexistentes na mudança para o horário
  // de verão.
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

export const POST: APIRoute = async (context) => {
  // Impedir pedidos enviados de outras origens.
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  // Confirmar que existe uma sessão autenticada.
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

  // Verificar a permissão individual Eventos → Criar.
  const {
    data: podeCriar,
    error: erroPermissaoCriar,
  } = await supabase.rpc("tem_permissao", {
    p_recurso: "eventos",
    p_acao: "criar",
  });

  if (erroPermissaoCriar || podeCriar !== true) {
    return new Response(
      "Não tens permissão para criar eventos.",
      { status: 403 }
    );
  }

  // Ler os dados enviados pelo formulário.
  let form: FormData;

  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(
      "/admin/eventos/novo?erro=campos",
      303
    );
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

  const publicado = form.get("publicado") === "true";

  // Criar e publicar são permissões diferentes.
  // Quem só pode criar deve guardar como rascunho.
  if (publicado) {
    const {
      data: podePublicar,
      error: erroPermissaoPublicar,
    } = await supabase.rpc("tem_permissao", {
      p_recurso: "eventos",
      p_acao: "publicar",
    });

    if (erroPermissaoPublicar || podePublicar !== true) {
      return new Response(
        "Não tens permissão para publicar eventos.",
        { status: 403 }
      );
    }
  }

  // Validar os campos obrigatórios e os limites.
  if (
    !titulo ||
    titulo.length > 200 ||
    !descricao ||
    local.length > 200
  ) {
    return context.redirect(
      "/admin/eventos/novo?erro=campos",
      303
    );
  }

  // Validar as datas segundo a hora de Portugal.
  const dataInicio = dataValida(inicioTexto);

  const dataFim = fimTexto
    ? dataValida(fimTexto)
    : null;

  if (
    !dataInicio ||
    (fimTexto && !dataFim) ||
    (dataFim && dataFim < dataInicio)
  ) {
    return context.redirect(
      "/admin/eventos/novo?erro=datas",
      303
    );
  }

  // Preparar o carregamento da imagem.
  const imagem = form.get("imagem");

  let imagemUrl: string | null = null;
  let caminhoImagem: string | null = null;

  if (imagem instanceof File && imagem.size > 0) {
    const extensao = TIPOS_PERMITIDOS[imagem.type];

    // Aceitar apenas JPG, PNG ou WebP até 5 MB.
    if (!extensao || imagem.size > MAX_IMAGEM) {
      return context.redirect(
        "/admin/eventos/novo?erro=imagem",
        303
      );
    }

    // Verificar a assinatura real do ficheiro,
    // em vez de confiar apenas no tipo MIME.
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

    const assinaturaValida =
      (extensao === "jpg" && ehJpeg) ||
      (extensao === "png" && ehPng) ||
      (extensao === "webp" && ehWebp);

    if (!assinaturaValida) {
      return context.redirect(
        "/admin/eventos/novo?erro=imagem",
        303
      );
    }

    // Criar um nome único para a imagem.
    const nomeFicheiro =
      `${crypto.randomUUID()}.${extensao}`;

    // Guardar na pasta do utilizador autenticado.
    caminhoImagem = `${user.id}/${nomeFicheiro}`;

    // Carregar a imagem no bucket eventos.
    const { error: erroUpload } = await supabase.storage
      .from("eventos")
      .upload(caminhoImagem, imagem, {
        contentType: imagem.type,
        upsert: false,
      });

    if (erroUpload) {
      console.error(
        "Erro ao carregar imagem do evento:",
        erroUpload.message
      );

      return context.redirect(
        "/admin/eventos/novo?erro=upload",
        303
      );
    }

    // Obter o endereço público da imagem.
    const { data: imagemPublica } = supabase.storage
      .from("eventos")
      .getPublicUrl(caminhoImagem);

    imagemUrl = imagemPublica.publicUrl;
  }

  // Guardar o evento na base de dados.
  // As datas são convertidas para UTC antes
  // de serem enviadas ao Supabase.
  const { error: erroEvento } = await supabase
    .from("eventos")
    .insert({
      titulo,
      descricao,
      data_inicio: dataInicio.toISOString(),
      data_fim: dataFim
        ? dataFim.toISOString()
        : null,
      local: local || null,
      imagem_url: imagemUrl,
      publicado,
    });

  if (erroEvento) {
    console.error(
      "Erro ao criar evento:",
      erroEvento.message
    );

    // Se o registo falhar depois do upload,
    // a imagem poderá ficar sem evento associado.
    if (caminhoImagem) {
      console.warn(
        "Imagem carregada sem evento associado:",
        caminhoImagem
      );
    }

    return context.redirect(
      "/admin/eventos/novo?erro=guardar",
      303
    );
  }

  // Regressar à lista de eventos.
  return context.redirect("/admin/eventos/", 303);
};
