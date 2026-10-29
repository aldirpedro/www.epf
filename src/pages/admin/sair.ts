import type { APIRoute } from "astro";
import { criarSupabaseServer } from "../../lib/supabase/server";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const origem = context.request.headers.get("origin");

  if (origem !== context.url.origin) {
    return new Response("Origem não autorizada", { status: 403 });
  }

  const supabase = criarSupabaseServer(context);

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Erro ao terminar sessão:", error.message);
    return new Response("Não foi possível terminar a sessão.", {
      status: 500,
    });
  }

  return context.redirect("/admin/login", 303);
};