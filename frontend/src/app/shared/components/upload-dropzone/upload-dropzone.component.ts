import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild } from '@angular/core';
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

  ngAfterViewInit(): void {
    const host = this.dzRef?.nativeElement;
    if (!host) {
      return;
    }

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

    this.dz.on('addedfiles', (archivos: Dropzone.DropzoneFile[]) => {
      const files = archivos.filter((item) => item instanceof File) as unknown as File[];
      if (!files.length) {
        return;
      }
      this.archivosSeleccionados.emit(files);
      setTimeout(() => this.dz?.removeAllFiles(true), 90);
    });
  }

  ngOnDestroy(): void {
    if (this.dz) {
      this.dz.destroy();
      this.dz = null;
    }
  }
}
