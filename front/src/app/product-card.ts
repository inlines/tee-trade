import { Component, inject, input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from './admin.service';
import { Product, previewUrl } from './catalog';
@Component({
  selector: 'app-product-card', imports: [RouterLink, CurrencyPipe],
  template: `<a class="product-card" [routerLink]="['/product', product().id]">
    <div class="product-cover"><img [src]="previewUrl()" [alt]="cover().alt" [loading]="priority() ? 'eager' : 'lazy'" [attr.fetchpriority]="priority() ? 'high' : 'auto'" decoding="async" width="640" height="720">
      @if (product().sold) { <span class="demo-badge">Продано</span> }
      @if (!product().sold && product().is_demo) { <span class="demo-badge">Демо</span> }
    </div>
    <div class="product-meta"><span>{{ product().brand }}</span><span>{{ product().release_year }}</span></div>
    <h3>{{ product().name || 'Без названия' }}</h3>
    <p class="price">{{ product().price_cents === null ? 'Цена не указана' : (product().price_cents! / 100 | currency:'RUB':'symbol':'1.0-2':'ru') }}</p>
  </a>
  @if (admin.session()) {
    <a class="product-edit-link text-link" routerLink="/admin" [queryParams]="{edit: product().id}" [attr.aria-label]="'Редактировать товар ‘' + product().name + '’'">Редактировать</a>
  }`,
})
export class ProductCard {
  readonly admin = inject(AdminService);
  readonly priority = input(false);
  readonly product = input.required<Product>();
  previewUrl() { return previewUrl(this.cover().url); }
  cover() { return this.product().images.find(image => image.kind === 'front') ?? this.product().images[0] ?? {url:'/images/no-photo.svg', alt:'Фото пока нет'}; }
}
