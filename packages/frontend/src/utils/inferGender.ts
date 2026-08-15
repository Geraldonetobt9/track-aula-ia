// Common Brazilian female names (first names)
const FEMALE_NAMES = new Set([
  'maria', 'ana', 'juliana', 'fernanda', 'patricia', 'camila', 'amanda', 'bruna',
  'larissa', 'leticia', 'aline', 'jessica', 'vanessa', 'gabriela', 'mariana',
  'carolina', 'beatriz', 'rafaela', 'daniela', 'renata', 'tatiana', 'priscila',
  'natalia', 'adriana', 'alessandra', 'andrea', 'bianca', 'carla', 'claudia',
  'cristina', 'debora', 'denise', 'elaine', 'fabiana', 'flavia', 'helena',
  'isabela', 'joana', 'julia', 'karina', 'luana', 'lucia', 'luciana', 'luiza',
  'marta', 'michelle', 'monica', 'paula', 'raquel', 'roberta', 'rosa',
  'sandra', 'sara', 'simone', 'sonia', 'suzana', 'tais', 'tatiane', 'tereza',
  'valdirene', 'valeria', 'vera', 'viviane', 'yasmin', 'vitoria', 'isadora',
  'manuela', 'sofia', 'alice', 'laura', 'lara', 'cecilia', 'clara', 'livia',
  'lorena', 'milena', 'nicole', 'sabrina', 'stephanie', 'thalita', 'thais',
  'eliana', 'ivone', 'marlene', 'neide', 'regina', 'selma', 'sueli', 'silvana',
  'francisca', 'antonia', 'aparecida', 'conceicao', 'fatima', 'irene', 'iara',
  'janaina', 'josefa', 'madalena', 'marcia', 'margarete', 'nadia', 'paloma',
  'pietra', 'rebeca', 'samara', 'tamara', 'valentina', 'erica', 'katia',
  'lilian', 'miriam', 'rosane', 'roseli', 'solange', 'soraia', 'yara',
  'emily', 'emilly', 'heloisa', 'giovana', 'giovanna', 'raissa', 'thaisa',
]);

// Common Brazilian male names (first names)
const MALE_NAMES = new Set([
  'joao', 'jose', 'carlos', 'pedro', 'lucas', 'marcos', 'paulo', 'andre',
  'rafael', 'daniel', 'gabriel', 'gustavo', 'fernando', 'eduardo', 'rodrigo',
  'ricardo', 'marcelo', 'bruno', 'thiago', 'felipe', 'diego', 'fabio',
  'leonardo', 'leandro', 'alexandre', 'anderson', 'antonio', 'caio', 'cesar',
  'claudio', 'cristiano', 'david', 'davi', 'diogo', 'douglas', 'elias',
  'emerson', 'erick', 'everton', 'francisco', 'gilberto', 'guilherme',
  'henrique', 'hugo', 'igor', 'ivan', 'jackson', 'jefferson', 'julio',
  'jonas', 'jorge', 'luan', 'luis', 'luiz', 'marcio', 'mario', 'mateus',
  'matheus', 'mauricio', 'miguel', 'nelson', 'nicolas', 'otavio', 'patrick',
  'raul', 'renan', 'renato', 'roberto', 'rogerio', 'romulo', 'samuel',
  'sergio', 'tiago', 'vinicius', 'vitor', 'wagner', 'william', 'wilson',
  'alan', 'alberto', 'alex', 'alfredo', 'arthur', 'bernardo', 'breno',
  'enzo', 'ezequiel', 'fabricio', 'flavio', 'geovane', 'geraldo', 'heitor',
  'israel', 'jean', 'joaquim', 'kevin', 'kleber', 'levi', 'lorenzo',
  'murilo', 'natan', 'nathan', 'noel', 'oscar', 'raimundo', 'ramon',
  'robson', 'ronaldo', 'ruan', 'rubens', 'silvio', 'stefan', 'theo',
  'thomas', 'valdir', 'vicente', 'wanderley', 'wellington', 'yan',
]);

export type InferredGender = 'male' | 'female' | 'unknown';

export function inferGender(fullName: string | null | undefined): InferredGender {
  if (!fullName) return 'unknown';

  const firstName = fullName.trim().split(/\s+/)[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (FEMALE_NAMES.has(firstName)) return 'female';
  if (MALE_NAMES.has(firstName)) return 'male';

  // Heuristic: names ending in 'a' are often female in Portuguese
  if (firstName.endsWith('a') && firstName.length > 2) return 'female';
  // Names ending in 'o' are often male
  if (firstName.endsWith('o') && firstName.length > 2) return 'male';

  return 'unknown';
}
