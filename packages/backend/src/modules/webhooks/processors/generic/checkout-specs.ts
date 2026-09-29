/**
 * Onde cada campo mora no webhook das plataformas que não têm processor
 * próprio. Um processor genérico (GenericCheckoutProcessor) lê a venda por
 * esta tabela.
 *
 * DE ONDE VEM CADA CAMINHO
 *   Os marcados "container" saíram dos containers do sGTM em uso (pasta
 *   Containers/): são os caminhos que as tags do Facebook já leem hoje em
 *   produção. Os demais — UTMs e status, que os containers não usavam — são
 *   suposição a partir do formato do payload, e são sempre opcionais: sem
 *   eles a venda é gravada do mesmo jeito, só sem UTM ou sem o filtro.
 *
 *   Cada campo é uma lista de caminhos: vale o primeiro que existir. Pontos
 *   separam chaves; números são índices de lista (items.0.name).
 *
 * VALOR
 *   `cents: true` onde o container convertia centavos com o regex
 *   (\d+)(\d{2})$ → $1.$2. Algumas plataformas só tinham a comissão
 *   mapeada (Kavoo, Doppus, Wiven): ali a comissão é o valor gravado, com ou
 *   sem a opção "usar comissão" da integração.
 *
 * STATUS
 *   Onde o container filtrava por evento (TRANSACTION_PAID, order.paid...),
 *   o mesmo evento aprova. Onde o container disparava em qualquer webhook
 *   (Herospark, Kavoo, Wiapy, Doppus — gatilho "_event EQUALS Data"), a venda
 *   é aprovada a menos que um campo de status diga outra coisa. É o mesmo
 *   comportamento do container, com uma trava a mais.
 */

export interface MoneyPath {
  paths: string[];
  cents: boolean;
}

export interface CheckoutSpec {
  platform: string;
  label: string;

  /** Nome do evento no corpo. O Data Client do sGTM lia `event`/`event_name`. */
  eventPaths: string[];
  /** Eventos que aprovam. Vazio: decide pelo status. */
  approvedEvents: string[];
  /** Eventos que reembolsam. */
  refundEvents: string[];
  /** Campos de status, para quando o evento não decide. */
  statusPaths: string[];
  /**
   * Sem evento nem status reconhecível: aprova (o container disparava o
   * Purchase em todo webhook dessas plataformas).
   */
  approveWithoutStatus: boolean;

  externalId: string[];
  email: string[];
  phone: string[];
  name: string[];
  firstName?: string[];
  lastName?: string[];
  doc?: string[];
  city?: string[];
  state?: string[];
  zip?: string[];
  country?: string[];

  amount?: MoneyPath;
  commission?: MoneyPath;
  currency?: string[];
  productName: string[];
  productId: string[];
  paymentMethod?: string[];
  soldAt?: string[];

  utm: {
    source: string[];
    medium: string[];
    campaign: string[];
    content: string[];
    term: string[];
  };
  /** Parâmetro que leva o indexador do rastreio (sck, src, xcod, utm_term). */
  indexer: string[];
  /** Formato xcod da Hotmart (UTMs separadas por |). */
  xcodPath?: string;
}

/** UTMs sob um mesmo prefixo, nos dois formatos comuns (utm_source e source). */
function utmUnder(...prefixes: string[]): CheckoutSpec['utm'] {
  const build = (key: string) =>
    prefixes.flatMap((p) => [`${p}.utm_${key}`, `${p}.${key}`]);
  return {
    source: build('source'),
    medium: build('medium'),
    campaign: build('campaign'),
    content: build('content'),
    term: build('term'),
  };
}

const COMMON_STATUS = ['status', 'payment_status', 'transaction.status', 'payment.status', 'data.status', 'sale.status', 'order.status'];

export const CHECKOUT_SPECS: Record<string, CheckoutSpec> = {
  wiven: {
    platform: 'wiven',
    label: 'Wiven',
    eventPaths: ['event', 'event_name', 'type'],
    approvedEvents: ['TRANSACTION_PAID'], // container
    refundEvents: ['TRANSACTION_REFUNDED', 'TRANSACTION_CHARGEBACK', 'TRANSACTION_CHARGED_BACK'],
    statusPaths: COMMON_STATUS,
    approveWithoutStatus: false,
    externalId: ['transaction.id'], // container
    email: ['client.email'], // container
    phone: ['client.phone'], // container
    name: ['client.name'], // container
    doc: ['client.document', 'client.cpf'],
    commission: { paths: ['transaction.commissionAmount'], cents: false }, // container
    currency: ['transaction.currency'], // container
    productName: ['orderItems.0.product.name'], // container
    productId: ['orderItems.0.product.id'], // container
    paymentMethod: ['transaction.paymentMethod', 'transaction.payment_method'],
    soldAt: ['transaction.paidAt', 'transaction.paid_at', 'transaction.createdAt'],
    utm: utmUnder('trackProps'),
    indexer: ['trackProps.sck'], // container
  },

  frendz: {
    platform: 'frendz',
    label: 'Frendz',
    eventPaths: ['event', 'event_name'],
    // O evento é "transaction" para toda transação (container): quem decide é o status.
    approvedEvents: [],
    refundEvents: [],
    statusPaths: ['transaction.status', ...COMMON_STATUS],
    approveWithoutStatus: true,
    externalId: ['transaction.id'], // container
    email: ['customer.email'], // container
    phone: ['customer.phone'], // container
    name: ['customer.name'], // container
    doc: ['customer.document', 'customer.cpf'],
    amount: { paths: ['offer.price'], cents: true }, // container
    productName: ['offer.title'], // container
    productId: ['offer.hash'], // container
    paymentMethod: ['transaction.payment_method', 'transaction.method'],
    soldAt: ['transaction.paid_at', 'transaction.created_at'],
    utm: utmUnder('tracking'),
    indexer: ['tracking.src'], // container
  },

  herospark: {
    platform: 'herospark',
    label: 'Herospark',
    eventPaths: ['event', 'event_name'],
    approvedEvents: [],
    refundEvents: [],
    statusPaths: ['purchase.status', ...COMMON_STATUS],
    approveWithoutStatus: true, // container: gatilho em todo webhook
    externalId: ['transaction_id'], // container
    email: ['buyer.email'], // container
    phone: ['buyer.phone'], // container
    name: ['buyer.name'], // container
    doc: ['buyer.document', 'buyer.cpf'],
    country: ['data.purchase.checkout_country.iso'], // container
    amount: { paths: ['purchase.price.value'], cents: false }, // container
    productName: ['product.name'], // container
    productId: ['product.id'], // container
    soldAt: ['purchase.approved_date', 'purchase.created_at'],
    utm: utmUnder('utm'),
    indexer: ['utm.src'], // container
  },

  kavoo: {
    platform: 'kavoo',
    label: 'Kavoo',
    eventPaths: ['event', 'event_name'],
    approvedEvents: [],
    refundEvents: [],
    statusPaths: ['transaction.status', ...COMMON_STATUS],
    approveWithoutStatus: true, // container: gatilho em todo webhook
    externalId: ['transaction.code'], // container
    email: ['customer.email'], // container
    phone: ['customer.phone'], // container
    name: ['customer.name'], // container
    doc: ['customer.document', 'customer.cpf'],
    commission: { paths: ['transaction.fee_producer'], cents: true }, // container
    productName: ['items.0.name'], // container
    productId: ['items.0.product_id'], // container
    paymentMethod: ['transaction.payment_method'],
    soldAt: ['transaction.paid_at', 'transaction.created_at'],
    utm: utmUnder('tracking'),
    indexer: ['tracking.src'], // container
  },

  pagtrust: {
    // Mesmo formato do webhook da Hotmart (data.buyer, data.purchase, data.commissions).
    platform: 'pagtrust',
    label: 'PagTrust',
    eventPaths: ['event'],
    approvedEvents: ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'], // container: PURCHASE_APPROVED
    refundEvents: ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_PROTEST'],
    statusPaths: ['data.purchase.status'],
    approveWithoutStatus: false,
    externalId: ['data.purchase.transaction'], // container
    email: ['data.buyer.email'], // container
    phone: ['data.buyer.checkout_phone', 'data.buyer.phone'], // container
    name: ['data.buyer.name'], // container
    doc: ['data.buyer.document'],
    city: ['data.buyer.adress.city', 'data.buyer.address.city'], // container (sic "adress")
    state: ['data.buyer.adress.state', 'data.buyer.address.state'],
    zip: ['data.buyer.adress.zipcode', 'data.buyer.address.zipcode'], // container
    country: ['data.purchase.checkout_country.iso'], // container
    amount: { paths: ['data.purchase.price.value', 'data.purchase.full_price.value'], cents: false },
    commission: { paths: ['data.commissions.1.value'], cents: false }, // container
    currency: ['data.purchase.price.currency_value', 'data.commissions.1.currency_value'], // container
    productName: ['data.product.name'], // container
    productId: ['data.product.id'], // container
    paymentMethod: ['data.purchase.payment.type'],
    soldAt: ['data.purchase.approved_date', 'data.purchase.order_date'],
    utm: utmUnder('data.purchase.origin'),
    indexer: ['data.purchase.origin.xcod'], // container
    xcodPath: 'data.purchase.origin.xcod',
  },

  assiny: {
    platform: 'assiny',
    label: 'Assiny',
    eventPaths: ['event', 'event_name'],
    approvedEvents: ['approved_purchase'], // container
    refundEvents: ['refunded_purchase', 'purchase_refunded', 'chargeback', 'chargeback_purchase'],
    statusPaths: ['data.transaction.status', ...COMMON_STATUS],
    approveWithoutStatus: false,
    externalId: ['data.transaction.id'], // container
    email: ['data.client.email'], // container
    phone: ['data.client.phone'], // container
    name: ['data.client.full_name', 'data.client.name'], // container
    doc: ['data.client.document', 'data.client.cpf'],
    amount: { paths: ['data.offer.amount_client'], cents: true }, // container
    productName: ['data.offer.product.name'], // container
    productId: ['data.offer.product.id'], // container
    paymentMethod: ['data.transaction.payment_method'],
    soldAt: ['data.transaction.paid_at', 'data.transaction.created_at'],
    utm: utmUnder('data.metadata.url_parameters'),
    indexer: ['data.metadata.url_parameters.xcod'], // container
  },

  yampi: {
    platform: 'yampi',
    label: 'Yampi',
    eventPaths: ['event'],
    approvedEvents: ['order.paid'], // container
    refundEvents: ['order.refunded', 'order.chargeback'],
    statusPaths: ['resource.status.data.alias'],
    approveWithoutStatus: false,
    externalId: ['resource.id'], // container
    email: ['resource.customer.data.email'], // container
    phone: ['resource.customer.data.phone.formated_number', 'resource.customer.data.phone.full_number'], // container
    name: ['resource.customer.data.name'],
    firstName: ['resource.customer.data.first_name'], // container
    lastName: ['resource.customer.data.last_name'], // container
    doc: ['resource.customer.data.cpf'],
    city: ['resource.shipping_address.data.city'],
    state: ['resource.shipping_address.data.uf', 'resource.shipping_address.data.state'],
    zip: ['resource.shipping_address.data.zipcode'],
    amount: { paths: ['resource.value_total'], cents: false }, // container
    productName: ['resource.items.data.0.sku.data.title'], // container
    productId: ['resource.items.data.0.sku.data.product_id'], // container
    paymentMethod: ['resource.payments.data.0.name'],
    soldAt: ['resource.updated_at.date', 'resource.created_at.date'],
    utm: utmUnder('resource'),
    indexer: ['resource.utm_term'], // container
  },

  wiapy: {
    platform: 'wiapy',
    label: 'Wiapy',
    eventPaths: ['event', 'event_name'],
    approvedEvents: [],
    refundEvents: [],
    statusPaths: ['payment.status', ...COMMON_STATUS],
    approveWithoutStatus: true, // container: gatilho em todo webhook
    externalId: ['payment.id'], // container
    email: ['customer.email'], // container
    phone: ['customer.mobile_phone', 'customer.phone'], // container
    name: ['customer.name'], // container
    doc: ['customer.document', 'customer.cpf'],
    amount: { paths: ['payment.amount'], cents: true }, // container
    productName: ['products.0.title'], // container
    productId: ['products.0.id'], // container
    paymentMethod: ['payment.method', 'payment.payment_method'],
    soldAt: ['payment.paid_at', 'payment.created_at'],
    utm: utmUnder('tracking'),
    indexer: ['tracking.utm_term'], // container
  },

  doppus: {
    platform: 'doppus',
    label: 'Doppus',
    eventPaths: ['event', 'event_name'],
    approvedEvents: [],
    refundEvents: [],
    statusPaths: ['status.code', 'transaction.status', ...COMMON_STATUS],
    approveWithoutStatus: true, // container: gatilho em todo webhook
    externalId: ['transaction.code'], // container
    email: ['customer.email'], // container
    phone: ['customer.phone'], // container
    name: ['customer.name'], // container
    doc: ['customer.doc', 'customer.document'],
    commission: { paths: ['transaction.fee_producer'], cents: true }, // container
    productName: ['items.0.name'], // container
    productId: ['items.0.code'], // container
    paymentMethod: ['transaction.payment_method', 'payment.method'],
    soldAt: ['transaction.paid_at', 'transaction.created_at'],
    utm: utmUnder('tracking'),
    indexer: ['tracking.utm_term'], // container
  },
};

export const GENERIC_PLATFORMS = new Set(Object.keys(CHECKOUT_SPECS));
