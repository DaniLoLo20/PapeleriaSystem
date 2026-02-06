import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FileModel } from '../models/file.model';
import { EstadoPedido, OrderModel, PaginatedOrders, PrintOptions } from '../models/order.model';
import { getAdminPin } from '../guards/panel-pin.guard';

@Injectable({ providedIn: 'root' })
export class OrdersApi {
  private readonly baseUrl = this.resolveBaseUrl();

  constructor(private readonly http: HttpClient) {}

  createOrder(payload: {
    customer_name: string;
    phone?: string;
    options: PrintOptions & Record<string, unknown>;
    notes?: string;
  }): Observable<{ id: string; folio: string }> {
    return this.http.post<{ id: string; folio: string }>(`${this.baseUrl}/orders`, payload);
  }

  uploadFiles(orderId: string, files: File[]): Observable<FileModel[]> {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    return this.http.post<FileModel[]>(`${this.baseUrl}/orders/${orderId}/files`, form);
  }

  reorderFiles(orderId: string, fileIds: string[]): Observable<FileModel[]> {
    return this.http.patch<FileModel[]>(`${this.baseUrl}/orders/${orderId}/files/reorder`, { fileIds });
  }

  listOrderFiles(orderId: string): Observable<FileModel[]> {
    return this.http.get<FileModel[]>(`${this.baseUrl}/orders/${orderId}/files`, {
      headers: this.withAdminPin(),
    });
  }

  compileOrder(orderId: string): Observable<{ compiled_pdf_path: string }> {
    return this.http.post<{ compiled_pdf_path: string }>(`${this.baseUrl}/orders/${orderId}/compile`, {});
  }

  getCompiledPdfUrl(orderId: string): string {
    return `${this.baseUrl}/orders/${orderId}/compiled.pdf`;
  }

  getOrderFileUrl(orderId: string, fileId: string): string {
    return `${this.baseUrl}/orders/${orderId}/files/${fileId}`;
  }

  listOrders(status: EstadoPedido, page = 1, limit = 20): Observable<PaginatedOrders> {
    const params = new HttpParams()
      .set('status', status)
      .set('page', page)
      .set('limit', limit);

    return this.http.get<PaginatedOrders>(`${this.baseUrl}/orders`, {
      params,
      headers: this.withAdminPin(),
    });
  }

  updateStatus(orderId: string, status: EstadoPedido): Observable<OrderModel> {
    return this.http.patch<OrderModel>(
      `${this.baseUrl}/orders/${orderId}/status`,
      { status },
      { headers: this.withAdminPin() },
    );
  }

  cleanup(mode: 'ARCHIVE_PRINTED' | 'CLEAN_ARCHIVED_OLDER_THAN' | 'DELETE_PRINTED', days?: number): Observable<unknown> {
    return this.http.post(
      `${this.baseUrl}/orders/cleanup`,
      { mode, days },
      { headers: this.withAdminPin() },
    );
  }

  updateOrderOptions(orderId: string, options: Record<string, unknown>): Observable<OrderModel> {
    return this.http.patch<OrderModel>(
      `${this.baseUrl}/orders/${orderId}/options`,
      { options },
      { headers: this.withAdminPin() },
    );
  }

  private withAdminPin(): HttpHeaders {
    const pin = getAdminPin();
    return new HttpHeaders({
      'x-admin-pin': pin,
    });
  }

  private resolveBaseUrl(): string {
    const fromStorage = localStorage.getItem('papeleria_api_url');
    if (fromStorage?.trim()) {
      return fromStorage.trim().replace(/\/+$/, '');
    }

    const host = window.location.hostname || 'localhost';
    return `http://${host}:3000`;
  }
}
