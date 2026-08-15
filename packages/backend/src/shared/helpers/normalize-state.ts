const STATE_MAP: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
  'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  'para': 'PA', 'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE',
  'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
  // Com acentos
  'amapá': 'AP', 'ceará': 'CE', 'espírito santo': 'ES', 'goiás': 'GO',
  'maranhão': 'MA', 'paraná': 'PR', 'paraíba': 'PB', 'piauí': 'PI',
  'rondônia': 'RO', 'são paulo': 'SP',
};

const VALID_UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
]);

export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // Se já é uma UF válida de 2 letras
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && VALID_UFS.has(upper)) {
    return upper;
  }

  // Tentar mapear nome completo (sem acentos)
  const lower = trimmed.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const mapped = STATE_MAP[lower] || STATE_MAP[trimmed.toLowerCase()];
  if (mapped) return mapped;

  // Se tem 2 caracteres e são letras, aceitar como UF
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  return null;
}

export function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const trimmed = city.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
