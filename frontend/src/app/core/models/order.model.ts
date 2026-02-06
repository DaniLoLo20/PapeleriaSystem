export type EstadoPedido = 'NEW' | 'IN_PROGRESS' | 'PRINTED' | 'DELIVERED' | 'ARCHIVED';

export interface PrintOptions {
  bnColor: 'BN' | 'COLOR';
  size: 'CARTA' | 'OFICIO' | 'A4';
  copies: number;
}

export interface OrderModel {
  id: string;
  folio: string;
  customer_name: string;
  customer_phone: string | null;
  status: EstadoPedido;
  options: Partial<PrintOptions>;
  notes: string | null;
  compiled_pdf_path: string | null;
  storage_mode: 'LOCAL' | 'R2';
  created_at: string;
  updated_at: string;
}

export interface PaginatedOrders {
  items: OrderModel[];
  total: number;
  page: number;
  limit: number;
}
