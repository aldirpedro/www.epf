import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUCKET = "documentacao-privada";

function respostaErro(
  mensagem: string,
  estado: number
): Response {
  return new Response(mensagem, {
    status: estado,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? "";

  if (!UUID_REGEX.test(id)) {
    return respostaErro("Documento não encontrado.", 404);
  }

  const urlSupabase = import.meta.env.PUBLIC_SUPABASE_URL;
  const chavePublica =
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!urlSupabase || !chavePublica) {
    console.error(
      "Configuração pública do Supabase indisponível."
    );

    return respostaErro(
      "Serviço temporariamente indisponível.",
      503
    );
  }

  const supabase = createClient(
    urlSupabase,
    chavePublica,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const { data: documento, error: erroDocumento } =
    await supabase
      .from("documentacao")
      .select(
        "id, titulo, caminho_pdf, publicado, mostrar_no_website, permitir_abrir_pdf"
      )
      .eq("id", id)
      .eq("publicado", true)
      .eq("mostrar_no_website", true)
      .eq("permitir_abrir_pdf", true)
      .maybeSingle();

  if (erroDocumento) {
    console.error(
      "Erro ao consultar autorização do documento:",
      erroDocumento.message
    );

    return respostaErro(
      "Não foi possível consultar o documento.",
      500
    );
  }

  if (
    !documento ||
    !documento.publicado ||
    !documento.mostrar_no_website ||
    !documento.permitir_abrir_pdf ||
    !documento.caminho_pdf
  ) {
    return respostaErro("Documento não disponível.", 404);
  }

  /*
   * O documento já foi validado através das políticas
   * públicas de leitura da tabela documentacao.
   *
   * A chave privada é utilizada exclusivamente no servidor
   * para descarregar o PDF do bucket privado.
   *
   * Nunca é enviada ao navegador.
   */

  const chaveServidor =
    import.meta.env.SUPABASE_SECRET_KEY;

  if (!chaveServidor) {
    console.error(
      "SUPABASE_SECRET_KEY não configurada no servidor."
    );

    return respostaErro(
      "A consulta de PDFs ainda não está configurada.",
      503
    );
  }

  const supabaseServidor = createClient(
    urlSupabase,
    chaveServidor,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const { data: ficheiro, error: erroFicheiro } =
    await supabaseServidor.storage
      .from(BUCKET)
      .download(documento.caminho_pdf);

  if (erroFicheiro || !ficheiro) {
    console.error(
      "Erro ao obter PDF privado:",
      erroFicheiro?.message ??
        "Ficheiro não devolvido pelo Storage."
    );

    return respostaErro(
      "Não foi possível abrir o PDF.",
      404
    );
  }

  const conteudo = await ficheiro.arrayBuffer();

  const nomeSeguro =
    documento.titulo
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "documento";

  return new Response(conteudo, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        `inline; filename="${nomeSeguro}.pdf"`,
      "Content-Length": String(conteudo.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "no-referrer",
    },
  });
};