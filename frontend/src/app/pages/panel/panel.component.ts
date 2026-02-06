import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { driver, type Driver } from 'driver.js';
import { forkJoin } from 'rxjs';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { OrderCardComponent } from '../../shared/components/order-card/order-card.component';
import { OrdersApi } from '../../core/api/orders.api';
import { FileModel } from '../../core/models/file.model';
import { EstadoPedido, OrderModel } from '../../core/models/order.model';

type DesignerItem = {
  fileId: string;
  fileName: string;
  mimeType: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  previewUrl: string;
};

type DocTemplate = {
  id: string;
  nombre: string;
  contenido: string;
  createdAt: string;
};

type TourFabDrag = {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

@Component({
  selector: 'app-panel',
  imports: [CommonModule, FormsModule, DragDropModule, OrderCardComponent],
  templateUrl: './panel.component.html',
  styleUrl: './panel.component.scss',
})
export class PanelComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('docEditorRef') docEditorRef?: ElementRef<HTMLDivElement>;
  @ViewChild('docPreviewRef') docPreviewRef?: ElementRef<HTMLDivElement>;

  estados: EstadoPedido[] = ['NEW', 'IN_PROGRESS', 'PRINTED', 'DELIVERED', 'ARCHIVED'];
  estadoActivo: EstadoPedido = 'NEW';
  pedidos: OrderModel[] = [];
  cargando = false;
  mensaje = '';
  filtroNombre = '';
  filtroFecha = '';

  archivosPorPedido: Record<string, FileModel[]> = {};
  cargandoArchivosPorPedido: Record<string, boolean> = {};
  editorPedidoId: string | null = null;
  creatorPedidoId: string | null = null;
  autoPerPageByOrder: Record<string, number> = {};
  opcionesAuto = Array.from({ length: 20 }, (_, i) => i + 1);
  designerByOrder: Record<string, DesignerItem[]> = {};
  designerPageByOrder: Record<string, number> = {};
  designerReadyByOrder: Record<string, boolean> = {};
  mostrarCreadorDocumento = false;
  vistaCreador: 'DOCUMENTO' | 'PLANTILLAS' = 'DOCUMENTO';
  modoDocumento: 'BLANCO' | 'PLANTILLA' = 'BLANCO';
  plantillasDocumento: DocTemplate[] = [];
  plantillaSeleccionadaId = '';
  documentoTitulo = 'Documento';
  documentoContenido = '<p></p>';
  nuevaPlantillaNombre = '';
  nuevaPlantillaContenido = '';
  readonly placeholders = ['{nombre}', '{fecha}', '{rango_fecha}', '{hoy}', '{telefono}', '{empresa}'];
  docVars = {
    nombre: '',
    fecha: '',
    rango_fecha: '',
    hoy: this.formatearFechaHoy(),
    telefono: '',
    empresa: '',
  };

  notificacionesPendientes = 0;
  notificacionPulse = false;
  ultimaRevision = new Date();

  resumenEstados: Record<EstadoPedido, number> = {
    NEW: 0,
    IN_PROGRESS: 0,
    PRINTED: 0,
    DELIVERED: 0,
    ARCHIVED: 0,
  };

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  private readonly tourStorageKey = 'papeleria_panel_tour_v1';
  private tourInstancia: Driver | null = null;
  private tourFabDrag: TourFabDrag | null = null;
  private bloquearClickTourFab = false;

  tourFabX = typeof window !== 'undefined' ? Math.max(12, window.innerWidth - 102) : 18;
  tourFabY = typeof window !== 'undefined' ? Math.max(12, window.innerHeight - 92) : 18;

  constructor(private readonly ordersApi: OrdersApi) {}

  ngOnInit(): void {
    this.cargarPlantillas();
    this.cargarPedidos();
    this.actualizarResumenEstados();
    this.iniciarPollingPendientes();
  }

  ngAfterViewInit(): void {
    this.ajustarTourFabALimites();
    setTimeout(() => this.iniciarGuiaPrimerIngreso(), 260);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.liberarEventosTourFab();
    if (this.tourInstancia) {
      this.tourInstancia.destroy();
      this.tourInstancia = null;
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.viewportWidth = window.innerWidth;
    this.ajustarTourFabALimites();
  }

  onTourFabPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.tourFabDrag = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: this.tourFabX,
      startTop: this.tourFabY,
      moved: false,
    };
    window.addEventListener('pointermove', this.onTourFabPointerMove);
    window.addEventListener('pointerup', this.onTourFabPointerUp);
    window.addEventListener('pointercancel', this.onTourFabPointerUp);
  }

  onTourFabClick(event: MouseEvent): void {
    if (this.bloquearClickTourFab) {
      event.preventDefault();
      this.bloquearClickTourFab = false;
      return;
    }
    this.iniciarGuiaPanel(true);
  }

  seleccionarEstado(status: EstadoPedido): void {
    this.estadoActivo = status;
    this.cargarPedidos();
  }

  irAPendientes(): void {
    this.estadoActivo = 'NEW';
    this.cargarPedidos();
  }

  cargarPedidos(silencioso = false): void {
    if (!silencioso) {
      this.cargando = true;
    }

    this.ordersApi.listOrders(this.estadoActivo).subscribe({
      next: (resp) => {
        this.pedidos = resp.items;
        this.cargando = false;
        this.ultimaRevision = new Date();
      },
      error: () => {
        this.cargando = false;
        this.mensaje = 'No se pudieron cargar pedidos. Verifica PIN en localStorage.';
      },
    });
  }

  cambiarEstado(order: OrderModel, status: EstadoPedido): void {
    this.ordersApi.updateStatus(order.id, status).subscribe({
      next: () => {
        this.cargarPedidos(true);
        this.actualizarResumenEstados();
      },
      error: () => (this.mensaje = 'No se pudo actualizar estado.'),
    });
  }

  archivarImpresos(): void {
    this.ordersApi.cleanup('ARCHIVE_PRINTED').subscribe({
      next: () => {
        this.cargarPedidos(true);
        this.actualizarResumenEstados();
      },
      error: () => (this.mensaje = 'No se pudo ejecutar el archivado.'),
    });
  }

  limpiarArchivados(): void {
    this.ordersApi.cleanup('CLEAN_ARCHIVED_OLDER_THAN', 30).subscribe({
      next: () => {
        this.mensaje = 'Limpieza completada.';
        this.actualizarResumenEstados();
      },
      error: () => (this.mensaje = 'No se pudo limpiar archivados.'),
    });
  }

  eliminarImpresos(): void {
    const confirmar = window.confirm('Se eliminaran pedidos en estado PRINTED y sus archivos fisicos. Continuar?');
    if (!confirmar) {
      return;
    }

    this.ordersApi.cleanup('DELETE_PRINTED').subscribe({
      next: (resp: any) => {
        const count = Number(resp?.orders_deleted || 0);
        this.mensaje = count > 0 ? `Se eliminaron ${count} pedido(s) impresos.` : 'No habia pedidos impresos para eliminar.';
        this.cargarPedidos(true);
        this.actualizarResumenEstados();
      },
      error: () => (this.mensaje = 'No se pudieron eliminar pedidos impresos.'),
    });
  }

  abrirPdf(order: OrderModel): void {
    window.open(this.ordersApi.getCompiledPdfUrl(order.id), '_blank');
  }

  toggleEditor(order: OrderModel): void {
    if (this.editorPedidoId === order.id) {
      this.editorPedidoId = null;
      this.creatorPedidoId = null;
      return;
    }

    this.editorPedidoId = order.id;
    if (!this.archivosPorPedido[order.id]) {
      this.archivosPorPedido[order.id] = [];
    }
    this.cargarArchivos(order.id, order);
  }

  toggleCreator(order: OrderModel): void {
    this.creatorPedidoId = this.creatorPedidoId === order.id ? null : order.id;
  }

  onDropFiles(orderId: string, event: CdkDragDrop<FileModel[]>): void {
    const lista = this.archivosPorPedido[orderId];
    if (!lista) {
      return;
    }
    moveItemInArray(lista, event.previousIndex, event.currentIndex);
    this.archivosPorPedido[orderId] = [...lista];
  }

  moverArchivo(orderId: string, index: number, dir: -1 | 1): void {
    const lista = this.archivosPorPedido[orderId];
    if (!lista) {
      return;
    }
    const target = index + dir;
    if (target < 0 || target >= lista.length) {
      return;
    }
    [lista[index], lista[target]] = [lista[target], lista[index]];
    this.archivosPorPedido[orderId] = [...lista];
  }

  guardarOrden(order: OrderModel): void {
    const lista = this.archivosPorPedido[order.id];
    if (!lista?.length) {
      return;
    }

    const ids = lista.map((f) => f.id);
    this.ordersApi.reorderFiles(order.id, ids).subscribe({
      next: () => {
        this.ordersApi.compileOrder(order.id).subscribe({
          next: () => {
            this.mensaje = `Orden actualizado y PDF recompilado: ${order.folio}`;
          },
          error: () => {
            this.mensaje = 'Se reordeno, pero no se pudo recompilar PDF.';
          },
        });
      },
      error: () => {
        this.mensaje = 'No se pudo guardar el nuevo orden de archivos.';
      },
    });
  }

  designerItemsPagina(orderId: string): DesignerItem[] {
    const page = this.designerPageByOrder[orderId] || 0;
    return (this.designerByOrder[orderId] || []).filter((i) => i.page === page);
  }

  designerTotalPaginas(orderId: string): number {
    const items = this.designerByOrder[orderId] || [];
    const maxPage = items.reduce((acc, i) => Math.max(acc, i.page), 0);
    return Math.max(1, maxPage + 1);
  }

  anteriorPaginaDesigner(orderId: string): void {
    const current = this.designerPageByOrder[orderId] || 0;
    this.designerPageByOrder[orderId] = Math.max(0, current - 1);
  }

  siguientePaginaDesigner(orderId: string): void {
    const current = this.designerPageByOrder[orderId] || 0;
    const max = this.designerTotalPaginas(orderId) - 1;
    this.designerPageByOrder[orderId] = Math.min(max, current + 1);
  }

  onDesignerDragEnded(order: OrderModel, item: DesignerItem, event: { source: { getFreeDragPosition: () => { x: number; y: number } } }): void {
    const pos = event.source.getFreeDragPosition();
    const dims = this.editorSizeByPaper(((order.options?.['size'] as 'CARTA' | 'OFICIO' | 'A4') || 'CARTA'));
    item.x = Math.max(0, Math.min(pos.x, dims.width - item.width));
    item.y = Math.max(0, Math.min(pos.y, dims.height - item.height));
  }

  aplicarAutoDesigner(order: OrderModel): void {
    const items = this.designerByOrder[order.id] || [];
    if (!items.length) {
      return;
    }
    const perPage = Math.max(1, Math.min(20, this.autoPerPageByOrder[order.id] || 3));
    const size = (order.options?.['size'] as 'CARTA' | 'OFICIO' | 'A4') || 'CARTA';
    const dims = this.editorSizeByPaper(size);
    const margin = 20;
    const cols = Math.ceil(Math.sqrt(perPage));
    const rows = Math.ceil(perPage / cols);
    const cellW = Math.max(80, Math.floor((dims.width - margin * (cols + 1)) / cols));
    const cellH = Math.max(80, Math.floor((dims.height - margin * (rows + 1)) / rows));

    items.forEach((item, index) => {
      const page = Math.floor(index / perPage);
      const slot = index % perPage;
      const row = Math.floor(slot / cols);
      const col = slot % cols;
      item.page = page;
      item.x = margin + col * (cellW + margin);
      item.y = margin + row * (cellH + margin);
      item.width = cellW;
      item.height = cellH;
    });
    this.designerByOrder[order.id] = [...items];
    this.designerPageByOrder[order.id] = 0;
  }

  guardarDesigner(order: OrderModel): void {
    const items = this.designerByOrder[order.id] || [];
    if (!items.length) {
      this.mensaje = 'No hay imagenes en el designer.';
      return;
    }

    const size = this.getOrderPaper(order);
    const perPage = Math.max(1, Math.min(20, this.autoPerPageByOrder[order.id] || 3));

    const sorted = [...items].sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    const layout = sorted.map((item, index) => ({
      orden: index + 1,
      kind: 'IMAGE',
      fileName: item.fileName,
      page: item.page,
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: Math.round(item.width),
      height: Math.round(item.height),
      cropRect: { x: 0, y: 0, w: 1, h: 1 },
      hoja: size,
    }));

    this.ordersApi
      .updateOrderOptions(order.id, {
        designerEnabled: true,
        autoPerPage: perPage,
        layout,
      })
      .subscribe({
        next: () => {
          this.ordersApi.compileOrder(order.id).subscribe({
            next: () => (this.mensaje = `Designer guardado y compilado: ${order.folio}`),
            error: () => (this.mensaje = 'Designer guardado, pero no se pudo recompilar PDF.'),
          });
        },
        error: () => {
          this.mensaje = 'No se pudo guardar el designer.';
        },
      });
  }

  onCreatorUpload(order: OrderModel, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) {
      return;
    }
    this.subirArchivos(order, files);
    input.value = '';
  }

  onCreatorPaste(order: OrderModel, event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    this.subirArchivos(order, files);
  }

  generarLayout(order: OrderModel): void {
    const files = this.archivosPorPedido[order.id] || [];
    const imagenes = files.filter((f) => f.mime_type.startsWith('image/'));

    if (!imagenes.length) {
      this.mensaje = 'No hay imagenes para crear layout.';
      return;
    }

    const perPage = Math.max(1, Math.min(20, this.autoPerPageByOrder[order.id] || 3));
    const size = (order.options?.['size'] as 'CARTA' | 'OFICIO' | 'A4') || 'CARTA';

    const dims = this.editorSizeByPaper(size);
    const margin = 20;
    const cols = Math.ceil(Math.sqrt(perPage));
    const rows = Math.ceil(perPage / cols);
    const cellW = Math.max(80, Math.floor((dims.width - margin * (cols + 1)) / cols));
    const cellH = Math.max(80, Math.floor((dims.height - margin * (rows + 1)) / rows));

    const layout = imagenes.map((img, index) => {
      const page = Math.floor(index / perPage);
      const slot = index % perPage;
      const row = Math.floor(slot / cols);
      const col = slot % cols;

      return {
        orden: index + 1,
        fileName: img.original_name,
        page,
        x: margin + col * (cellW + margin),
        y: margin + row * (cellH + margin),
        width: cellW,
        height: cellH,
        cropRect: { x: 0, y: 0, w: 1, h: 1 },
        hoja: size,
      };
    });

    this.ordersApi
      .updateOrderOptions(order.id, {
        designerEnabled: true,
        autoPerPage: perPage,
        layout,
      })
      .subscribe({
        next: () => {
          this.ordersApi.compileOrder(order.id).subscribe({
            next: () => {
              this.mensaje = `Layout generado y compilado: ${order.folio}`;
            },
            error: () => {
              this.mensaje = 'Layout guardado, pero no se pudo recompilar PDF.';
            },
          });
        },
        error: () => {
          this.mensaje = 'No se pudo guardar el layout del pedido.';
        },
      });
  }

  private iniciarPollingPendientes(): void {
    this.refrescarPendientes();
    this.pollTimer = setInterval(() => {
      this.refrescarPendientes();
      if (this.estadoActivo === 'NEW') {
        this.cargarPedidos(true);
      }
    }, 15000);
  }

  private refrescarPendientes(): void {
    this.ordersApi.listOrders('NEW', 1, 50).subscribe({
      next: (resp) => {
        const anterior = this.notificacionesPendientes;
        this.notificacionesPendientes = resp.total;
        this.resumenEstados.NEW = resp.total;
        this.ultimaRevision = new Date();

        if (anterior > 0 && resp.total > anterior) {
          this.notificacionPulse = true;
          this.mensaje = `Llegaron ${resp.total - anterior} pedido(s) nuevo(s).`;
          setTimeout(() => (this.notificacionPulse = false), 1800);
        }
      },
      error: () => {
        this.mensaje = 'No se pudo actualizar notificaciones de pendientes.';
      },
    });
  }

  private actualizarResumenEstados(): void {
    forkJoin({
      NEW: this.ordersApi.listOrders('NEW', 1, 1),
      IN_PROGRESS: this.ordersApi.listOrders('IN_PROGRESS', 1, 1),
      PRINTED: this.ordersApi.listOrders('PRINTED', 1, 1),
      DELIVERED: this.ordersApi.listOrders('DELIVERED', 1, 1),
      ARCHIVED: this.ordersApi.listOrders('ARCHIVED', 1, 1),
    }).subscribe({
      next: (resp) => {
        this.resumenEstados.NEW = resp.NEW.total;
        this.resumenEstados.IN_PROGRESS = resp.IN_PROGRESS.total;
        this.resumenEstados.PRINTED = resp.PRINTED.total;
        this.resumenEstados.DELIVERED = resp.DELIVERED.total;
        this.resumenEstados.ARCHIVED = resp.ARCHIVED.total;
      },
      error: () => {
        this.mensaje = 'No se pudo cargar resumen de estados.';
      },
    });
  }

  private cargarArchivos(orderId: string, orderArg?: OrderModel): void {
    this.cargandoArchivosPorPedido[orderId] = true;
    this.ordersApi.listOrderFiles(orderId).subscribe({
      next: (files) => {
        this.archivosPorPedido[orderId] = files;
        const order = orderArg || this.pedidos.find((p) => p.id === orderId);
        if (order) {
          this.inicializarDesigner(order, files);
        }
        this.cargandoArchivosPorPedido[orderId] = false;
        if (!this.autoPerPageByOrder[orderId]) {
          this.autoPerPageByOrder[orderId] = 3;
        }
      },
      error: () => {
        this.cargandoArchivosPorPedido[orderId] = false;
        this.mensaje = 'No se pudieron cargar archivos del pedido.';
      },
    });
  }

  private subirArchivos(order: OrderModel, files: File[]): void {
    this.ordersApi.uploadFiles(order.id, files).subscribe({
      next: () => {
        this.cargarArchivos(order.id, order);
        this.mensaje = 'Archivos agregados al pedido.';
      },
      error: () => {
        this.mensaje = 'No se pudieron agregar los archivos.';
      },
    });
  }

  private inicializarDesigner(order: OrderModel, files: FileModel[]): void {
    const imagenes = files.filter((f) => f.mime_type.startsWith('image/'));
    const size = this.getOrderPaper(order);
    const perPage = Math.max(1, Math.min(20, this.autoPerPageByOrder[order.id] || 3));
    this.autoPerPageByOrder[order.id] = perPage;

    const options = (order.options || {}) as Record<string, unknown>;
    const rawLayout = options['layout'];
    const layout = Array.isArray(rawLayout) ? rawLayout : [];
    const used = new Set<number>();
    const designer: DesignerItem[] = imagenes.map((img, idx) => {
      const layoutIndex = layout.findIndex((l: any, i) => {
        if (used.has(i)) return false;
        if (l?.kind && l.kind !== 'IMAGE') return false;
        return l?.fileName === img.original_name;
      });
      const fromLayout = layoutIndex >= 0 ? layout[layoutIndex] : null;
      if (layoutIndex >= 0) used.add(layoutIndex);
      return {
        fileId: img.id,
        fileName: img.original_name,
        mimeType: img.mime_type,
        page: Number(fromLayout?.page ?? 0),
        x: Number(fromLayout?.x ?? 24 + idx * 18),
        y: Number(fromLayout?.y ?? 24 + idx * 18),
        width: Number(fromLayout?.width ?? 280),
        height: Number(fromLayout?.height ?? 180),
        previewUrl: this.ordersApi.getOrderFileUrl(order.id, img.id),
      };
    });

    if (!designer.length) {
      this.designerByOrder[order.id] = [];
      this.designerReadyByOrder[order.id] = true;
      this.designerPageByOrder[order.id] = 0;
      return;
    }

    const hasUsefulLayout = designer.some((d) => d.x !== 24 || d.y !== 24 || d.page > 0);
    this.designerByOrder[order.id] = designer;
    this.designerPageByOrder[order.id] = 0;
    this.designerReadyByOrder[order.id] = true;

    if (!hasUsefulLayout) {
      this.aplicarAutoDesigner(order);
    }
  }

  editorSizeByPaper(size: 'CARTA' | 'OFICIO' | 'A4'): { width: number; height: number } {
    if (size === 'OFICIO') {
      return { width: 816, height: 1344 };
    }
    if (size === 'A4') {
      return { width: 794, height: 1123 };
    }
    return { width: 816, height: 1056 };
  }

  getOrderPaper(order: OrderModel): 'CARTA' | 'OFICIO' | 'A4' {
    const options = (order.options || {}) as Record<string, unknown>;
    const raw = options['size'];
    if (raw === 'OFICIO' || raw === 'A4' || raw === 'CARTA') {
      return raw;
    }
    return 'CARTA';
  }

  designerScale(order: OrderModel): number {
    if (this.viewportWidth > 900) {
      return 1;
    }
    const paper = this.editorSizeByPaper(this.getOrderPaper(order));
    const usable = Math.max(280, this.viewportWidth - 70);
    const fit = usable / paper.width;
    return this.clamp(fit, 0.4, 1);
  }

  designerCanvasShellHeight(order: OrderModel): number {
    const paper = this.editorSizeByPaper(this.getOrderPaper(order));
    return Math.round(paper.height * this.designerScale(order));
  }

  get pedidosFiltrados(): OrderModel[] {
    const name = this.filtroNombre.trim().toLowerCase();
    const date = this.filtroFecha;

    return this.pedidos.filter((pedido) => {
      const okNombre = !name || pedido.customer_name.toLowerCase().includes(name);
      const okFecha = !date || pedido.created_at.slice(0, 10) === date;
      return okNombre && okFecha;
    });
  }

  limpiarFiltros(): void {
    this.filtroNombre = '';
    this.filtroFecha = '';
  }

  toggleCreadorDocumento(): void {
    this.mostrarCreadorDocumento = !this.mostrarCreadorDocumento;
    if (this.mostrarCreadorDocumento) {
      this.vistaCreador = 'DOCUMENTO';
      if (this.modoDocumento === 'PLANTILLA' && this.plantillaSeleccionadaId) {
        this.aplicarPlantillaSeleccionada();
      }
      setTimeout(() => this.sincronizarEditorDesdeModelo(), 0);
    }
  }

  seleccionarModoDocumento(mode: 'BLANCO' | 'PLANTILLA'): void {
    this.modoDocumento = mode;
    if (mode === 'BLANCO') {
      this.documentoContenido = '<p></p>';
      this.sincronizarEditorDesdeModelo();
      return;
    }
    if (!this.plantillaSeleccionadaId && this.plantillasDocumento.length) {
      this.plantillaSeleccionadaId = this.plantillasDocumento[0].id;
    }
    this.aplicarPlantillaSeleccionada();
  }

  aplicarPlantillaSeleccionada(): void {
    if (!this.plantillaSeleccionadaId) {
      return;
    }
    const tpl = this.plantillasDocumento.find((p) => p.id === this.plantillaSeleccionadaId);
    if (!tpl) {
      return;
    }
    this.documentoContenido = tpl.contenido;
    this.documentoTitulo = tpl.nombre;
    this.sincronizarEditorDesdeModelo();
  }

  onEditorInput(event: Event): void {
    const el = event.target as HTMLElement;
    this.documentoContenido = el.innerHTML || '<p></p>';
  }

  aplicarComandoEditor(command: string, value?: string): void {
    this.docEditorRef?.nativeElement.focus();
    document.execCommand(command, false, value);
    this.documentoContenido = this.docEditorRef?.nativeElement.innerHTML || '<p></p>';
  }

  cambiarAlineacion(align: 'left' | 'center' | 'right' | 'justify'): void {
    if (align === 'left') this.aplicarComandoEditor('justifyLeft');
    if (align === 'center') this.aplicarComandoEditor('justifyCenter');
    if (align === 'right') this.aplicarComandoEditor('justifyRight');
    if (align === 'justify') this.aplicarComandoEditor('justifyFull');
  }

  vistaDocumentoFinalHtml(): string {
    let html = this.documentoContenido || '<p></p>';
    html = html.replaceAll('{nombre}', this.docVars.nombre || '');
    html = html.replaceAll('{fecha}', this.docVars.fecha || '');
    html = html.replaceAll('{rango_fecha}', this.docVars.rango_fecha || '');
    html = html.replaceAll('{hoy}', this.docVars.hoy || this.formatearFechaHoy());
    html = html.replaceAll('{telefono}', this.docVars.telefono || '');
    html = html.replaceAll('{empresa}', this.docVars.empresa || '');
    return html;
  }

  guardarPlantilla(): void {
    const nombre = this.nuevaPlantillaNombre.trim();
    const contenido = this.nuevaPlantillaContenido.trim();
    if (!nombre || !contenido) {
      this.mensaje = 'Para guardar plantilla, captura nombre y contenido.';
      return;
    }
    const nueva: DocTemplate = {
      id: this.crearIdSimple(),
      nombre,
      contenido,
      createdAt: new Date().toISOString(),
    };
    this.plantillasDocumento = [nueva, ...this.plantillasDocumento];
    this.persistirPlantillas();
    this.nuevaPlantillaNombre = '';
    this.nuevaPlantillaContenido = '';
    this.plantillaSeleccionadaId = nueva.id;
    this.mensaje = 'Plantilla guardada.';
  }

  usarPlantilla(id: string): void {
    this.plantillaSeleccionadaId = id;
    this.modoDocumento = 'PLANTILLA';
    this.vistaCreador = 'DOCUMENTO';
    this.aplicarPlantillaSeleccionada();
  }

  eliminarPlantilla(id: string): void {
    this.plantillasDocumento = this.plantillasDocumento.filter((p) => p.id !== id);
    if (this.plantillaSeleccionadaId === id) {
      this.plantillaSeleccionadaId = this.plantillasDocumento[0]?.id || '';
    }
    this.persistirPlantillas();
  }

  insertarPlaceholderEnNuevaPlantilla(token: string): void {
    this.nuevaPlantillaContenido = `${this.nuevaPlantillaContenido}${token}`;
  }

  insertarPlaceholderEnDocumento(token: string): void {
    this.docEditorRef?.nativeElement.focus();
    document.execCommand('insertText', false, token);
    this.documentoContenido = this.docEditorRef?.nativeElement.innerHTML || `${this.documentoContenido}${token}`;
  }

  copiarDocumentoFinal(): void {
    const html = this.vistaDocumentoFinalHtml();
    const text = this.htmlToText(html).trim();
    if (!text) {
      this.mensaje = 'No hay contenido para copiar.';
      return;
    }
    void navigator.clipboard?.writeText(text);
    this.mensaje = 'Documento copiado al portapapeles.';
  }

  async descargarDocumentoPdf(): Promise<void> {
    const previewEl = this.docPreviewRef?.nativeElement;
    if (!previewEl) {
      this.mensaje = 'No se pudo preparar la vista previa.';
      return;
    }

    const text = this.htmlToText(this.vistaDocumentoFinalHtml()).trim();
    if (!text) {
      this.mensaje = 'No hay contenido para descargar.';
      return;
    }

    const canvas = await html2canvas(previewEl, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const targetW = pageW - margin * 2;
    const targetH = (canvas.height * targetW) / canvas.width;

    let currentY = margin;
    let offset = 0;
    while (offset < targetH) {
      if (offset > 0) {
        pdf.addPage();
        currentY = margin;
      }
      const remaining = targetH - offset;
      const drawH = Math.min(pageH - margin * 2, remaining);
      pdf.addImage(imgData, 'PNG', margin, currentY - offset, targetW, targetH);
      offset += drawH;
    }
    pdf.save(`${this.documentoTitulo || 'documento'}.pdf`);
  }

  private cargarPlantillas(): void {
    const raw = localStorage.getItem('papeleria_doc_templates_v1');
    if (!raw) {
      this.plantillasDocumento = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw) as DocTemplate[];
      this.plantillasDocumento = Array.isArray(parsed) ? parsed : [];
      this.plantillaSeleccionadaId = this.plantillasDocumento[0]?.id || '';
    } catch {
      this.plantillasDocumento = [];
    }
  }

  private persistirPlantillas(): void {
    localStorage.setItem('papeleria_doc_templates_v1', JSON.stringify(this.plantillasDocumento));
  }

  private crearIdSimple(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  private formatearFechaHoy(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = `${now.getMonth() + 1}`.padStart(2, '0');
    const d = `${now.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private sincronizarEditorDesdeModelo(): void {
    const editor = this.docEditorRef?.nativeElement;
    if (!editor) {
      return;
    }
    editor.innerHTML = this.documentoContenido || '<p></p>';
  }

  private htmlToText(html: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.innerText || '').trim();
  }

  private iniciarGuiaPrimerIngreso(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const yaVisto = localStorage.getItem(this.tourStorageKey) === '1';
    if (yaVisto) {
      return;
    }
    this.iniciarGuiaPanel(false);
  }

  private iniciarGuiaPanel(forzado: boolean): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (this.tourInstancia) {
      this.tourInstancia.destroy();
      this.tourInstancia = null;
    }

    this.tourInstancia = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      nextBtnText: 'Siguiente',
      prevBtnText: 'Atras',
      doneBtnText: 'Listo',
      steps: [
        {
          element: '[data-tour="panel-head"]',
          popover: {
            title: '1. Encabezado rapido',
            description: 'Aqui ves pendientes, acceso a crear documento y control general.',
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '[data-tour="panel-estados"]',
          popover: {
            title: '2. Filtros por estado',
            description: 'Cambia entre NEW, IN_PROGRESS, PRINTED, DELIVERED y ARCHIVED.',
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '[data-tour="panel-acciones-globales"]',
          popover: {
            title: '3. Acciones globales',
            description: 'Desde aqui archivas impresos o limpias archivados antiguos.',
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '[data-tour="panel-filtros"]',
          popover: {
            title: '4. Buscar pedidos',
            description: 'Filtra por nombre del cliente o fecha para encontrar rapido.',
            side: 'bottom',
            align: 'start',
          },
        },
        {
          element: '[data-tour="panel-cards"]',
          popover: {
            title: '5. Tarjetas de pedidos',
            description: 'Cada tarjeta permite cambiar estado, abrir PDF y reorganizar.',
            side: 'top',
            align: 'center',
          },
        },
        {
          element: '[data-tour="panel-reorganizar"]',
          popover: {
            title: '6. Auto acomodo por hoja',
            description: 'En "Reorganizar documento" puedes elegir cuantas imagenes quieres por hoja con "Auto por hoja" y acomodarlas automatico.',
            side: 'top',
            align: 'center',
          },
        },
        {
          element: '[data-tour="panel-tour-fab"]',
          popover: {
            title: '7. Boton flotante',
            description: 'Puedes mover este boton y tocarlo cuando quieras repetir la guia.',
            side: 'left',
            align: 'center',
          },
        },
      ],
      onDestroyed: () => {
        if (!forzado) {
          localStorage.setItem(this.tourStorageKey, '1');
        }
      },
    });

    this.tourInstancia.drive();
  }

  private readonly onTourFabPointerMove = (event: PointerEvent): void => {
    if (!this.tourFabDrag) {
      return;
    }
    const dx = event.clientX - this.tourFabDrag.startX;
    const dy = event.clientY - this.tourFabDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      this.tourFabDrag.moved = true;
    }

    const nextX = this.tourFabDrag.startLeft + dx;
    const nextY = this.tourFabDrag.startTop + dy;
    const maxX = Math.max(12, window.innerWidth - 88);
    const maxY = Math.max(12, window.innerHeight - 56);
    this.tourFabX = this.clamp(nextX, 12, maxX);
    this.tourFabY = this.clamp(nextY, 12, maxY);
  };

  private readonly onTourFabPointerUp = (): void => {
    if (this.tourFabDrag?.moved) {
      this.bloquearClickTourFab = true;
      setTimeout(() => (this.bloquearClickTourFab = false), 120);
    }
    this.tourFabDrag = null;
    this.liberarEventosTourFab();
  };

  private liberarEventosTourFab(): void {
    window.removeEventListener('pointermove', this.onTourFabPointerMove);
    window.removeEventListener('pointerup', this.onTourFabPointerUp);
    window.removeEventListener('pointercancel', this.onTourFabPointerUp);
  }

  private ajustarTourFabALimites(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const maxX = Math.max(12, window.innerWidth - 88);
    const maxY = Math.max(12, window.innerHeight - 56);
    this.tourFabX = this.clamp(this.tourFabX, 12, maxX);
    this.tourFabY = this.clamp(this.tourFabY, 12, maxY);
  }
}
