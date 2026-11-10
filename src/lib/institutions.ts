import type { AccountKind } from './types'

export interface Institution {
  id: string
  name: string
  /** sigla para el botón */
  mark: string
  url: string
  group: 'banco' | 'billetera' | 'inversion'
  products: AccountKind[]
}

const BANK: AccountKind[] = ['corriente', 'vista', 'tarjeta_credito', 'linea_credito', 'credito_consumo', 'credito_comercial', 'hipotecario', 'leasing', 'inversion', 'ahorro']

export const INSTITUTIONS: Institution[] = [
  { id: 'santander', name: 'Santander', mark: 'S', url: 'https://banco.santander.cl/', group: 'banco', products: BANK },
  { id: 'bancochile', name: 'Banco de Chile', mark: 'BCh', url: 'https://portales.bancochile.cl/personas', group: 'banco', products: BANK },
  { id: 'bci', name: 'BCI', mark: 'Bci', url: 'https://www.bci.cl/', group: 'banco', products: BANK },
  { id: 'itau', name: 'Itaú', mark: 'It', url: 'https://www.itau.cl/', group: 'banco', products: BANK },
  { id: 'scotiabank', name: 'Scotiabank', mark: 'Sc', url: 'https://www.scotiabank.cl/', group: 'banco', products: BANK },
  { id: 'bancoestado', name: 'BancoEstado', mark: 'BE', url: 'https://www.bancoestado.cl/', group: 'banco', products: BANK },
  { id: 'falabella', name: 'Banco Falabella', mark: 'F', url: 'https://www.bancofalabella.cl/', group: 'banco', products: ['corriente', 'vista', 'tarjeta_credito', 'linea_credito', 'credito_consumo', 'hipotecario', 'inversion'] },
  { id: 'security', name: 'Banco Security', mark: 'Se', url: 'https://www.bancosecurity.cl/', group: 'banco', products: BANK },
  { id: 'bice', name: 'BICE', mark: 'Bi', url: 'https://banco.bice.cl/', group: 'banco', products: BANK },
  { id: 'consorcio', name: 'Banco Consorcio', mark: 'Co', url: 'https://www.bancoconsorcio.cl/', group: 'banco', products: BANK },
  { id: 'ripley', name: 'Banco Ripley', mark: 'R', url: 'https://www.bancoripley.cl/', group: 'banco', products: ['corriente', 'vista', 'tarjeta_credito', 'credito_consumo'] },
  { id: 'mercadopago', name: 'Mercado Pago', mark: 'MP', url: 'https://www.mercadopago.cl/', group: 'billetera', products: ['billetera', 'tarjeta_credito', 'credito_consumo'] },
  { id: 'tenpo', name: 'Tenpo', mark: 'T', url: 'https://www.tenpo.cl/', group: 'billetera', products: ['billetera', 'tarjeta_credito'] },
  { id: 'mach', name: 'MACH', mark: 'M', url: 'https://www.somosmach.com/', group: 'billetera', products: ['billetera', 'tarjeta_credito'] },
  { id: 'binance', name: 'Binance', mark: 'Bn', url: 'https://www.binance.com/', group: 'inversion', products: ['inversion'] },
  { id: 'fintual', name: 'Fintual', mark: 'Fi', url: 'https://fintual.cl/', group: 'inversion', products: ['inversion'] },
]

export const PRODUCT_LABEL: Record<AccountKind, string> = {
  corriente: 'Cuenta corriente',
  vista: 'Cuenta vista / RUT',
  ahorro: 'Cuenta de ahorro',
  tarjeta_credito: 'Tarjeta de crédito',
  linea_credito: 'Línea de crédito',
  credito_consumo: 'Crédito de consumo',
  credito_comercial: 'Crédito comercial',
  hipotecario: 'Crédito hipotecario',
  leasing: 'Leasing',
  inversion: 'Inversiones',
  efectivo: 'Efectivo',
  billetera: 'Cuenta / billetera',
  otro: 'Otro producto',
}

export const GENERIC_PRODUCTS: AccountKind[] = ['corriente', 'vista', 'tarjeta_credito', 'linea_credito', 'credito_consumo', 'credito_comercial', 'inversion', 'otro']

export function findInstitution(bank: string): Institution | undefined {
  const b = bank.toLowerCase()
  return INSTITUTIONS.find(i => i.name.toLowerCase() === b || b.includes(i.id) || i.name.toLowerCase().includes(b))
}

export const INCOME_CHANNELS: { id: string; label: string }[] = [
  { id: 'transferencia', label: 'Transferencias' },
  { id: 'tarjetas', label: 'Tarjetas (Getnet, Transbank, Mercado Pago…)' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'vale_vista', label: 'Vale vista o cheque' },
  { id: 'financieras', label: 'Financieras o créditos de terceros' },
  { id: 'sueldo', label: 'Sueldo' },
  { id: 'arriendos', label: 'Arriendos' },
  { id: 'plataformas', label: 'Plataformas (apps, marketplaces)' },
  { id: 'cripto', label: 'Cripto' },
]

export const ACTIVITIES = ['Compra y venta de autos', 'Tienda o comercio', 'Servicios profesionales', 'Belleza y bienestar', 'Comida y restaurantes', 'Arriendo de propiedades', 'Construcción', 'Transporte', 'Software y tecnología', 'Inversiones']

export const CMF = {
  persona: 'https://conocetudeuda.cmfchile.cl/',
  empresa: 'https://www.cmfchile.cl/sitio/siac4/ingresoWebCiudadano.php',
}
