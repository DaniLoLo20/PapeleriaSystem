import { formatDate } from '@angular/common';
import { EstadoPedido } from '../models/order.model';

export function formatearFecha(valor: string | Date): string {
  return formatDate(valor, 'dd/MM/yyyy HH:mm', 'es-MX');
}

export function etiquetaEstado(status: EstadoPedido): string {
  const map: Record<EstadoPedido, string> = {
    NEW: 'Nuevo',
    IN_PROGRESS: 'En proceso',
    PRINTED: 'Impreso',
    DELIVERED: 'Entregado',
    ARCHIVED: 'Archivado',
  };

  return map[status];
}
