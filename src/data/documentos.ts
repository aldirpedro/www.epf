// Documentos públicos da escola.
// `url` aponta, por agora, para o sítio antigo; ao migrar um ficheiro,
// colocá-lo em public/documentos/ e trocar o url por "/documentos/<ficheiro>.pdf".

const antigo = 'http://www.epfundao.edu.pt:8069';

export type Documento = { titulo: string; url: string; nota?: string };

export const institucionais: Documento[] = [
  { titulo: 'Autorização de Funcionamento', url: `${antigo}/page/autorizacao-de-funcionamento` },
  { titulo: 'Estatutos', url: `${antigo}/page/estatutos` },
  { titulo: 'Regulamento Interno', url: `${antigo}/page/regulamento-interno` },
  { titulo: 'Projeto Educativo', url: `${antigo}/page/projecto-educativo` },
  { titulo: 'Política de Privacidade', url: `${antigo}/page/politica-de-privacidade` },
  { titulo: 'Código de Ética e Conduta', url: `${antigo}/page/codigo-de-etica-e-conduta` },
  { titulo: 'Autoavaliação', url: `${antigo}/page/auto-avaliacao` },
  { titulo: 'Regimento da EMAEI', url: `${antigo}/page/regimento-da-emaei` },
  { titulo: 'Guião de Educação Inclusiva', url: `${antigo}/page/guiao-educacao-inclusiva` },
  { titulo: 'Legislação de apoio', url: `${antigo}/page/legislacao-de-apoio` },
  { titulo: 'Fichas de Operação dos Cursos CEF e Profissionais', url: `${antigo}/page/fichas-de-operacao-dos-cursos-cef-e-profissionais` },
];

export const organizacaoEscolar: { anoLetivo: string; url: string; documentos: string[] } = {
  anoLetivo: '2025/2026',
  url: `${antigo}/page/organizacao-escolar`,
  documentos: [
    'Calendário Escolar',
    'Plano Anual de Atividades',
    'Critérios de Avaliação',
    'Plano de Cidadania e Desenvolvimento',
    'Projeto Mentorias',
    'Manuais Escolares Adotados',
  ],
};

export const eqavet: Documento[] = [
  { titulo: 'Selo de Conformidade EQAVET', url: `${antigo}/page/selo-de-conformidade-eqavet` },
  { titulo: 'Certificação EQAVET', url: `${antigo}/page/certificacao-2020-2023` },
  { titulo: 'Documento Base', url: `${antigo}/page/documento-base` },
  { titulo: 'Plano de Ação', url: `${antigo}/page/plano-de-acao` },
  { titulo: 'Plano de Ação Integrado', url: `${antigo}/page/plano-de-acao-integrado` },
  { titulo: 'Relatório do Operador', url: `${antigo}/page/relatorio-do-operador` },
  { titulo: 'Relatório de Verificação EQAVET', url: `${antigo}/page/relatorio-de-verificacao-eqavet` },
  { titulo: 'Relatórios de Acompanhamento', url: `${antigo}/page/relatorios-de-acompanhamento` },
  { titulo: 'Relatórios de Progresso Anual', url: `${antigo}/page/relatorio-de-progresso-anual` },
  { titulo: 'Manual de processos, procedimentos e gestão documental do SGQ', url: `${antigo}/page/manual-de-processos-procedimentos-e-gestao-documen` },
];
