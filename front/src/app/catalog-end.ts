import { ChangeDetectionStrategy, AfterViewInit, Component, DestroyRef, ElementRef, inject, output } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-catalog-end',
  template: '<button class="button" (click)="reached.emit()">Показать ещё</button>',
  styles: ':host { display:flex; justify-content:center; padding:24px 0; }',
})
export class CatalogEnd implements AfterViewInit {
  readonly reached = output<void>();
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly destroy = inject(DestroyRef);
  ngAfterViewInit() {
    const observer = new IntersectionObserver(entries => {
      if(entries.some(entry=>entry.isIntersecting)) { observer.disconnect(); this.reached.emit(); }
    });
    observer.observe(this.element.nativeElement);
    this.destroy.onDestroy(()=>observer.disconnect());
  }
}
