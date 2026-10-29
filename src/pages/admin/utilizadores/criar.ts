
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { criarSupabaseServer } from "../../../lib/supabase/server";

export const prerender = false;

const CARGOS_PERMITIDOS = new Set([
  "coordenador",
  "audiovisuais",
  "secretaria",
]);

function voltarComErro(codigo: string): Response {
  return Response.redirect(
    `/admin/utilizadores/novo?erro=${encodeURIComponent(codigo)}`,
    303
  );
}

export const POST: APIRoute = async (context) => {
  const { request, url } = context;

  // Impede pedidos enviados a partir de outras origens.
  const origem = request.headers.get("origin");

  if (origem !== url.origin) {
    return new Response("Origem não autorizada.", {
      status: 403,
    });
  }

  const supabase = criarSupabaseServer(context);

  const {
    data: { user },
    error: erroAutenticacao,
  } = await supabase.auth.getUser();

  if (erroAutenticacao || !user) {
    return context.redirect("/admin/login", 303);
  }

  // Não confiar apenas na interface ou no middleware.
  // Confirmar o cargo diretamente na base de dados.
  const { data: administrador, error: erroAdministrador } =
    await supabase
      .from("perfis")
      .select("id, perfil, ativo")
      .eq("id", user.id)
      .single();

  if (
    erroAdministrador ||
    !administrador?.ativo ||
    administrador.perfil !== "super_admin"
  ) {
    return new Response("Acesso não autorizado.", {
      status: 403,
    });
  }

  let formulario: FormData;

  try {
    formulario = await request.formData();
  } catch {
    return voltarComErro("dados");
  }

  const nome = String(formulario.get("nome") || "").trim();

  const email = String(formulario.get("email") || "")
    .trim()
    .toLowerCase();

  const perfil = String(formulario.get("perfil") || "").trim();

  const password = String(formulario.get("password") || "");

  const confirmarPassword = String(
    formulario.get("confirmar_password") || ""
  );

  if (
    nome.length < 2 ||
    nome.length > 120 ||
    email.length > 254 ||
    !CARGOS_PERMITIDOS.has(perfil)
  ) {
    return voltarComErro("dados");
  }

  const emailValido =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!emailValido) {
    return voltarComErro("email");
  }

  if (
    password.length < 12 ||
    password.length > 128 ||
    password !== confirmarPassword
  ) {
    return voltarComErro("password");
  }

  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;

  const secretKey = import.meta.env.SUPABASE_SECRET_KEY;


  if (!supabaseUrl || !secretKey) {
    console.error(
      "Faltam PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY."
    );

    return new Response(
      "Configuração do servidor incompleta.",
      { status: 500 }
    );
  }

  // Este cliente administrativo existe apenas no servidor.
  // Nunca enviar a chave secreta para o navegador.
  const supabaseAdmin = createClient(
    supabaseUrl,
    secretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  // Cria a conta sem iniciar sessão como o novo utilizador.
  const { data: conta, error: erroCriacao } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (erroCriacao || !conta.user) {
    console.error(
      "Erro ao criar utilizador:",
      erroCriacao?.message
    );

    if (
      erroCriacao?.message
        .toLowerCase()
        .includes("already")
    ) {
      return voltarComErro("duplicado");
    }

    return voltarComErro("criar");
  }

  const novoId = conta.user.id;

  // Associa o utilizador do Auth ao perfil da escola.
  const { error: erroPerfil } = await supabaseAdmin
    .from("perfis")
    .upsert(
      {
        id: novoId,
        nome,
        perfil,
        ativo: true,
      },
      { onConflict: "id" }
    );

  if (erroPerfil) {
    console.error(
      "Erro ao criar perfil:",
      erroPerfil.message
    );

    // Evita deixar uma conta Auth sem perfil administrativo.
    const { error: erroLimpeza } =
      await supabaseAdmin.auth.admin.deleteUser(novoId);

    if (erroLimpeza) {
      console.error(
        "Falha ao reverter a criação da conta:",
        erroLimpeza.message
      );

      return voltarComErro("perfil");
    }

    return voltarComErro("criar");
  }

  return context.redirect(
    `/admin/utilizadores/editar/${novoId}`,
    303
  );
};
