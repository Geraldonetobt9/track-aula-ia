/**
 * Mapeamento completo DDD -> UF (Brasil)
 * Fonte: Anatel -- Plano de Numeracao
 */
const DDD_TO_STATE: Record<string, string> = {
  // Sao Paulo
  '11': 'SP', '12': 'SP', '13': 'SP', '14': 'SP', '15': 'SP',
  '16': 'SP', '17': 'SP', '18': 'SP', '19': 'SP',
  // Rio de Janeiro
  '21': 'RJ', '22': 'RJ', '24': 'RJ',
  // Espirito Santo
  '27': 'ES', '28': 'ES',
  // Minas Gerais
  '31': 'MG', '32': 'MG', '33': 'MG', '34': 'MG', '35': 'MG',
  '37': 'MG', '38': 'MG',
  // Parana
  '41': 'PR', '42': 'PR', '43': 'PR', '44': 'PR', '45': 'PR', '46': 'PR',
  // Santa Catarina
  '47': 'SC', '48': 'SC', '49': 'SC',
  // Rio Grande do Sul
  '51': 'RS', '53': 'RS', '54': 'RS', '55': 'RS',
  // Distrito Federal
  '61': 'DF',
  // Goias
  '62': 'GO', '64': 'GO',
  // Tocantins
  '63': 'TO',
  // Mato Grosso do Sul
  '67': 'MS',
  // Mato Grosso
  '65': 'MT', '66': 'MT',
  // Acre
  '68': 'AC',
  // Rondonia
  '69': 'RO',
  // Bahia
  '71': 'BA', '73': 'BA', '74': 'BA', '75': 'BA', '77': 'BA',
  // Sergipe
  '79': 'SE',
  // Pernambuco
  '81': 'PE', '87': 'PE',
  // Alagoas
  '82': 'AL',
  // Paraiba
  '83': 'PB',
  // Rio Grande do Norte
  '84': 'RN',
  // Ceara
  '85': 'CE', '88': 'CE',
  // Piaui
  '86': 'PI', '89': 'PI',
  // Maranhao
  '98': 'MA', '99': 'MA',
  // Para
  '91': 'PA', '93': 'PA', '94': 'PA',
  // Amazonas
  '92': 'AM', '97': 'AM',
  // Roraima
  '95': 'RR',
  // Amapa
  '96': 'AP',
};

/**
 * Extrai o DDD de um telefone e retorna o estado (UF).
 *
 * Aceita formatos:
 * - "11999998888"        -> DDD 11 -> SP
 * - "5511999998888"      -> Remove DDI 55, DDD 11 -> SP
 * - "+5511999998888"     -> Remove +55, DDD 11 -> SP
 * - "(11) 99999-8888"    -> DDD 11 -> SP
 *
 * Retorna a UF (ex: "SP") ou null se nao encontrar.
 */
export function getStateFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');

  if (digits.length < 10) return null;

  let ddd: string;

  if (digits.length >= 12 && digits.startsWith('55')) {
    ddd = digits.substring(2, 4);
  } else if (digits.length === 10 || digits.length === 11) {
    ddd = digits.substring(0, 2);
  } else {
    ddd = digits.substring(0, 2);
  }

  return DDD_TO_STATE[ddd] || null;
}

/**
 * Extrai o estado a partir do DDD ja separado (ex: Ticto phone.ddd, PerfectPay phone_area_code).
 */
export function getStateFromDDD(ddd: string | null | undefined): string | null {
  if (!ddd) return null;
  const cleaned = ddd.replace(/\D/g, '');
  return DDD_TO_STATE[cleaned] || null;
}
