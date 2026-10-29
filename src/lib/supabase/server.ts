
import {
  createServerClient,
  parseCookieHeader,
} from "@supabase/ssr";
import type { APIContext } from "astro";

export function criarSupabaseServer(context: APIContext) {
  return createServerClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(
            context.request.headers.get("cookie") ?? ""
          );
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            context.cookies.set(name, value, {
              ...options,
              path: options.path ?? "/",
            });
          }
        },
      },
    }
  );
}
