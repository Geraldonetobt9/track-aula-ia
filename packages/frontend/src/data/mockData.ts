// Types
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  plan: 'starter' | 'pro' | 'business';
  avatar?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'active' | 'paused';
  spend: number;
  sales: number;
  revenue: number;
  impressions: number;
  clicks: number;
  cpm: number;
  cpc: number;
  adSets: AdSet[];
}

export interface AdSet {
  id: string;
  name: string;
  status: 'active' | 'paused';
  spend: number;
  sales: number;
  revenue: number;
  impressions: number;
  clicks: number;
  ads: Ad[];
}

export interface Ad {
  id: string;
  name: string;
  status: 'active' | 'paused';
  spend: number;
  sales: number;
  revenue: number;
  impressions: number;
  clicks: number;
}

export interface Sale {
  id: string;
  date: string;
  product: string;
  value: number;
  checkout: 'Hotmart' | 'Kiwify' | 'Kirvano';
  campaign: string;
  adSet: string;
  ad: string;
  status: 'approved' | 'pending' | 'refunded';
  type: 'paid' | 'organic';
}

export interface DashboardMetrics {
  grossRevenue: number;
  netRevenue: number;
  adSpend: number;
  roi: number;
  roas: number;
  cpa: number;
  salesCount: number;
  grossRevenueChange: number;
  netRevenueChange: number;
  adSpendChange: number;
  roiChange: number;
  roasChange: number;
  cpaChange: number;
  salesCountChange: number;
}

export interface ChartData {
  date: string;
  revenue: number;
  spend: number;
}

export interface PieData {
  name: string;
  value: number;
  color: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  plan: 'starter' | 'pro' | 'business';
  status: 'active' | 'inactive';
  createdAt: string;
}

// Mock Data
export const mockUser: User = {
  id: '1',
  name: 'João Silva',
  email: 'joao@exemplo.com',
  role: 'admin',
  plan: 'pro',
  createdAt: '2024-01-15',
};

export const mockDashboardMetrics: DashboardMetrics = {
  grossRevenue: 47850.00,
  netRevenue: 42108.00,
  adSpend: 8450.00,
  roi: 398.5,
  roas: 4.98,
  cpa: 84.50,
  salesCount: 100,
  grossRevenueChange: 12.5,
  netRevenueChange: 15.2,
  adSpendChange: -5.3,
  roiChange: 23.1,
  roasChange: 18.7,
  cpaChange: -12.4,
  salesCountChange: 8.9,
};

export const mockChartData: ChartData[] = [
  { date: '01/01', revenue: 4500, spend: 800 },
  { date: '02/01', revenue: 5200, spend: 920 },
  { date: '03/01', revenue: 3800, spend: 750 },
  { date: '04/01', revenue: 6100, spend: 1100 },
  { date: '05/01', revenue: 5800, spend: 980 },
  { date: '06/01', revenue: 7200, spend: 1200 },
  { date: '07/01', revenue: 6500, spend: 1050 },
  { date: '08/01', revenue: 8100, spend: 1400 },
  { date: '09/01', revenue: 7800, spend: 1350 },
  { date: '10/01', revenue: 9200, spend: 1600 },
  { date: '11/01', revenue: 8500, spend: 1450 },
  { date: '12/01', revenue: 10200, spend: 1800 },
];

export const mockPieData: PieData[] = [
  { name: 'Facebook Ads', value: 65, color: 'hsl(210, 100%, 73%)' },
  { name: 'Orgânico', value: 20, color: 'hsl(160, 100%, 36%)' },
  { name: 'WhatsApp', value: 10, color: 'hsl(145, 63%, 49%)' },
  { name: 'Outros', value: 5, color: 'hsl(45, 100%, 51%)' },
];

export const mockCampaigns: Campaign[] = [
  {
    id: '1',
    name: 'Campanha - Curso de Tráfego Pago',
    status: 'active',
    spend: 2450.00,
    sales: 32,
    revenue: 15680.00,
    impressions: 125000,
    clicks: 3200,
    cpm: 19.60,
    cpc: 0.77,
    adSets: [
      {
        id: '1-1',
        name: 'Conjunto - Lookalike Compradores',
        status: 'active',
        spend: 1200.00,
        sales: 18,
        revenue: 8820.00,
        impressions: 62000,
        clicks: 1700,
        ads: [
          { id: '1-1-1', name: 'Criativo - VSL Principal', status: 'active', spend: 600, sales: 10, revenue: 4900, impressions: 31000, clicks: 900 },
          { id: '1-1-2', name: 'Criativo - Depoimento Maria', status: 'active', spend: 600, sales: 8, revenue: 3920, impressions: 31000, clicks: 800 },
        ],
      },
      {
        id: '1-2',
        name: 'Conjunto - Interesse Marketing Digital',
        status: 'active',
        spend: 1250.00,
        sales: 14,
        revenue: 6860.00,
        impressions: 63000,
        clicks: 1500,
        ads: [
          { id: '1-2-1', name: 'Criativo - Carrossel Benefícios', status: 'active', spend: 625, sales: 7, revenue: 3430, impressions: 31500, clicks: 750 },
          { id: '1-2-2', name: 'Criativo - Stories Urgência', status: 'paused', spend: 625, sales: 7, revenue: 3430, impressions: 31500, clicks: 750 },
        ],
      },
    ],
  },
  {
    id: '2',
    name: 'Remarketing - Mentoria Premium',
    status: 'active',
    spend: 1850.00,
    sales: 15,
    revenue: 22350.00,
    impressions: 45000,
    clicks: 2100,
    cpm: 41.11,
    cpc: 0.88,
    adSets: [
      {
        id: '2-1',
        name: 'Conjunto - Visitantes 7 dias',
        status: 'active',
        spend: 925.00,
        sales: 8,
        revenue: 11920.00,
        impressions: 22500,
        clicks: 1050,
        ads: [
          { id: '2-1-1', name: 'Criativo - Oferta Especial', status: 'active', spend: 925, sales: 8, revenue: 11920, impressions: 22500, clicks: 1050 },
        ],
      },
      {
        id: '2-2',
        name: 'Conjunto - Carrinho Abandonado',
        status: 'active',
        spend: 925.00,
        sales: 7,
        revenue: 10430.00,
        impressions: 22500,
        clicks: 1050,
        ads: [
          { id: '2-2-1', name: 'Criativo - Última Chance', status: 'active', spend: 925, sales: 7, revenue: 10430, impressions: 22500, clicks: 1050 },
        ],
      },
    ],
  },
  {
    id: '3',
    name: 'Prospecção - E-book Gratuito',
    status: 'active',
    spend: 980.00,
    sales: 8,
    revenue: 3920.00,
    impressions: 89000,
    clicks: 4500,
    cpm: 11.01,
    cpc: 0.22,
    adSets: [
      {
        id: '3-1',
        name: 'Conjunto - Público Frio',
        status: 'active',
        spend: 980.00,
        sales: 8,
        revenue: 3920.00,
        impressions: 89000,
        clicks: 4500,
        ads: [
          { id: '3-1-1', name: 'Criativo - Lead Magnet', status: 'active', spend: 980, sales: 8, revenue: 3920, impressions: 89000, clicks: 4500 },
        ],
      },
    ],
  },
  {
    id: '4',
    name: 'Black Friday - Pacote Completo',
    status: 'paused',
    spend: 3200.00,
    sales: 45,
    revenue: 35550.00,
    impressions: 180000,
    clicks: 8900,
    cpm: 17.78,
    cpc: 0.36,
    adSets: [
      {
        id: '4-1',
        name: 'Conjunto - Base Quente',
        status: 'paused',
        spend: 1600.00,
        sales: 25,
        revenue: 19750.00,
        impressions: 90000,
        clicks: 4500,
        ads: [
          { id: '4-1-1', name: 'Criativo - Contador Regressivo', status: 'paused', spend: 800, sales: 13, revenue: 10270, impressions: 45000, clicks: 2250 },
          { id: '4-1-2', name: 'Criativo - Comparativo Preço', status: 'paused', spend: 800, sales: 12, revenue: 9480, impressions: 45000, clicks: 2250 },
        ],
      },
      {
        id: '4-2',
        name: 'Conjunto - Novos Leads',
        status: 'paused',
        spend: 1600.00,
        sales: 20,
        revenue: 15800.00,
        impressions: 90000,
        clicks: 4400,
        ads: [
          { id: '4-2-1', name: 'Criativo - Bônus Exclusivo', status: 'paused', spend: 1600, sales: 20, revenue: 15800, impressions: 90000, clicks: 4400 },
        ],
      },
    ],
  },
  {
    id: '5',
    name: 'Campanha - Workshop Online',
    status: 'active',
    spend: 1450.00,
    sales: 22,
    revenue: 4378.00,
    impressions: 95000,
    clicks: 3800,
    cpm: 15.26,
    cpc: 0.38,
    adSets: [
      {
        id: '5-1',
        name: 'Conjunto - Iniciantes',
        status: 'active',
        spend: 725.00,
        sales: 12,
        revenue: 2388.00,
        impressions: 47500,
        clicks: 1900,
        ads: [
          { id: '5-1-1', name: 'Criativo - Chamada Workshop', status: 'active', spend: 725, sales: 12, revenue: 2388, impressions: 47500, clicks: 1900 },
        ],
      },
      {
        id: '5-2',
        name: 'Conjunto - Avançados',
        status: 'active',
        spend: 725.00,
        sales: 10,
        revenue: 1990.00,
        impressions: 47500,
        clicks: 1900,
        ads: [
          { id: '5-2-1', name: 'Criativo - Técnicas Avançadas', status: 'active', spend: 725, sales: 10, revenue: 1990, impressions: 47500, clicks: 1900 },
        ],
      },
    ],
  },
  {
    id: '6',
    name: 'Lançamento - Comunidade VIP',
    status: 'active',
    spend: 2100.00,
    sales: 18,
    revenue: 17820.00,
    impressions: 75000,
    clicks: 2800,
    cpm: 28.00,
    cpc: 0.75,
    adSets: [
      {
        id: '6-1',
        name: 'Conjunto - Lista de Espera',
        status: 'active',
        spend: 2100.00,
        sales: 18,
        revenue: 17820.00,
        impressions: 75000,
        clicks: 2800,
        ads: [
          { id: '6-1-1', name: 'Criativo - Exclusividade', status: 'active', spend: 1050, sales: 9, revenue: 8910, impressions: 37500, clicks: 1400 },
          { id: '6-1-2', name: 'Criativo - Depoimentos Membros', status: 'active', spend: 1050, sales: 9, revenue: 8910, impressions: 37500, clicks: 1400 },
        ],
      },
    ],
  },
  {
    id: '7',
    name: 'Evergreen - Curso Básico',
    status: 'active',
    spend: 890.00,
    sales: 28,
    revenue: 5572.00,
    impressions: 110000,
    clicks: 5200,
    cpm: 8.09,
    cpc: 0.17,
    adSets: [
      {
        id: '7-1',
        name: 'Conjunto - Interesse Empreendedorismo',
        status: 'active',
        spend: 890.00,
        sales: 28,
        revenue: 5572.00,
        impressions: 110000,
        clicks: 5200,
        ads: [
          { id: '7-1-1', name: 'Criativo - Transformação', status: 'active', spend: 445, sales: 14, revenue: 2786, impressions: 55000, clicks: 2600 },
          { id: '7-1-2', name: 'Criativo - Resultados Alunos', status: 'active', spend: 445, sales: 14, revenue: 2786, impressions: 55000, clicks: 2600 },
        ],
      },
    ],
  },
  {
    id: '8',
    name: 'Retargeting - Webinar',
    status: 'paused',
    spend: 650.00,
    sales: 5,
    revenue: 4925.00,
    impressions: 25000,
    clicks: 980,
    cpm: 26.00,
    cpc: 0.66,
    adSets: [
      {
        id: '8-1',
        name: 'Conjunto - Assistiram 50%',
        status: 'paused',
        spend: 650.00,
        sales: 5,
        revenue: 4925.00,
        impressions: 25000,
        clicks: 980,
        ads: [
          { id: '8-1-1', name: 'Criativo - Replay Disponível', status: 'paused', spend: 650, sales: 5, revenue: 4925, impressions: 25000, clicks: 980 },
        ],
      },
    ],
  },
  {
    id: '9',
    name: 'Campanha - Consultoria Individual',
    status: 'active',
    spend: 1780.00,
    sales: 4,
    revenue: 11960.00,
    impressions: 35000,
    clicks: 1200,
    cpm: 50.86,
    cpc: 1.48,
    adSets: [
      {
        id: '9-1',
        name: 'Conjunto - Empresários',
        status: 'active',
        spend: 1780.00,
        sales: 4,
        revenue: 11960.00,
        impressions: 35000,
        clicks: 1200,
        ads: [
          { id: '9-1-1', name: 'Criativo - Case de Sucesso', status: 'active', spend: 890, sales: 2, revenue: 5980, impressions: 17500, clicks: 600 },
          { id: '9-1-2', name: 'Criativo - Agenda Limitada', status: 'active', spend: 890, sales: 2, revenue: 5980, impressions: 17500, clicks: 600 },
        ],
      },
    ],
  },
  {
    id: '10',
    name: 'Teste A/B - Novo Produto',
    status: 'active',
    spend: 450.00,
    sales: 6,
    revenue: 1194.00,
    impressions: 42000,
    clicks: 1800,
    cpm: 10.71,
    cpc: 0.25,
    adSets: [
      {
        id: '10-1',
        name: 'Conjunto - Variante A',
        status: 'active',
        spend: 225.00,
        sales: 4,
        revenue: 796.00,
        impressions: 21000,
        clicks: 900,
        ads: [
          { id: '10-1-1', name: 'Criativo - Headline A', status: 'active', spend: 225, sales: 4, revenue: 796, impressions: 21000, clicks: 900 },
        ],
      },
      {
        id: '10-2',
        name: 'Conjunto - Variante B',
        status: 'active',
        spend: 225.00,
        sales: 2,
        revenue: 398.00,
        impressions: 21000,
        clicks: 900,
        ads: [
          { id: '10-2-1', name: 'Criativo - Headline B', status: 'active', spend: 225, sales: 2, revenue: 398, impressions: 21000, clicks: 900 },
        ],
      },
    ],
  },
];

export const mockSales: Sale[] = [
  { id: '1', date: '2024-01-15 14:32', product: 'Curso de Tráfego Pago', value: 497.00, checkout: 'Hotmart', campaign: 'Campanha - Curso de Tráfego Pago', adSet: 'Lookalike Compradores', ad: 'VSL Principal', status: 'approved', type: 'paid' },
  { id: '2', date: '2024-01-15 15:45', product: 'Mentoria Premium', value: 1490.00, checkout: 'Kiwify', campaign: 'Remarketing - Mentoria Premium', adSet: 'Visitantes 7 dias', ad: 'Oferta Especial', status: 'approved', type: 'paid' },
  { id: '3', date: '2024-01-15 16:20', product: 'E-book Gratuito', value: 47.00, checkout: 'Kirvano', campaign: 'Prospecção - E-book Gratuito', adSet: 'Público Frio', ad: 'Lead Magnet', status: 'pending', type: 'paid' },
  { id: '4', date: '2024-01-15 17:10', product: 'Workshop Online', value: 197.00, checkout: 'Hotmart', campaign: 'Campanha - Workshop Online', adSet: 'Iniciantes', ad: 'Chamada Workshop', status: 'approved', type: 'paid' },
  { id: '5', date: '2024-01-15 18:30', product: 'Comunidade VIP', value: 997.00, checkout: 'Kiwify', campaign: 'Lançamento - Comunidade VIP', adSet: 'Lista de Espera', ad: 'Exclusividade', status: 'approved', type: 'paid' },
  { id: '6', date: '2024-01-14 09:15', product: 'Curso Básico', value: 197.00, checkout: 'Hotmart', campaign: '-', adSet: '-', ad: '-', status: 'approved', type: 'organic' },
  { id: '7', date: '2024-01-14 10:45', product: 'Curso de Tráfego Pago', value: 497.00, checkout: 'Hotmart', campaign: 'Campanha - Curso de Tráfego Pago', adSet: 'Interesse Marketing Digital', ad: 'Carrossel Benefícios', status: 'approved', type: 'paid' },
  { id: '8', date: '2024-01-14 11:30', product: 'Mentoria Premium', value: 1490.00, checkout: 'Kiwify', campaign: 'Remarketing - Mentoria Premium', adSet: 'Carrinho Abandonado', ad: 'Última Chance', status: 'refunded', type: 'paid' },
  { id: '9', date: '2024-01-14 13:20', product: 'Consultoria Individual', value: 2990.00, checkout: 'Kirvano', campaign: 'Campanha - Consultoria Individual', adSet: 'Empresários', ad: 'Case de Sucesso', status: 'approved', type: 'paid' },
  { id: '10', date: '2024-01-14 14:55', product: 'Workshop Online', value: 197.00, checkout: 'Hotmart', campaign: '-', adSet: '-', ad: '-', status: 'approved', type: 'organic' },
  { id: '11', date: '2024-01-13 08:40', product: 'Novo Produto', value: 199.00, checkout: 'Kiwify', campaign: 'Teste A/B - Novo Produto', adSet: 'Variante A', ad: 'Headline A', status: 'approved', type: 'paid' },
  { id: '12', date: '2024-01-13 09:25', product: 'Curso de Tráfego Pago', value: 497.00, checkout: 'Hotmart', campaign: 'Campanha - Curso de Tráfego Pago', adSet: 'Lookalike Compradores', ad: 'Depoimento Maria', status: 'approved', type: 'paid' },
  { id: '13', date: '2024-01-13 11:10', product: 'Comunidade VIP', value: 997.00, checkout: 'Kiwify', campaign: 'Lançamento - Comunidade VIP', adSet: 'Lista de Espera', ad: 'Depoimentos Membros', status: 'pending', type: 'paid' },
  { id: '14', date: '2024-01-13 12:45', product: 'Curso Básico', value: 197.00, checkout: 'Hotmart', campaign: 'Evergreen - Curso Básico', adSet: 'Interesse Empreendedorismo', ad: 'Transformação', status: 'approved', type: 'paid' },
  { id: '15', date: '2024-01-13 15:30', product: 'E-book Gratuito', value: 47.00, checkout: 'Kirvano', campaign: '-', adSet: '-', ad: '-', status: 'approved', type: 'organic' },
  { id: '16', date: '2024-01-12 10:00', product: 'Mentoria Premium', value: 1490.00, checkout: 'Kiwify', campaign: 'Remarketing - Mentoria Premium', adSet: 'Visitantes 7 dias', ad: 'Oferta Especial', status: 'approved', type: 'paid' },
  { id: '17', date: '2024-01-12 11:35', product: 'Webinar', value: 997.00, checkout: 'Hotmart', campaign: 'Retargeting - Webinar', adSet: 'Assistiram 50%', ad: 'Replay Disponível', status: 'approved', type: 'paid' },
  { id: '18', date: '2024-01-12 14:20', product: 'Curso de Tráfego Pago', value: 497.00, checkout: 'Hotmart', campaign: 'Campanha - Curso de Tráfego Pago', adSet: 'Lookalike Compradores', ad: 'VSL Principal', status: 'approved', type: 'paid' },
  { id: '19', date: '2024-01-12 16:45', product: 'Workshop Online', value: 197.00, checkout: 'Hotmart', campaign: 'Campanha - Workshop Online', adSet: 'Avançados', ad: 'Técnicas Avançadas', status: 'approved', type: 'paid' },
  { id: '20', date: '2024-01-12 17:30', product: 'Curso Básico', value: 197.00, checkout: 'Hotmart', campaign: 'Evergreen - Curso Básico', adSet: 'Interesse Empreendedorismo', ad: 'Resultados Alunos', status: 'approved', type: 'paid' },
];

export const mockAdminUsers: AdminUser[] = [
  { id: '1', name: 'João Silva', email: 'joao@exemplo.com', plan: 'pro', status: 'active', createdAt: '2024-01-15' },
  { id: '2', name: 'Maria Santos', email: 'maria@exemplo.com', plan: 'business', status: 'active', createdAt: '2024-01-10' },
  { id: '3', name: 'Pedro Oliveira', email: 'pedro@exemplo.com', plan: 'starter', status: 'active', createdAt: '2024-01-08' },
  { id: '4', name: 'Ana Costa', email: 'ana@exemplo.com', plan: 'pro', status: 'inactive', createdAt: '2024-01-05' },
  { id: '5', name: 'Carlos Ferreira', email: 'carlos@exemplo.com', plan: 'starter', status: 'active', createdAt: '2024-01-03' },
  { id: '6', name: 'Lucia Rodrigues', email: 'lucia@exemplo.com', plan: 'business', status: 'active', createdAt: '2024-01-01' },
  { id: '7', name: 'Fernando Lima', email: 'fernando@exemplo.com', plan: 'pro', status: 'active', createdAt: '2023-12-28' },
  { id: '8', name: 'Beatriz Almeida', email: 'beatriz@exemplo.com', plan: 'starter', status: 'inactive', createdAt: '2023-12-25' },
];

export const mockAdminMetrics = {
  totalUsers: 248,
  activeUsers: 187,
  mrr: 12450.00,
  churnRate: 2.4,
  totalUsersChange: 15.2,
  activeUsersChange: 12.8,
  mrrChange: 18.5,
  churnRateChange: -0.8,
};

export const mockUserGrowth = [
  { month: 'Jul', users: 45 },
  { month: 'Ago', users: 68 },
  { month: 'Set', users: 92 },
  { month: 'Out', users: 125 },
  { month: 'Nov', users: 178 },
  { month: 'Dez', users: 248 },
];

export const mockRevenueGrowth = [
  { month: 'Jul', revenue: 3200 },
  { month: 'Ago', revenue: 4850 },
  { month: 'Set', revenue: 6400 },
  { month: 'Out', revenue: 8200 },
  { month: 'Nov', revenue: 10100 },
  { month: 'Dez', revenue: 12450 },
];
