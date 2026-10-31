import { Component, DestroyRef, afterNextRender, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from './catalog';

@Component({
  selector: 'app-product-carousel', imports: [RouterLink],
  template: `<section class="product-carousel" aria-roledescription="карусель" aria-label="Галерея товаров"
      (keydown.arrowleft)="onArrow($event, -1)" (keydown.arrowright)="onArrow($event, 1)">
    @if (loading()) { <p class="status" role="status">Загружаем галерею…</p> }
    @else if (error()) { <div class="status" role="alert"><p>{{ error() }}</p><button class="button" (click)="retry.emit()">Повторить</button></div> }
    @else if (current(); as product) {
      <div class="carousel-stage" (touchstart)="onTouchStart($event)" (touchend)="onTouchEnd($event)">
        @for (item of products(); track item.id; let i = $index) {
          <div class="carousel-slide" [class.is-current]="i === index()" [attr.aria-hidden]="i !== index()" aria-roledescription="слайд" [attr.aria-label]="(i + 1) + ' из ' + products().length">
            <img class="carousel-backdrop" [src]="cover(item).url" alt="" aria-hidden="true" [loading]="i === 0 ? 'eager' : 'lazy'">
            <a class="carousel-product-link" [routerLink]="['/product', item.id]" [attr.tabindex]="i === index() ? 0 : -1" [attr.aria-label]="'Подробнее: ' + item.name" (click)="onProductClick($event)">
              <img class="carousel-photo" [src]="cover(item).url" [alt]="cover(item).alt" [loading]="i === 0 ? 'eager' : 'lazy'" [attr.fetchpriority]="i === 0 ? 'high' : 'auto'" draggable="false">
            </a>
          </div>
        }
        @if (product.is_demo) { <span class="carousel-demo">Демонстрационная иллюстрация</span> }
        @if (products().length > 1) {
          <button class="carousel-arrow previous" aria-label="Предыдущий товар" (click)="move(-1)">←</button>
          <button class="carousel-arrow next" aria-label="Следующий товар" (click)="move(1)">→</button>
        }
      </div>
    } @else { <div class="status"><h1>Коллекция скоро появится</h1><a class="text-link" routerLink="/catalog">Перейти в каталог →</a></div> }
  </section>`,
})
export class ProductCarousel {
  readonly products = input<Product[]>([]);
  readonly loading = input(false);
  readonly error = input('');
  readonly retry = output<void>();
  readonly selected = signal(0);
  readonly index = computed(() => this.selected() % Math.max(this.products().length, 1));
  readonly current = computed(() => this.products()[this.index()]);
  readonly reducedMotion = signal(false);
  private readonly hidden = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private touchStart: { x: number; y: number } | null = null;
  private suppressClickUntil = 0;

  constructor() {
    afterNextRender(() => {
      const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
      const updateMotion = () => this.reducedMotion.set(preference.matches);
      const updateVisibility = () => this.hidden.set(document.hidden);
      updateMotion(); updateVisibility();
      preference.addEventListener('change', updateMotion);
      document.addEventListener('visibilitychange', updateVisibility);
      this.destroyRef.onDestroy(() => {
        preference.removeEventListener('change', updateMotion);
        document.removeEventListener('visibilitychange', updateVisibility);
      });
    });
    effect(cleanup => {
      const count = this.products().length;
      if (count < 2 || this.reducedMotion() || this.hidden()) return;
      const current = this.index();
      const timer = window.setTimeout(() => this.selected.set((current + 1) % count), 5000);
      cleanup(() => window.clearTimeout(timer));
    });
  }

  cover(product: Product) { return product.images.find(image => image.kind === 'front') ?? product.images[0] ?? {url:'/images/no-photo.svg', alt:'Фото пока нет'}; }
  select(index: number) { this.selected.set(index); }
  move(direction: number) {
    const count = this.products().length;
    if (count > 1) this.select((this.index() + direction + count) % count);
  }
  onArrow(event: Event, direction: number) { event.preventDefault(); this.move(direction); }
  onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    this.touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  onTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0];
    if (this.touchStart && touch) {
      const dx = touch.clientX - this.touchStart.x;
      const dy = touch.clientY - this.touchStart.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        this.move(dx < 0 ? 1 : -1);
        this.suppressClickUntil = Date.now() + 500;
      }
    }
    this.touchStart = null;
  }
  onProductClick(event: MouseEvent) { if (Date.now() < this.suppressClickUntil) event.preventDefault(); }
}
