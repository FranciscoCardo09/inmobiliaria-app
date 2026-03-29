// Convert number to text (Spanish)
export const numeroATexto = (numero) => {
  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const especiales = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  if (numero === 0) return 'CERO';
  if (numero === 100) return 'CIEN';

  const convertirGrupo = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';

    let resultado = '';
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const d = Math.floor(resto / 10);
    const u = resto % 10;

    if (c > 0) resultado += centenas[c] + ' ';

    if (resto >= 10 && resto <= 19) {
      resultado += especiales[resto - 10];
    } else if (resto === 20) {
      resultado += 'VEINTE';
    } else if (resto > 20 && resto < 30) {
      resultado += 'VEINTI' + unidades[u];
    } else {
      if (d > 0) resultado += decenas[d];
      if (d > 0 && u > 0) resultado += ' Y ';
      if (u > 0) resultado += unidades[u];
    }

    return resultado.trim();
  };

  const parteEntera = Math.floor(numero);
  const parteDecimal = Math.round((numero - parteEntera) * 100);

  let texto = '';

  if (parteEntera >= 1000000) {
    const millones = Math.floor(parteEntera / 1000000);
    if (millones === 1) {
      texto += 'UN MILLON ';
    } else {
      texto += convertirGrupo(millones) + ' MILLONES ';
    }
  }

  const restoMillones = parteEntera % 1000000;
  if (restoMillones >= 1000) {
    const miles = Math.floor(restoMillones / 1000);
    if (miles === 1) {
      texto += 'MIL ';
    } else {
      texto += convertirGrupo(miles) + ' MIL ';
    }
  }

  const restoMiles = restoMillones % 1000;
  if (restoMiles > 0) {
    texto += convertirGrupo(restoMiles);
  }

  texto = texto.trim();
  if (texto === '') texto = 'CERO';

  if (parteDecimal > 0) {
    texto += ' CON ' + convertirGrupo(parteDecimal);
  }

  return texto + ' PESOS';
};
