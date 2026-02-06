import { AfterViewInit, Component, ElementRef, EventEmitter, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import Dropzone from 'dropzone';

@Component({
  selector: 'app-upload-dropzone',
  imports: [CommonModule],
  templateUrl: './upload-dropzone.component.html',
  styleUrl: './upload-dropzone.component.scss',
})
export class UploadDropzoneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('dzRef') dzRef?: ElementRef<HTMLDivElement>;
  @Output() archivosSeleccionados = new EventEmitter<File[]>();
  private dz: Dropzone | null = null;
  private hostEl: HTMLDivElement | null = null;
  private pendingFiles: File[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly ngZone: NgZone) {}

  ngAfterViewInit(): void {
    const host = this.dzRef?.nativeElement;
    if (!host) {
      return;
    }
    this.hostEl = host;

    this.dz = new Dropzone(host, {
      url: '/noop',
      method: 'post',
      autoProcessQueue: false,
      uploadMultiple: true,
      parallelUploads: 25,
      maxFiles: 25,
      maxFilesize: 50,
      acceptedFiles: 'image/*,application/pdf',
      clickable: '.dz-click-target',
      addRemoveLinks: false,
      dictDefaultMessage: '',
      dictInvalidFileType: 'Solo se permiten imagenes y PDF.',
      dictFileTooBig: 'Archivo muy grande. Maximo: 50MB.',
      dictMaxFilesExceeded: 'Maximo 25 archivos por pedido.',
      previewTemplate: '<div class="dz-preview dz-file-preview"><div class="dz-details"><div class="dz-filename"><span data-dz-name></span></div><div class="dz-size" data-dz-size></div></div></div>',
    });

    this.dz.on('addedfile', (payload: unknown) => {
      const files = this.normalizeFiles(payload);
      if (!files.length) {
        return;
      }
      this.pendingFiles.push(...files);
      this.programarFlush();
    });

    this.dz.on('removedfile', () => {
      this.resetVisualState();
    });
  }

  ngOnDestroy(): void {
    if (this.dz) {
      this.dz.destroy();
      this.dz = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private resetVisualState(): void {
    this.hostEl?.classList.remove('dz-started');
  }

  private emitirYLimpiar(files: File[]): void {
    this.ngZone.runOutsideAngular(() => {
      setTimeout(() => {
        this.ngZone.run(() => this.archivosSeleccionados.emit(files));
        this.dz?.removeAllFiles(true);
        this.resetVisualState();
      }, 0);
    });
  }

  private programarFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const lote = [...this.pendingFiles];
      this.pendingFiles = [];
      if (!lote.length) {
        return;
      }
      this.emitirYLimpiar(lote);
    }, 40);
  }

  private normalizeFiles(payload: unknown): File[] {
    if (!payload) {
      return [];
    }

    if (payload instanceof File) {
      return [payload];
    }

    if (Array.isArray(payload)) {
      return this.collectFiles(payload);
    }

    if (typeof payload === 'object' && payload !== null && 'length' in payload) {
      return this.collectFiles(Array.from(payload as ArrayLike<unknown>));
    }

    return [];
  }

  private collectFiles(items: unknown[]): File[] {
    const out: File[] = [];
    for (const item of items) {
      if (item instanceof File) {
        out.push(item);
      }
    }
    return out;
  }
}
