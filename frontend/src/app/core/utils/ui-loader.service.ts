import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

type LoaderState = {
  visible: boolean;
  message: string;
};

@Injectable({ providedIn: 'root' })
export class UiLoaderService {
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stateSubject = new BehaviorSubject<LoaderState>({
    visible: false,
    message: 'Cargando...',
  });

  readonly state$ = this.stateSubject.asObservable();

  showFor(milliseconds: number, message = 'Cargando...'): void {
    const ms = Math.max(250, Math.min(2000, milliseconds));
    this.show(message);
    this.hideAfter(ms);
  }

  show(message = 'Cargando...'): void {
    this.clearHideTimer();
    this.stateSubject.next({ visible: true, message });
  }

  hideAfter(milliseconds: number): void {
    const ms = Math.max(150, Math.min(2000, milliseconds));
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.stateSubject.next({ visible: false, message: this.stateSubject.value.message });
      this.hideTimer = null;
    }, ms);
  }

  hide(): void {
    this.clearHideTimer();
    this.stateSubject.next({ visible: false, message: this.stateSubject.value.message });
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
