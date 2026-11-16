
declare namespace App {
  interface Locals {
    perfilAdmin?: {
      id: string;
      nome: string;
      perfil: string;
      ativo: boolean;
    };
    permissoesMenu?: Record<string, boolean>;
  }
}
