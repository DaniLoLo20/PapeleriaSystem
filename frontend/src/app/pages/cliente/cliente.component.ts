import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { driver, type Driver } from 'driver.js';
import { finalize } from 'rxjs';
import Swal from 'sweetalert2';
import { OrdersApi } from '../../core/api/orders.api';
import { UiLoaderService } from '../../core/utils/ui-loader.service';
import { UploadDropzoneComponent } from '../../shared/components/upload-dropzone/upload-dropzone.component';

type CropRect = { x: number; y: number; w: number; h: number };
type AlineacionTexto = 'left' | 'center' | 'right';
type FuenteTexto = 'Arial' | 'Times New Roman' | 'Courier New' | 'Verdana';

type EstiloTexto = {
  fontSize: number;
  fontFamily: FuenteTexto;
  bold: boolean;
  italic: boolean;
  color: string;
  align: AlineacionTexto;
  hasBackground: boolean;
};

type ArchivoEditor = {
  id: string;
  file: File;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  naturalWidth: number;
  naturalHeight: number;
  cropRect: CropRect;
};

type TextoEditor = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  text: string;
  style: EstiloTexto;
};

type ArchivoAnexo = { id: string; file: File };
type MedidaHoja = { width: number; height: number };

type DragState = {
  kind: 'image' | 'text';
  id: string;
  startXClient: number;
  startYClient: number;
  startX: number;
  startY: number;
};

type ResizeState = {
  kind: 'image' | 'text';
  id: string;
  startXClient: number;
  startYClient: number;
  startWidth: number;
  startHeight: number;
};

type CropBoxDragState = {
  fileId: string;
  mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
  startXClient: number;
  startYClient: number;
  startRect: CropRect;
  displayW: number;
  displayH: number;
};

type TourFabDrag = {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
};

@Component({
  selector: 'app-cliente',
  imports: [CommonModule, ReactiveFormsModule, FormsModule, UploadDropzoneComponent, DragDropModule],
  templateUrl: './cliente.component.html',
  styleUrl: './cliente.component.scss',
})
export class ClienteComponent implements OnDestroy, AfterViewInit {
  @ViewChild('hojaRef') hojaRef?: ElementRef<HTMLDivElement>;
  @ViewChild('canvasWrapperRef') canvasWrapperRef?: ElementRef<HTMLDivElement>;
  @ViewChild('inputNuevaImagen') inputNuevaImagen?: ElementRef<HTMLInputElement>;

  readonly form;
  readonly fuentesTexto: FuenteTexto[] = ['Arial', 'Times New Roman', 'Courier New', 'Verdana'];

  elementosDiseno: ArchivoEditor[] = [];
  textosDiseno: TextoEditor[] = [];
  anexosPdf: ArchivoAnexo[] = [];

  cargando = false;
  mensaje = '';
  pdfUrl = '';
  mostrarEditor = true;
  mostrarVistaPrevia = false;

  paginaActual = 1;
  zoom = 100;
  autoAjusteMovil = true;
  esMovil = false;
  ajustarRejilla = true;
  readonly gridSize = 12;

  autoPorHoja = 3;
  opcionesAutoPorHoja = Array.from({ length: 20 }, (_, i) => i + 1);

  archivoSeleccionadoId: string | null = null;
  textoSeleccionadoId: string | null = null;
  cropModeFileId: string | null = null;

  menuContextual = {
    visible: false,
    x: 0,
    y: 0,
    target: 'canvas' as 'canvas' | 'image' | 'text',
    fileId: '' as string,
    textId: '' as string,
    canvasX: 40,
    canvasY: 40,
  };

  private readonly previews = new Map<string, string>();
  private readonly tourStorageKey = 'papeleria_cliente_tour_v1';
  private dragState: DragState | null = null;
  private resizeState: ResizeState | null = null;
  private cropBoxDragState: CropBoxDragState | null = null;
  private rafId: number | null = null;
  private puntoInsercionImagen: { x: number; y: number; page: number } | null = null;
  private tourInstancia: Driver | null = null;
  private tourFabDrag: TourFabDrag | null = null;
  private bloquearClickTourFab = false;

  tourFabX = typeof window !== 'undefined' ? Math.max(12, window.innerWidth - 102) : 18;
  tourFabY = typeof window !== 'undefined' ? Math.max(12, window.innerHeight - 92) : 18;

  constructor(
    private readonly fb: FormBuilder,
    private readonly ordersApi: OrdersApi,
    private readonly cdr: ChangeDetectorRef,
    private readonly uiLoader: UiLoaderService,
  ) {
    this.form = this.fb.nonNullable.group({
      customer_name: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      notes: [''],
      bnColor: this.fb.nonNullable.control<'BN' | 'COLOR'>('BN'),
      size: this.fb.nonNullable.control<'CARTA' | 'OFICIO' | 'A4'>('CARTA'),
      copies: this.fb.nonNullable.control(1),
    });
  }

  ngAfterViewInit(): void {
    this.actualizarEstadoMovil();
    this.ajustarTourFabALimites();
    this.scheduleRender();
    setTimeout(() => this.iniciarGuiaPrimerIngreso(), 250);
  }

  ngOnDestroy(): void {
    this.previews.forEach((url) => URL.revokeObjectURL(url));
    this.previews.clear();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.liberarEventosTourFab();
    if (this.tourInstancia) {
      this.tourInstancia.destroy();
      this.tourInstancia = null;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.actualizarEstadoMovil();
    this.ajustarTourFabALimites();
    this.scheduleRender();
  }

  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) {
      return;
    }

    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (!text) {
      return;
    }

    event.preventDefault();
    this.agregarTextoSuperpuesto(text, this.menuContextual.canvasX, this.menuContextual.canvasY);
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea')) {
      return;
    }

    const ctrlOrCmd = event.ctrlKey || event.metaKey;
    if (ctrlOrCmd && event.key.toLowerCase() === 'c') {
      const text = this.textoSeleccionado?.text?.trim();
      if (text) {
        void navigator.clipboard?.writeText(text);
      }
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      this.eliminarSeleccionado();
    }
  }

  get totalArchivos(): number {
    return this.elementosDiseno.length + this.anexosPdf.length;
  }

  get totalPaginas(): number {
    const maxImagePage = this.elementosDiseno.reduce((acc, item) => Math.max(acc, item.page), 0);
    const maxTextPage = this.textosDiseno.reduce((acc, item) => Math.max(acc, item.page), 0);
    return Math.max(1, maxImagePage, maxTextPage) + 1;
  }

  get paginasVistaPrevia(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i);
  }

  get elementosPaginaActual(): ArchivoEditor[] {
    return this.elementosDiseno.filter((item) => item.page === this.paginaActual - 1);
  }

  get textosPaginaActual(): TextoEditor[] {
    return this.textosDiseno.filter((item) => item.page === this.paginaActual - 1);
  }

  get textoSeleccionado(): TextoEditor | null {
    if (!this.textoSeleccionadoId) {
      return null;
    }
    return this.textosDiseno.find((t) => t.id === this.textoSeleccionadoId) ?? null;
  }

  get zoomEfectivo(): number {
    if (!this.esMovil || !this.autoAjusteMovil) {
      return this.zoom;
    }

    const wrapper = this.canvasWrapperRef?.nativeElement;
    if (!wrapper) {
      return this.zoom;
    }

    const hoja = this.medidaHojaActual();
    const innerWidth = Math.max(120, wrapper.clientWidth - 10);
    const fit = (innerWidth / hoja.width) * 100;
    return this.clamp(fit, 35, 100);
  }

  get imagenSeleccionada(): ArchivoEditor | null {
    if (!this.archivoSeleccionadoId) {
      return null;
    }
    return this.elementosDiseno.find((f) => f.id === this.archivoSeleccionadoId) ?? null;
  }

  agregarArchivos(files: File[]): void {
    const capacidadDisponible = 25 - this.totalArchivos;
    const filesRecortados = files.slice(0, Math.max(0, capacidadDisponible));

    const imagenes = filesRecortados.filter((f) => f.type.startsWith('image/'));
    const pdfs = filesRecortados.filter((f) => f.type === 'application/pdf');
    const noSoportados = filesRecortados.filter((f) => !f.type.startsWith('image/') && f.type !== 'application/pdf');

    const punto = this.puntoInsercionImagen;
    const nuevosImagenes = imagenes.map((file, idx) => ({
      id: this.crearIdArchivo(),
      file,
      page: punto?.page ?? 0,
      x: (punto?.x ?? 24) + idx * 24,
      y: (punto?.y ?? 24) + idx * 24,
      width: 280,
      height: 180,
      zIndex: this.siguienteZIndexImagen(),
      naturalWidth: 1000,
      naturalHeight: 1000,
      cropRect: { x: 0, y: 0, w: 1, h: 1 },
    }));
    this.puntoInsercionImagen = null;

    for (const item of nuevosImagenes) {
      this.cargarDimensionesNaturales(item);
      this.ajustarDentroHoja(item, true);
    }

    const nuevosAnexos = pdfs.map((file) => ({ id: this.crearIdArchivo(), file }));
    this.elementosDiseno = [...this.elementosDiseno, ...nuevosImagenes];
    this.anexosPdf = [...this.anexosPdf, ...nuevosAnexos];

    if (noSoportados.length) {
      void Swal.fire({
        icon: 'warning',
        title: 'Formato no soportado',
        text: 'Solo se permiten imagenes y PDF en este MVP.',
      });
    }
  }

  onNuevaImagenSeleccionada(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (files.length) {
      this.agregarArchivos(files);
    }
    input.value = '';
  }

  drop(event: CdkDragDrop<ArchivoEditor[]>): void {
    const pageItems = this.elementosPaginaActual;
    moveItemInArray(pageItems, event.previousIndex, event.currentIndex);
    const otherItems = this.elementosDiseno.filter((it) => it.page !== this.paginaActual - 1);
    this.elementosDiseno = [...otherItems, ...pageItems];
  }

  dropAnexos(event: CdkDragDrop<ArchivoAnexo[]>): void {
    moveItemInArray(this.anexosPdf, event.previousIndex, event.currentIndex);
    this.anexosPdf = [...this.anexosPdf];
  }

  quitarElementoDisenoPorId(id: string): void {
    const idx = this.elementosDiseno.findIndex((f) => f.id === id);
    if (idx < 0) {
      return;
    }

    const [eliminado] = this.elementosDiseno.splice(idx, 1);
    const preview = this.previews.get(eliminado.id);
    if (preview) {
      URL.revokeObjectURL(preview);
      this.previews.delete(eliminado.id);
    }

    this.elementosDiseno = [...this.elementosDiseno];
    if (this.archivoSeleccionadoId === eliminado.id) {
      this.archivoSeleccionadoId = null;
    }
  }

  quitarTextoPorId(id: string): void {
    this.textosDiseno = this.textosDiseno.filter((t) => t.id !== id);
    if (this.textoSeleccionadoId === id) {
      this.textoSeleccionadoId = null;
    }
  }

  quitarAnexo(index: number): void {
    this.anexosPdf.splice(index, 1);
    this.anexosPdf = [...this.anexosPdf];
  }

  medidaHojaActual(): MedidaHoja {
    const size = this.form.getRawValue().size;
    if (size === 'OFICIO') {
      return { width: 816, height: 1344 };
    }
    if (size === 'A4') {
      return { width: 794, height: 1123 };
    }
    return { width: 816, height: 1056 };
  }

  autoAcomodarPorHoja(): void {
    const perPage = Math.max(1, Math.min(20, Number(this.autoPorHoja || 3)));
    const hoja = this.medidaHojaActual();
    const margin = 20;
    const cols = Math.ceil(Math.sqrt(perPage));
    const rows = Math.ceil(perPage / cols);
    const cellW = Math.max(80, Math.floor((hoja.width - margin * (cols + 1)) / cols));
    const cellH = Math.max(80, Math.floor((hoja.height - margin * (rows + 1)) / rows));

    this.elementosDiseno = this.elementosDiseno.map((item, index) => {
      const page = Math.floor(index / perPage);
      const slot = index % perPage;
      const row = Math.floor(slot / cols);
      const col = slot % cols;
      return {
        ...item,
        page,
        x: margin + col * (cellW + margin),
        y: margin + row * (cellH + margin),
        width: cellW,
        height: cellH,
      };
    });

    this.paginaActual = 1;
    this.scheduleRender();
  }

  seleccionarArchivo(item: ArchivoEditor): void {
    this.archivoSeleccionadoId = item.id;
    this.textoSeleccionadoId = null;
    item.zIndex = this.siguienteZIndexImagen();
    this.scheduleRender();
  }

  seleccionarTexto(item: TextoEditor): void {
    this.textoSeleccionadoId = item.id;
    this.archivoSeleccionadoId = null;
    item.zIndex = this.siguienteZIndexTexto();
    this.scheduleRender();
  }

  obtenerPreview(item: ArchivoEditor): string {
    const existing = this.previews.get(item.id);
    if (existing) {
      return existing;
    }
    const url = URL.createObjectURL(item.file);
    this.previews.set(item.id, url);
    return url;
  }

  getRenderedImageStyle(item: ArchivoEditor): Record<string, string> {
    const crop = item.cropRect;
    const safeW = Math.max(0.01, crop.w);
    const safeH = Math.max(0.01, crop.h);
    const cropWpx = item.naturalWidth * safeW;
    const cropHpx = item.naturalHeight * safeH;
    const scale = Math.max(item.width / cropWpx, item.height / cropHpx);
    const drawW = item.naturalWidth * scale;
    const drawH = item.naturalHeight * scale;

    const cropCenterX = (crop.x + safeW / 2) * item.naturalWidth * scale;
    const cropCenterY = (crop.y + safeH / 2) * item.naturalHeight * scale;
    const drawX = item.width / 2 - cropCenterX;
    const drawY = item.height / 2 - cropCenterY;

    return {
      width: `${drawW}px`,
      height: `${drawH}px`,
      transform: `translate(${drawX}px, ${drawY}px)`,
    };
  }

  getCropOverlayStyle(item: ArchivoEditor): Record<string, string> {
    const view = this.getContainViewRect(item);
    const rect = item.cropRect;
    return {
      left: `${view.x + rect.x * view.w}px`,
      top: `${view.y + rect.y * view.h}px`,
      width: `${rect.w * view.w}px`,
      height: `${rect.h * view.h}px`,
    };
  }

  getContainViewRect(item: ArchivoEditor): { x: number; y: number; w: number; h: number } {
    const scale = Math.min(item.width / item.naturalWidth, item.height / item.naturalHeight);
    const w = item.naturalWidth * scale;
    const h = item.naturalHeight * scale;
    const x = (item.width - w) / 2;
    const y = (item.height - h) / 2;
    return { x, y, w, h };
  }

  getTextStyle(texto: TextoEditor): Record<string, string> {
    return {
      fontSize: `${texto.style.fontSize}px`,
      fontFamily: texto.style.fontFamily,
      fontWeight: texto.style.bold ? '700' : '400',
      fontStyle: texto.style.italic ? 'italic' : 'normal',
      color: texto.style.color,
      textAlign: texto.style.align,
      lineHeight: '1.25',
    };
  }

  abrirMenuContextualCanvas(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const point = this.clientToCanvas(event.clientX, event.clientY);
    this.menuContextual = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      target: 'canvas',
      fileId: '',
      textId: '',
      canvasX: point.x,
      canvasY: point.y,
    };
  }

  abrirMenuContextualImagen(event: MouseEvent, item: ArchivoEditor): void {
    event.preventDefault();
    event.stopPropagation();
    this.seleccionarArchivo(item);
    const point = this.clientToCanvas(event.clientX, event.clientY);
    this.menuContextual = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      target: 'image',
      fileId: item.id,
      textId: '',
      canvasX: point.x,
      canvasY: point.y,
    };
  }

  abrirMenuContextualTexto(event: MouseEvent, item: TextoEditor): void {
    event.preventDefault();
    event.stopPropagation();
    this.seleccionarTexto(item);
    const point = this.clientToCanvas(event.clientX, event.clientY);
    this.menuContextual = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      target: 'text',
      fileId: '',
      textId: item.id,
      canvasX: point.x,
      canvasY: point.y,
    };
  }

  cerrarMenuContextual(): void {
    this.menuContextual.visible = false;
  }

  activarEdicionInlineDesdeMenu(): void {
    const text = this.textosDiseno.find((t) => t.id === this.menuContextual.textId);
    if (!text) {
      this.cerrarMenuContextual();
      return;
    }
    this.seleccionarTexto(text);
    this.cerrarMenuContextual();
  }

  toggleFondoTextoDesdeMenu(): void {
    const text = this.textosDiseno.find((t) => t.id === this.menuContextual.textId);
    if (!text) {
      this.cerrarMenuContextual();
      return;
    }
    text.style.hasBackground = !text.style.hasBackground;
    this.scheduleRender();
    this.cerrarMenuContextual();
  }

  toggleNegritaTextoDesdeMenu(): void {
    const text = this.textosDiseno.find((t) => t.id === this.menuContextual.textId);
    if (!text) {
      this.cerrarMenuContextual();
      return;
    }
    text.style.bold = !text.style.bold;
    this.scheduleRender();
    this.cerrarMenuContextual();
  }

  toggleCursivaTextoDesdeMenu(): void {
    const text = this.textosDiseno.find((t) => t.id === this.menuContextual.textId);
    if (!text) {
      this.cerrarMenuContextual();
      return;
    }
    text.style.italic = !text.style.italic;
    this.scheduleRender();
    this.cerrarMenuContextual();
  }

  alinearTextoDesdeMenu(align: AlineacionTexto): void {
    const text = this.textosDiseno.find((t) => t.id === this.menuContextual.textId);
    if (!text) {
      this.cerrarMenuContextual();
      return;
    }
    text.style.align = align;
    this.scheduleRender();
    this.cerrarMenuContextual();
  }

  onTextoInlineInput(item: TextoEditor, event: Event): void {
    void item;
    void event;
  }

  onTextoInlineFocus(item: TextoEditor): void {
    this.seleccionarTexto(item);
  }

  onTextoInlineBlur(item: TextoEditor, event: FocusEvent): void {
    const el = event.target as HTMLElement;
    item.text = (el.innerText || '').trim();
    this.scheduleRender();
  }

  verGuia(): void {
    this.iniciarGuia(true);
  }

  abrirVistaPrevia(): void {
    if (this.totalArchivos === 0) {
      this.mensaje = 'Agrega archivos antes de abrir la vista previa.';
      return;
    }
    this.cerrarMenuContextual();
    this.mostrarVistaPrevia = true;
  }

  cerrarVistaPrevia(): void {
    this.mostrarVistaPrevia = false;
  }

  enviarDesdeVistaPrevia(): void {
    this.mostrarVistaPrevia = false;
    this.enviarPedido();
  }

  elementosDePagina(page: number): ArchivoEditor[] {
    return this.elementosDiseno.filter((item) => item.page === page);
  }

  textosDePagina(page: number): TextoEditor[] {
    return this.textosDiseno.filter((item) => item.page === page);
  }

  anchoMiniHoja(): number {
    return Math.round(this.medidaHojaActual().width * this.escalaVistaPrevia());
  }

  altoMiniHoja(): number {
    return Math.round(this.medidaHojaActual().height * this.escalaVistaPrevia());
  }

  escalaVistaPrevia(): number {
    const hoja = this.medidaHojaActual();
    const targetWidth = this.esMovil ? 220 : 280;
    return this.clamp(targetWidth / hoja.width, 0.18, 0.4);
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
    this.verGuia();
  }

  agregarTextoDesdeMenu(): void {
    this.agregarTextoSuperpuesto('Texto superpuesto', this.menuContextual.canvasX, this.menuContextual.canvasY);
    this.cerrarMenuContextual();
  }

  agregarImagenDesdeMenu(): void {
    this.puntoInsercionImagen = {
      x: this.menuContextual.canvasX,
      y: this.menuContextual.canvasY,
      page: this.paginaActual - 1,
    };
    this.cerrarMenuContextual();
    this.inputNuevaImagen?.nativeElement.click();
  }

  activarRecorteDesdeMenu(): void {
    const item = this.elementosDiseno.find((f) => f.id === this.menuContextual.fileId);
    if (!item) {
      this.cerrarMenuContextual();
      return;
    }
    this.cropModeFileId = item.id;
    this.archivoSeleccionadoId = item.id;
    this.cerrarMenuContextual();
  }

  iniciarArrastreImagen(event: PointerEvent, item: ArchivoEditor): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('resize-handle') || target.classList.contains('crop-overlay') || target.classList.contains('crop-handle')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.seleccionarArchivo(item);

    this.dragState = {
      kind: 'image',
      id: item.id,
      startXClient: event.clientX,
      startYClient: event.clientY,
      startX: item.x,
      startY: item.y,
    };

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  iniciarArrastreTexto(event: PointerEvent, item: TextoEditor): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('resize-handle') || target.classList.contains('quitar-objeto') || target.closest('.texto-contenido')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.seleccionarTexto(item);

    this.dragState = {
      kind: 'text',
      id: item.id,
      startXClient: event.clientX,
      startYClient: event.clientY,
      startX: item.x,
      startY: item.y,
    };

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  iniciarResizeImagen(event: PointerEvent, item: ArchivoEditor): void {
    event.preventDefault();
    event.stopPropagation();
    this.seleccionarArchivo(item);

    this.resizeState = {
      kind: 'image',
      id: item.id,
      startXClient: event.clientX,
      startYClient: event.clientY,
      startWidth: item.width,
      startHeight: item.height,
    };

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  iniciarResizeTexto(event: PointerEvent, item: TextoEditor): void {
    event.preventDefault();
    event.stopPropagation();
    this.seleccionarTexto(item);

    this.resizeState = {
      kind: 'text',
      id: item.id,
      startXClient: event.clientX,
      startYClient: event.clientY,
      startWidth: item.width,
      startHeight: item.height,
    };

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  iniciarDragCropBox(event: PointerEvent, item: ArchivoEditor, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'): void {
    if (this.cropModeFileId !== item.id) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const view = this.getContainViewRect(item);
    this.cropBoxDragState = {
      fileId: item.id,
      mode,
      startXClient: event.clientX,
      startYClient: event.clientY,
      startRect: { ...item.cropRect },
      displayW: view.w,
      displayH: view.h,
    };

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  actualizarTextoSeleccionado(valor: string): void {
    const text = this.textoSeleccionado;
    if (!text) {
      return;
    }
    text.text = valor;
    this.scheduleRender();
  }

  actualizarEstiloTexto(
    key: keyof EstiloTexto,
    value: string | number | boolean,
  ): void {
    const text = this.textoSeleccionado;
    if (!text) {
      return;
    }
    (text.style as Record<string, unknown>)[key] = value;
    this.scheduleRender();
  }

  eliminarSeleccionado(): void {
    if (this.archivoSeleccionadoId) {
      this.quitarElementoDisenoPorId(this.archivoSeleccionadoId);
      return;
    }
    if (this.textoSeleccionadoId) {
      this.quitarTextoPorId(this.textoSeleccionadoId);
    }
  }

  private agregarTextoSuperpuesto(texto: string, x: number, y: number): void {
    const nuevo: TextoEditor = {
      id: this.crearIdArchivo(),
      page: this.paginaActual - 1,
      x,
      y,
      width: 300,
      height: 130,
      zIndex: this.siguienteZIndexTexto(),
      text: texto,
      style: {
        fontSize: 30,
        fontFamily: 'Arial',
        bold: false,
        italic: false,
        color: '#111827',
        align: 'left',
        hasBackground: true,
      },
    };
    this.ajustarDentroHoja(nuevo, true);
    this.textosDiseno = [...this.textosDiseno, nuevo];
    this.textoSeleccionadoId = nuevo.id;
    this.archivoSeleccionadoId = null;
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragState) {
      const item = this.dragState.kind === 'image'
        ? this.elementosDiseno.find((f) => f.id === this.dragState!.id)
        : this.textosDiseno.find((f) => f.id === this.dragState!.id);
      if (!item) {
        return;
      }

      item.x = this.dragState.startX + (event.clientX - this.dragState.startXClient);
      item.y = this.dragState.startY + (event.clientY - this.dragState.startYClient);
      this.ajustarDentroHoja(item, false);
      this.scheduleRender();
      return;
    }

    if (this.resizeState) {
      const item = this.resizeState.kind === 'image'
        ? this.elementosDiseno.find((f) => f.id === this.resizeState!.id)
        : this.textosDiseno.find((f) => f.id === this.resizeState!.id);
      if (!item) {
        return;
      }

      const deltaX = event.clientX - this.resizeState.startXClient;
      const deltaY = event.clientY - this.resizeState.startYClient;
      item.width = Math.max(80, this.resizeState.startWidth + deltaX);
      item.height = Math.max(60, this.resizeState.startHeight + deltaY);
      this.ajustarDentroHoja(item, false);
      this.scheduleRender();
      return;
    }

    if (this.cropBoxDragState) {
      const item = this.elementosDiseno.find((f) => f.id === this.cropBoxDragState!.fileId);
      if (!item) {
        return;
      }

      const state = this.cropBoxDragState;
      const dx = (event.clientX - state.startXClient) / Math.max(1, state.displayW);
      const dy = (event.clientY - state.startYClient) / Math.max(1, state.displayH);
      item.cropRect = this.computeCropRect(state.startRect, state.mode, dx, dy);
      this.scheduleRender();
    }
  };

  private readonly onPointerUp = (): void => {
    this.dragState = null;
    this.resizeState = null;
    this.cropBoxDragState = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  };

  private computeCropRect(start: CropRect, mode: CropBoxDragState['mode'], dx: number, dy: number): CropRect {
    const minSize = 0.02;
    const startLeft = start.x;
    const startTop = start.y;
    const startRight = start.x + start.w;
    const startBottom = start.y + start.h;

    let left = startLeft;
    let top = startTop;
    let right = startRight;
    let bottom = startBottom;

    if (mode === 'move') {
      return {
        x: this.clamp(startLeft + dx, 0, 1 - start.w),
        y: this.clamp(startTop + dy, 0, 1 - start.h),
        w: start.w,
        h: start.h,
      };
    }

    if (mode === 'nw') {
      left = this.clamp(startLeft + dx, 0, startRight - minSize);
      top = this.clamp(startTop + dy, 0, startBottom - minSize);
    } else if (mode === 'ne') {
      right = this.clamp(startRight + dx, startLeft + minSize, 1);
      top = this.clamp(startTop + dy, 0, startBottom - minSize);
    } else if (mode === 'sw') {
      left = this.clamp(startLeft + dx, 0, startRight - minSize);
      bottom = this.clamp(startBottom + dy, startTop + minSize, 1);
    } else if (mode === 'se') {
      right = this.clamp(startRight + dx, startLeft + minSize, 1);
      bottom = this.clamp(startBottom + dy, startTop + minSize, 1);
    }

    return { x: left, y: top, w: Math.max(minSize, right - left), h: Math.max(minSize, bottom - top) };
  }

  private ajustarDentroHoja(item: { x: number; y: number; width: number; height: number }, applySnap: boolean): void {
    const hoja = this.medidaHojaActual();
    if (this.ajustarRejilla && applySnap) {
      item.x = this.snap(item.x);
      item.y = this.snap(item.y);
      item.width = this.snap(item.width);
      item.height = this.snap(item.height);
    }
    item.width = Math.min(item.width, hoja.width);
    item.height = Math.min(item.height, hoja.height);
    item.x = Math.max(0, Math.min(item.x, hoja.width - item.width));
    item.y = Math.max(0, Math.min(item.y, hoja.height - item.height));
  }

  private clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const hojaEl = this.hojaRef?.nativeElement;
    if (!hojaEl) {
      return { x: 40, y: 40 };
    }
    const rect = hojaEl.getBoundingClientRect();
    const scale = this.zoomEfectivo / 100;
    const hoja = this.medidaHojaActual();
    return {
      x: this.clamp((clientX - rect.left) / scale, 0, hoja.width - 20),
      y: this.clamp((clientY - rect.top) / scale, 0, hoja.height - 20),
    };
  }

  private actualizarEstadoMovil(): void {
    this.esMovil = window.matchMedia('(max-width: 900px)').matches;
  }

  private siguienteZIndexImagen(): number {
    return this.elementosDiseno.reduce((acc, item) => Math.max(acc, item.zIndex || 1), 1) + 1;
  }

  private siguienteZIndexTexto(): number {
    return this.textosDiseno.reduce((acc, item) => Math.max(acc, item.zIndex || 1000), 1000) + 1;
  }

  private cargarDimensionesNaturales(item: ArchivoEditor): void {
    const url = this.obtenerPreview(item);
    const img = new Image();
    img.onload = () => {
      item.naturalWidth = img.naturalWidth || 1000;
      item.naturalHeight = img.naturalHeight || 1000;
      this.scheduleRender();
    };
    img.src = url;
  }

  private scheduleRender(): void {
    if (this.rafId) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.elementosDiseno = [...this.elementosDiseno];
      this.textosDiseno = [...this.textosDiseno];
      this.cdr.detectChanges();
    });
  }

  private snap(value: number): number {
    return Math.round(value / this.gridSize) * this.gridSize;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private crearIdArchivo(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  }

  private mapUploadedIdsInOrder(uploaded: { id: string; original_name: string }[], orderedFiles: File[]): string[] {
    const used = new Set<number>();
    const result: string[] = [];

    for (const file of orderedFiles) {
      const idx = uploaded.findIndex((u, i) => u.original_name === file.name && !used.has(i));
      if (idx >= 0) {
        used.add(idx);
        result.push(uploaded[idx].id);
      }
    }

    for (let i = 0; i < uploaded.length; i += 1) {
      if (!used.has(i)) {
        result.push(uploaded[i].id);
      }
    }

    return result;
  }

  enviarPedido(): void {
    if (this.form.invalid || this.totalArchivos === 0) {
      this.mensaje = 'Completa el formulario y agrega al menos un archivo.';
      return;
    }

    this.cargando = true;
    this.uiLoader.showFor(1800, 'Enviando documento...');
    this.mensaje = '';
    this.pdfUrl = '';

    const raw = this.form.getRawValue();

    const layout = [
      ...this.elementosDiseno.map((item, index) => ({
        orden: index + 1,
        kind: 'IMAGE',
        fileName: item.file.name,
        page: item.page,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        zIndex: item.zIndex,
        cropRect: item.cropRect,
        hoja: raw.size,
      })),
      ...this.textosDiseno.map((item, index) => ({
        orden: this.elementosDiseno.length + index + 1,
        kind: 'TEXT',
        text: item.text,
        page: item.page,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        zIndex: item.zIndex + 100000,
        textStyle: item.style,
        hoja: raw.size,
      })),
    ];

    this.ordersApi
      .createOrder({
        customer_name: raw.customer_name,
        phone: raw.phone || undefined,
        notes: raw.notes || undefined,
        options: {
          bnColor: raw.bnColor,
          size: raw.size,
          copies: raw.copies,
          designerEnabled: true,
          autoPerPage: this.autoPorHoja,
          layout,
        },
      })
      .subscribe({
        next: (order) => {
          const orderedFiles = [...this.elementosDiseno.map((item) => item.file), ...this.anexosPdf.map((item) => item.file)];

          this.ordersApi.uploadFiles(order.id, orderedFiles).subscribe({
            next: (uploaded) => {
              const orderedIds = this.mapUploadedIdsInOrder(uploaded, orderedFiles);
              this.ordersApi.reorderFiles(order.id, orderedIds).subscribe({
                next: () => {
                  this.ordersApi
                    .compileOrder(order.id)
                    .pipe(finalize(() => (this.cargando = false)))
                    .subscribe({
                      next: () => {
                        this.mensaje = `Listo, folio: ${order.folio}`;
                        this.pdfUrl = this.ordersApi.getCompiledPdfUrl(order.id);
                        void Swal.fire({
                          icon: 'success',
                          title: 'Pedido enviado',
                          text: `Tu pedido ${order.folio} se envio correctamente.`,
                          confirmButtonText: 'Perfecto',
                        });
                      },
                      error: () => {
                        this.mensaje = 'No se pudo compilar el PDF.';
                      },
                    });
                },
                error: () => {
                  this.cargando = false;
                  this.mensaje = 'No se pudo guardar el orden final de los archivos.';
                },
              });
            },
            error: () => {
              this.cargando = false;
              this.mensaje = 'Error al subir archivos.';
            },
          });
        },
        error: () => {
          this.cargando = false;
          this.mensaje = 'Error al crear el pedido.';
        },
      });
  }

  private iniciarGuiaPrimerIngreso(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const yaVisto = localStorage.getItem(this.tourStorageKey) === '1';
    if (yaVisto) {
      return;
    }
    this.iniciarGuia(false);
  }

  private iniciarGuia(forzar: boolean): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (this.tourInstancia) {
      this.tourInstancia.destroy();
      this.tourInstancia = null;
    }

    const pasos = [
      {
        element: '[data-tour="cliente-form"]',
        popover: {
          title: '1. Datos del pedido',
          description: 'Aqui capturas nombre, telefono, notas y opciones de impresion.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-tour="cliente-upload"]',
        popover: {
          title: '2. Subir archivos',
          description: 'Arrastra o selecciona imagenes y PDF. Las imagenes entran al diseno y los PDF quedan como anexos.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-tour="cliente-lista"]',
        popover: {
          title: '3. Lista de imagenes',
          description: 'Desde aqui puedes editar, quitar y ordenar el flujo antes de compilar.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-tour="cliente-toolbar"]',
        popover: {
          title: '4. Herramientas',
          description: 'Usa zoom, auto por hoja, anadir texto e imagen para acomodar como en Word.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-tour="cliente-auto-hoja"]',
        popover: {
          title: '5. Auto acomodo',
          description: 'Selecciona cuantas imagenes quieres por hoja y luego pulsa "Aplicar auto" para acomodarlas automaticamente.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-tour="cliente-canvas"]',
        popover: {
          title: '6. Canvas de diseno',
          description: 'Aqui arrastras, redimensionas, recortas y colocas texto libremente.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '[data-tour="cliente-enviar"]',
        popover: {
          title: '7. Enviar pedido',
          description: 'Cuando todo este listo, envia para compilar y generar el PDF final.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '[data-tour="cliente-tour-fab"]',
        popover: {
          title: '8. Boton flotante',
          description: 'Puedes mover este boton y tocarlo cuando quieras repetir la guia.',
          side: 'left' as const,
          align: 'center' as const,
        },
      },
    ];

    this.tourInstancia = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayClickBehavior: 'close',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Atras',
      doneBtnText: 'Listo',
      steps: pasos,
      onDestroyed: () => {
        if (!forzar) {
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
