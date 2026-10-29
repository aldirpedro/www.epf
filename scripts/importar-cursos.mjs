
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import matter from "gray-matter";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const executar = process.argv.includes("--executar");

const url = process.env.PUBLIC_SUPABASE_URL;
const chave = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !chave) {
  console.error("Faltam as configurações do Supabase no .env.");
  process.exit(1);
}

const pastaCursos = path.resolve("src/content/cursos");

const ficheiros = fs
  .readdirSync(pastaCursos)
  .filter((ficheiro) => ficheiro.endsWith(".md"))
  .filter((ficheiro) => ficheiro !== "tecnico-audiovisuais.md")
  .sort();

const supabase = createClient(url, chave, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function lerCursos() {
  return ficheiros.map((ficheiro) => {
    const caminho = path.join(pastaCursos, ficheiro);
    const { data, content } = matter(
      fs.readFileSync(caminho, "utf8")
    );

    const slug = path.basename(ficheiro, ".md");

    const cartazes = (data.cartazes ?? []).map((cartaz) => {
      const caminhoImagem = path.resolve(
        path.dirname(caminho),
        cartaz
      );

      if (!fs.existsSync(caminhoImagem)) {
        throw new Error(`Cartaz não encontrado: ${caminhoImagem}`);
      }

      return caminhoImagem;
    });

    const componentes = (data.componentes ?? []).map(
      (componente) => ({
        nome: componente.nome,
        disciplinas: componente.disciplinas ?? [],
      })
    );

    return {
      slug,
      dados: {
        slug,
        titulo: data.titulo,
        sigla: data.sigla ?? null,
        tipo: data.tipo,
        nivel: data.nivel,
        duracao: data.duracao,
        certificacao: data.certificacao,
        acesso: data.acesso,
        area: data.area,
        icone: data.icone ?? "livro",
        ordem: data.ordem ?? 0,
        perfil: data.perfil ?? "",
        conteudo: content.trim(),
        componentes,
        publicado: true,
      },
      cartazes,
    };
  });
}

async function iniciar() {
  const cursos = lerCursos();

  console.log("\nMIGRAÇÃO DOS CURSOS DA EPF");
  console.log(`Cursos preparados: ${cursos.length}`);
  console.log("Audiovisuais: excluído da migração\n");

  for (const curso of cursos) {
    console.log(
      `${curso.dados.titulo} — ${curso.cartazes.length} cartaz(es)`
    );
  }

  if (!executar) {
    console.log("\nMODO DE PRÉ-VISUALIZAÇÃO");
    console.log("Nenhum dado foi alterado.");
    console.log(
      "Para importar será necessária uma sessão autorizada de coordenador."
    );
    return;
  }

  // A chave pública não dá permissões de coordenador.
  // Não tentamos contornar as políticas de segurança.
  console.error(
    "\nImportação bloqueada: falta autenticar um coordenador."
  );
  console.error(
    "Não foi criado ou alterado nenhum curso."
  );
  process.exitCode = 1;
}

iniciar().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exitCode = 1;
});
