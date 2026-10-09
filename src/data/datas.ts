const formato = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const mesAno = (data: Date) => {
  const texto = formato.format(data);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
