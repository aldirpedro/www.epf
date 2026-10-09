// Envio dos formulários marcados com [data-formulario].
// Com PUBLIC_FORMS_ENDPOINT definido, envia JSON por POST; caso contrário,
// abre o programa de email do visitante com a mensagem já preenchida.

const endpoint = import.meta.env.PUBLIC_FORMS_ENDPOINT as string | undefined;

document.querySelectorAll<HTMLFormElement>('form[data-formulario]').forEach((form) => {
  const estado = form.querySelector<HTMLElement>('[role="status"]');
  const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const campos = [...new FormData(form).entries()].filter(([, v]) => typeof v === 'string' && v !== '') as [string, string][];
    const assunto = form.dataset.assunto ?? 'Contacto pelo sítio';

    if (!endpoint) {
      const rotulo = (nome: string) => {
        const campo = form.elements.namedItem(nome) as HTMLInputElement | null;
        return campo?.labels?.[0]?.textContent?.replace('*', '').trim() ?? nome;
      };
      const corpo = campos.filter(([k]) => k !== 'consentimento').map(([k, v]) => `${rotulo(k)}: ${v}`).join('\n');
      window.location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
      if (estado) estado.textContent = 'Abrimos o teu programa de email com a mensagem preenchida. Basta enviar.';
      return;
    }

    botao?.setAttribute('disabled', '');
    try {
      const resposta = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formulario: form.dataset.formulario, assunto, ...Object.fromEntries(campos) }),
      });
      if (!resposta.ok) throw new Error(String(resposta.status));
      form.reset();
      if (estado) estado.textContent = 'Recebemos a tua mensagem. Entraremos em contacto em breve.';
    } catch {
      if (estado) estado.textContent = `Não foi possível enviar. Tenta novamente ou escreve para ${form.dataset.email}.`;
    } finally {
      botao?.removeAttribute('disabled');
    }
  });
});
