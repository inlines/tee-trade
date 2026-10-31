import { Component, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
interface Product { id: number; name: string; price_cents: number; }
@Component({
  selector: 'app-root',
  imports: [CurrencyPipe],
  template: `<header>TEE TRADE <span>Футболки на каждый день</span></header>
    <main><h1>Твоя новая любимая футболка.</h1><p>Базовые вещи. Свободный стиль.</p>
    @if (error()) { <p role="alert">Не удалось загрузить каталог. Попробуйте позже.</p> }
    @else if (loading()) { <p role="status">Загружаем каталог…</p> }
    @else { <section aria-label="Каталог футболок">@for (product of products(); track product.id) {
      <article><div class="shirt" aria-hidden="true">T</div><h2>{{ product.name }}</h2>
      <p>{{ product.price_cents / 100 | currency:'RUB':'symbol':'1.0-0' }}</p></article>
    } @empty { <p>Каталог скоро появится.</p> }</section> }</main>`
})
class App {
  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  constructor() {
    inject(HttpClient).get<Product[]>('/api/products').subscribe({
      next: products => { this.products.set(products); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }
}
bootstrapApplication(App, { providers: [provideHttpClient()] }).catch(console.error);
