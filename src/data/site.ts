// Dados globais do sítio. Alterar aqui reflete-se em todas as páginas.

export const site = {
  nome: 'Escola Profissional do Fundão',
  sigla: 'EPF',
  entidade: 'Associação Promotora de Ensino Profissional da Cova da Beira',
  lema: 'Promovemos o jovem. Incrementamos competência. Geramos valor.',
  assinatura: 'Proximidade, Qualidade e Confiança',
  descricao:
    'Escola Profissional do Fundão: cursos profissionais e de educação e formação com dupla certificação, estágios em empresas e mobilidade Erasmus+ desde 1992.',
  fundacao: 1992,
  morada: ['Rua Cidade de Salamanca, n.º 1', '6230-370 Fundão', 'Portugal'],
  telefone: '+351 275 779 050',
  email: 'escola@epfundao.edu.pt',
  mapa: 'https://maps.google.com/maps?q=Rua+Cidade+de+Salamanca%2C+n%C2%BA+1%2C+Fund%C3%A3o+6230-370%2C+Portugal',
  livroReclamacoes: 'https://www.livroreclamacoes.pt/Inicio/',
  social: [{ nome: 'Facebook', url: 'https://www.facebook.com/EscolaProfissionalFundao' }],
  inscricoes: { abertas: true, anoLetivo: '2026/2027' },
};

// Atalhos para as plataformas usadas por alunos e docentes.
export const aplicacoes = [
  { nome: 'SINESep', url: 'https://app.ammsoftware.pt/' },
  { nome: 'Webmail', url: 'https://mail.google.com/a/epfundao.edu.pt' },
  { nome: 'Classroom', url: 'https://classroom.google.com/' },
];

export type ItemNav = { nome: string; url: string; nota?: string };
export type GrupoNav = { nome: string; url: string; itens?: ItemNav[] };

export const navegacao: GrupoNav[] = [
  {
    nome: 'A Escola',
    url: '/escola/',
    itens: [
      { nome: 'Sobre nós', url: '/escola/', nota: 'História, missão e valores' },
      { nome: 'Documentos institucionais', url: '/escola/documentos/', nota: 'Estatutos, regulamentos e projeto educativo' },
      { nome: 'Organização escolar', url: '/escola/documentos/#organizacao', nota: 'Calendário, plano de atividades, manuais' },
      { nome: 'Qualidade · EQAVET', url: '/qualidade/', nota: 'Selo, planos e relatórios' },
    ],
  },
  {
    nome: 'Oferta Formativa',
    url: '/oferta-formativa/',
    itens: [
      { nome: 'Cursos Profissionais', url: '/oferta-formativa/#profissionais', nota: 'Nível 4 · equivalência ao 12.º ano' },
      { nome: 'Cursos de Educação e Formação', url: '/oferta-formativa/#cef', nota: 'Nível 2 · conclusão do 9.º ano' },
      { nome: 'Inscrições', url: '/inscricoes/', nota: 'Pré-inscrição online' },
    ],
  },
  { nome: 'Notícias', url: '/noticias/' },
  { nome: 'Erasmus+', url: '/erasmus/' },
  {
    nome: 'Comunidade',
    url: '/comunidade/',
    itens: [
      { nome: 'Alumni', url: '/comunidade/#alumni', nota: 'Rede de antigos alunos' },
      { nome: 'Parceiros', url: '/comunidade/#parceiros', nota: 'Empresas e instituições' },
      { nome: 'Recrutamento', url: '/comunidade/#recrutamento', nota: 'Emprego e estágios' },
    ],
  },
  { nome: 'Contactos', url: '/contactos/' },
];

// Números do programa de mobilidade, tal como publicados pela escola.
export const erasmus = [
  { valor: '681', rotulo: 'Mobilidades' },
  { valor: '15 131', rotulo: 'Dias de estágio' },
  { valor: '281', rotulo: 'Parceiros' },
  { valor: '19', rotulo: 'Países de destino' },
];

// Apoios aos alunos, tal como divulgados nos cartazes dos cursos.
export const apoios = [
  { nome: 'Ensino gratuito', icone: 'capelo' },
  { nome: 'Transporte', icone: 'carro' },
  { nome: 'Materiais escolares', icone: 'documento' },
  { nome: 'Alimentação / refeição', icone: 'talheres' },
  { nome: 'Alojamento, com possibilidade de residência de estudantes', icone: 'edificio' },
  { nome: 'Seguro de acidentes pessoais', icone: 'selo' },
  { nome: 'Bolsa de profissionalização', icone: 'pasta' },
  { nome: 'Erasmus+', icone: 'globo' },
];
