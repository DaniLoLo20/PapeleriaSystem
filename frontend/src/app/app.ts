import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { UiLoaderService } from './core/utils/ui-loader.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  loaderVisible = false;
  loaderMessage = 'Cargando...';

  private readonly subs = new Subscription();

  constructor(private readonly uiLoader: UiLoaderService) {}

  ngOnInit(): void {
    this.uiLoader.showFor(1100, 'Cargando papeleria...');

    this.subs.add(
      this.uiLoader.state$.subscribe((state) => {
        this.loaderVisible = state.visible;
        this.loaderMessage = state.message;
      }),
    );

  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  mostrarLoaderCambioVista(): void {
    this.uiLoader.showFor(700, 'Cambiando vista...');
  }
}
