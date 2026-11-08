import { Component,inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { startWith,Subject,switchMap } from 'rxjs';
import { CatalogService,loadState } from './catalog';
import { ProductCard } from './product-card';
import { ProductCarousel } from './product-carousel';

@Component({
  selector: 'app-home', imports: [RouterLink, ProductCard, ProductCarousel],
  template: `@if (state(); as state) {
    @if (state.loading) { <div class="home-loading" role="status" aria-label="Загружаем витрину"><div class="carousel-stage skeleton"></div></div> }
    @else if (state.error) { <div class="status" role="alert"><p>{{ state.error }}</p><button class="button" (click)="retry.next()">Повторить</button></div> }
    @else if (state.data; as home) {
      @if (home.settings.carousel_enabled) { <app-product-carousel [products]="home.carousel" /> }
      <div class="home-content">
        @if (home.settings.categories_enabled) {
          <section class="section"><div class="section-heading"><h2>{{ home.settings.arrivals_title }}</h2></div>
            <div class="product-grid">@for (product of home.arrivals; track product.id) {
              <app-product-card [product]="product" />
            } @empty { <p class="status">Скоро здесь появятся новые вещи.</p> }</div>
          </section>
        }
        @if (home.settings.popular_enabled) {
          <section class="section"><div class="section-heading"><div><h2>{{ home.settings.popular_title }}</h2></div><a class="text-link" routerLink="/catalog">Все вещи</a></div>
            <div class="product-grid">@for (product of home.featured; track product.id) { <app-product-card [product]="product" /> } @empty { <p class="status">Скоро здесь появятся первые вещи.</p> }</div>
          </section>
        }
        @if (home.settings.manifesto_enabled) { <section class="manifesto"><p class="eyebrow">{{ home.settings.manifesto_eyebrow }}</p><h2 style="white-space:pre-line">{{ home.settings.manifesto_title }}</h2><a class="text-link" routerLink="/about">{{ home.settings.manifesto_link_text.replaceAll('↗', '').trim() }}</a></section> }
      </div>
    }
  }`,
})
export class HomePage {
  private readonly api = inject(CatalogService);
  readonly retry = new Subject<void>();
  readonly state = toSignal(this.retry.pipe(startWith(undefined), switchMap(() => loadState(this.api.storefront()))));
}
