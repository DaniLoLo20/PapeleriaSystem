import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { etiquetaEstado, formatearFecha } from '../../../core/utils/format.util';
import { OrderModel } from '../../../core/models/order.model';

@Component({
  selector: 'app-order-card',
  imports: [CommonModule],
  templateUrl: './order-card.component.html',
  styleUrl: './order-card.component.scss',
})
export class OrderCardComponent {
  @Input({ required: true }) pedido!: OrderModel;
  @Output() cambiarEstado = new EventEmitter<OrderModel>();

  estadoLabel(status: OrderModel['status']): string {
    return etiquetaEstado(status);
  }

  fecha(value: string): string {
    return formatearFecha(value);
  }
}
