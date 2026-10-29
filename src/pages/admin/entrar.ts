import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../lib/supabase/server";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", { status: 403 });
  }

  const form = await context.request.formData();

  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!email || !password) {
    return context.redirect("/admin/login?erro=credenciais", 303);
  }

  const supabase = criarSupabaseServer(context);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
  console.error("Erro de autenticação Supabase:", {
    mensagem: error?.message,
    codigo: error?.code,
    estado: error?.status,
  });

  return context.redirect("/admin/login?erro=credenciais", 303);
}

  const { data: perfil, error: erroPerfil } = await supabase
    .from("perfis")
    .select("id, nome, perfil, ativo")
    .eq("id", data.user.id)
    .single();

  if (erroPerfil || !perfil?.ativo) {
    await supabase.auth.signOut();
    return context.redirect("/admin/login?erro=acesso", 303);
  }

  return context.redirect("/admin", 303);
};