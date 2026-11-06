import { CatalogNavigation, parseCatalogNavigation } from './catalog-navigation';
import { CatalogEnd } from './catalog-end';
import { ProgressiveImage } from './progressive-image';
import { RequestsService } from './requests.service';
import { RequestDialog } from './request-dialog';
import { Component, computed, inject, signal, effect, DestroyRef, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map, of, startWith, Subject, switchMap, Subscription } from 'rxjs';
import { CatalogService, categories, categoryName, loadState, LoadState, Product, previewUrl } from './catalog';
import { AdminService } from './admin.service';
import { ChatService } from './chat.service';
import { CustomerService } from './customer.service';
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
  readonly state = toSignal(this.retry.pipe(startWith(undefined), switchMap(() => loadState(combineLatest([this.api.storefront(), this.api.list()]).pipe(map(([home, products]) => ({ ...home, arrivals: [...products].sort((a, b) => b.id - a.id).slice(0, 4) })))))));
}

@Component({
  selector: 'app-catalog', imports: [RouterLink, RouterLinkActive, ProductCard, CatalogEnd],
  template: `<section class="page-intro"><p class="eyebrow"><a routerLink="/">ГЛАВНАЯ</a> / {{ archived ? 'АРХИВ' : 'КАТАЛОГ' }}</p><h1>{{ title() }}</h1></section>
    @if(!archived){<nav class="catalog-tabs" aria-label="Категории каталога"><a routerLink="/catalog" routerLinkActive="selected" [routerLinkActiveOptions]="{exact:true}" ariaCurrentWhenActive="page">Все вещи</a>
      @for (category of categories; track category.slug) { <a [routerLink]="['/catalog', category.slug]" routerLinkActive="selected" ariaCurrentWhenActive="page">{{ category.name }}</a> }</nav>}
    <section class="brand-filter" aria-label="Фильтр по брендам">
      <button class="brand-filter-toggle" type="button" [attr.aria-expanded]="brandsOpen()" aria-controls="catalog-brands" (click)="brandsOpen.set(!brandsOpen())">Бренды @if(selectedBrands().length){<span>({{selectedBrands().length}})</span>} <span aria-hidden="true">{{brandsOpen()?'−':'+'}}</span></button>
      @if(brandsOpen()) { <div id="catalog-brands" class="brand-tags">
        @for(brand of brands(); track brand) { <button type="button" class="brand-tag" [class.selected]="selectedBrands().includes(brand)" [attr.aria-pressed]="selectedBrands().includes(brand)" (click)="toggleBrand(brand)">{{brand}}</button> }
        @if(!brands().length && !loading()){<p>В этой категории пока нет указанных брендов.</p>}
        @if(selectedBrands().length){<button type="button" class="text-link" (click)="selectedBrands.set([])">Сбросить бренды</button>}
      </div>}
    </section>
    @if (!validCategory()) { <div class="status"><h2>Такой категории нет</h2><a routerLink="/catalog" class="text-link">Перейти ко всем вещам →</a></div> }
    @else {
      @if (loading() && !items().length) { <p class="status" role="status">Загружаем вещи…</p> }
      @else {
        <div class="catalog-toolbar"><p>Позиций: {{ total() }}</p><label>Сортировка <select [value]="sort()" (change)="setSort($event)"><option value="default">По умолчанию</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option></select></label></div>
        <div class="product-grid">@for (product of items(); track product.id; let i = $index) { <app-product-card [product]="product" [priority]="i < 2" [catalogQuery]="productQuery(i)" /> } @empty { @if(!error()){ <div class="status"><h2>{{archived?'В архиве пока нет товаров':'В этой категории пока нет вещей'}}</h2><a routerLink="/catalog" class="text-link">Посмотреть весь каталог →</a></div> } }</div>
        @if (loading()) { <p class="status" role="status">Загружаем вещи…</p> }
        @else if (error()) { <div class="status" role="alert"><p>{{error()}}</p><button class="button" (click)="loadMore()">Повторить</button></div> }
        @else if (hasMore()) { <app-catalog-end (reached)="loadMore()" /> }
        @if (hasDemo()) { <p class="demo-note">Демо-коллекция: товары и иллюстрации показывают устройство каталога. Фотографии реальных вещей будут добавлены отдельно.</p> }
      }
    }`,
})
export class CatalogPage {
  readonly categories = categories;
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CatalogService);
  readonly category = toSignal(this.route.paramMap.pipe(map(params => params.get('category') ?? '')), { initialValue: '' });
  readonly validCategory = computed(() => !this.category() || categories.some(category => category.slug === this.category()));
  readonly archived = this.route.snapshot.data['archive']===true;
  readonly title = computed(() => this.archived ? 'Архив' : this.validCategory() ? (this.category() ? categoryName(this.category()) : 'Каталог') : 'Категория не найдена');
  readonly brandsOpen = signal(false);
  readonly brands = signal<string[]>([]);
  readonly selectedBrands = signal<string[]>([]);
  private lastCategory = '';
  toggleBrand(brand:string) { this.selectedBrands.update(values=>values.includes(brand)?values.filter(value=>value!==brand):[...values,brand]); }
  readonly items = signal<Product[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly hasMore = signal(true);
  readonly sort = signal('default');
  readonly hasDemo = computed(() => this.items().some(product => product.is_demo));
  private offset = 0;
  private pageSize = window.matchMedia('(max-width:700px)').matches ? 4 : 8;
  productQuery(index: number) {
    return { catalog: JSON.stringify({ category: this.category(), sold: this.archived, sort: this.sort(), brands: this.selectedBrands(), limit: this.pageSize, index, total: this.total() }) };
  }
  private request?: Subscription;
  constructor() {
    effect(() => {
      const category=this.category(); this.sort(); this.selectedBrands();
      untracked(() => {
        if(category!==this.lastCategory){ this.lastCategory=category; this.selectedBrands.set([]); this.brands.set([]); }
        this.request?.unsubscribe(); this.items.set([]); this.offset=0;
        this.pageSize=window.matchMedia('(max-width:700px)').matches?4:8;
        this.total.set(0); this.hasMore.set(true); this.loading.set(false); this.error.set('');
        if(this.validCategory()) this.loadMore();
      });
    });
    inject(DestroyRef).onDestroy(()=>this.request?.unsubscribe());
  }
  loadMore() {
    if(this.loading() || !this.hasMore()) return;
    this.loading.set(true); this.error.set('');
    const limit=this.pageSize;
    this.request=this.api.page(this.category(),this.archived,this.sort(),limit,this.offset,this.selectedBrands()).subscribe({
      next: page => {
        this.brands.set(page.brands);
        this.offset+=page.items.length;
        this.items.update(items=>{const ids=new Set(items.map(p=>p.id));return [...items,...page.items.filter(p=>!ids.has(p.id))];});
        this.total.set(page.total); this.hasMore.set(page.items.length>0 && this.offset<page.total); this.loading.set(false);
      },
      error: () => { this.error.set('Не удалось загрузить товары. Попробуйте ещё раз.'); this.loading.set(false); }
    });
  }
  setSort(event: Event) { this.sort.set((event.target as HTMLSelectElement).value); }
}

@Component({
  selector: 'app-product', imports: [RouterLink, CurrencyPipe, RequestDialog, ProgressiveImage],
  template: `@if (state(); as state) {
    @if (state.loading) { <p class="status" role="status">Загружаем товар…</p> }
    @else if (state.notFound) { <div class="status"><p class="eyebrow">404</p><h1>Товар не найден</h1><a routerLink="/catalog" class="button dark">Вернуться в каталог</a></div> }
    @else if (state.error) { <div class="status" role="alert"><p>{{ state.error }}</p><button class="button" (click)="retry.next()">Повторить</button></div> }
    @else if (state.data; as product) {
      <nav class="breadcrumbs" aria-label="Хлебные крошки"><a routerLink="/">Главная</a><span>/</span><a routerLink="/catalog">Каталог</a><span>/</span><a [routerLink]="product.category ? ['/catalog', product.category] : ['/catalog']">{{ categoryName(product.category) }}</a><span>/</span><span>{{ product.name || 'Без названия' }}</span></nav>
      @if (admin.session() && navigation(); as context) {
        <nav class="product-navigation" aria-label="Навигация по товарам каталога">
          <button class="button" type="button" aria-label="Предыдущий товар" [disabled]="navigating() || context.index === 0" (click)="navigateProduct(-1)">←</button>
          <span aria-live="polite">{{ context.index + 1 }} / {{ context.total }}</span>
          <button class="button" type="button" aria-label="Следующий товар" [disabled]="navigating() || context.index + 1 >= context.total" (click)="navigateProduct(1)">→</button>
        </nav>
        @if (navigationError()) { <p role="alert">{{ navigationError() }}</p> }
      }
      <section class="product-detail" [class.product-swipe-enabled]="admin.session() && navigation()"
        (pointerdown)="startSwipe($event)" (pointerup)="finishSwipe($event)" (pointercancel)="cancelSwipe()">
        <div class="gallery">
          @if (activeImage(); as image) { <div class="gallery-main"><img [appProgressiveImage]="image.url" [alt]="image.alt" width="640" height="720" fetchpriority="high" loading="eager" decoding="async"></div> }
          @if (!activeImage()) { <div class="gallery-main"><img src="/images/no-photo.svg" alt="Фото пока нет" width="640" height="720"></div> }
          <div class="thumbnails" aria-label="Фотографии товара">@for (image of orderedImages(); track $index; let i = $index) {
            <button [class.active]="activeIndex() === i" [attr.aria-pressed]="activeIndex() === i" [attr.aria-label]="image.alt" (click)="choose(product.id, i)"><img [src]="previewUrl(image.url)" alt="" width="100" height="110" loading="lazy" decoding="async"></button>
          }</div>
        </div>
        <div class="product-info">@if (product.brands.length) { <p class="eyebrow">{{ product.brands.join(' × ') }}</p> }<h1>{{ product.name || 'Без названия' }}</h1><p class="detail-price">{{ product.price_cents === null ? 'Цена не указана' : (product.price_cents! / 100 | currency:'RUB':'symbol':'1.0-2':'ru') }}</p>
          <dl><div><dt>Бренды</dt><dd>{{ product.brands.join(' × ') || 'Не указаны' }}</dd></div><div><dt>Размер</dt><dd>{{ product.size || 'Не указан' }}</dd></div><div><dt>Тематика</dt><dd>{{ product.theme || 'Не указан' }}</dd></div><div><dt>Категория</dt><dd><a [routerLink]="product.category ? ['/catalog', product.category] : ['/catalog']">{{ categoryName(product.category) }}</a></dd></div></dl>
          @if(product.sold){<p class="demo-note">Продано · Товар в архиве</p>}
          <section class="description"><h2>О вещи</h2><p>{{ product.description || 'Описание пока не добавлено.' }}</p></section>
          @if (product.is_demo) { <p class="demo-note">Демонстрационный товар. В галерее — иллюстрации, включая шаблон ярлычка. Они не заменяют фотографии реальной вещи.</p> }
          @if (!product.sold && customer.session() && !admin.session()) { <button class="button dark" (click)="openChat(product.id)" [disabled]="openingChat()">{{ openingChat() ? 'Открываем чат…' : 'Написать' }}</button> }
          @if (!product.sold && customer.session() && !admin.session()) { <button class="button" style="margin-left:12px" (click)="requestOpen.set(true)">Оставить заявку</button> }
          @if (!product.sold && requestOpen() && customer.session() && !admin.session()) { @defer (when requestOpen()) { <app-request-dialog [product]="product" (closed)="requestOpen.set(false)" /> } }
          @if (chatError()) { <p role="alert">{{ chatError() }}</p> }
          @if (!product.sold && customer.ready() && !customer.session() && !admin.session()) {
            <p class="seller-contact">Чтобы написать продавцу или оставить заявку, необходима <a class="text-link" routerLink="/account" [queryParams]="{returnTo:'/product/' + product.id}">регистрация</a>. Уже есть аккаунт? <a class="text-link" routerLink="/account" [queryParams]="{mode:'login', returnTo:'/product/' + product.id}">Войти</a></p>
          }
          @if (admin.session()) {
            <a class="text-link back-link" routerLink="/admin" [queryParams]="{edit: product.id}">Редактировать товар</a>
          }
          <a class="text-link back-link" [routerLink]="backToCatalog(product)">← Назад в раздел</a>
        </div>
      </section>
    }
  }`,
})
export class ProductPage {
  private swipe: { id: number; x: number; y: number; time: number } | null = null;
  startSwipe(event: PointerEvent) {
    if (!event.isPrimary) { this.cancelSwipe(); return; }
    if (event.pointerType !== 'touch' || !this.admin.session() || !this.navigation() || this.navigating()
      || !(event.target instanceof Element)
      || event.target.closest('a, button, input, select, textarea, label, [role="button"], [contenteditable]')) {
      this.cancelSwipe();
      return;
    }
    this.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  }
  cancelSwipe() { this.swipe = null; }
  finishSwipe(event: PointerEvent) {
    const start = this.swipe;
    this.cancelSwipe();
    if (!start || start.id !== event.pointerId || !event.isPrimary) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (event.timeStamp - start.time > 800 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, label, [role="button"], [contenteditable]')) return;
    this.navigateProduct(dx < 0 ? 1 : -1);
  }
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private navigationRequest?: Subscription;
  readonly navigating = signal(false);
  readonly navigationError = signal('');
  readonly navigation = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map(params => parseCatalogNavigation(params.get('catalog')))));
  backToCatalog(product: Product) {
    const context = this.admin.session() ? this.navigation() : null;
    return context ? (context.sold ? ['/archive'] : context.category ? ['/catalog', context.category] : ['/catalog'])
      : product.sold ? ['/archive'] : product.category ? ['/catalog', product.category] : ['/catalog'];
  }
  navigateProduct(direction: -1 | 1) {
    const context = this.navigation();
    if (!this.admin.session() || !context || this.navigating()) return;
    const index = context.index + direction;
    if (index < 0 || index >= context.total) return;
    this.navigating.set(true);
    this.navigationError.set('');
    const offset = Math.floor(index / context.limit) * context.limit;
    this.navigationRequest = this.api.page(context.category, context.sold, context.sort, context.limit, offset, context.brands).subscribe({
      next: page => {
        const product = page.items[index - offset];
        if (!product) {
          this.navigationError.set('Список товаров изменился. Вернитесь в каталог и выберите товар заново.');
          this.navigating.set(false);
          return;
        }
        const next: CatalogNavigation = { ...context, index, total: page.total };
        void this.router.navigate(['/product', product.id], { queryParams: { catalog: JSON.stringify(next) } })
          .catch(() => this.navigationError.set('Не удалось открыть товар. Попробуйте ещё раз.'))
          .finally(() => this.navigating.set(false));
      },
      error: () => {
        this.navigationError.set('Не удалось загрузить соседний товар. Попробуйте ещё раз.');
        this.navigating.set(false);
      }
    });
  }
  readonly previewUrl = previewUrl;
  private trackedProduct:number|null=null;
  constructor(){
    this.destroyRef.onDestroy(() => this.navigationRequest?.unsubscribe());
    effect(()=>{
    const product=this.state()?.data;
    if(!product||product.is_demo||this.trackedProduct===product.id)return;
    this.trackedProduct=product.id;
    void this.admin.restore().then(()=>{if(!this.admin.session())this.api.recordView(product.id);}).catch(()=>{});
  });}

  readonly requestOpen=inject(RequestsService).formOpen;
  readonly admin = inject(AdminService);
  readonly chats = inject(ChatService);
  readonly openingChat = signal(false);
  readonly chatError = signal('');
  async openChat(id:number) { this.openingChat.set(true);this.chatError.set('');try{await this.chats.openProduct(id);}catch{this.chatError.set('Не удалось открыть чат. Проверьте вход и попробуйте снова.');}finally{this.openingChat.set(false);} }
  readonly customer = inject(CustomerService);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CatalogService);
  readonly retry = new Subject<void>();
  readonly state = toSignal(combineLatest([this.route.paramMap, this.retry.pipe(startWith(undefined))]).pipe(
    switchMap(([params]) => {
      const id = params.get('id') ?? '';
      return /^\d+$/.test(id) && Number(id) > 0 && Number(id) <= 2147483647 ? loadState(this.api.product(id)) : of<LoadState<Product>>({ loading: false, data: null, error: '', notFound: true });
    }),
  ));
  readonly selection = signal({ productId: 0, index: 0 });
  readonly activeIndex = computed(() => this.selection().productId === this.state()?.data?.id ? this.selection().index : 0);
  readonly orderedImages = computed(() => [...(this.state()?.data?.images??[])].sort((a,b)=>Number(b.kind==='front')-Number(a.kind==='front')));
  readonly activeImage = computed(() => this.orderedImages()[this.activeIndex()]);
  readonly categoryName = categoryName;
  choose(productId: number, index: number) { this.selection.set({ productId, index }); }
}

@Component({
  selector: 'app-about', imports: [RouterLink],
  template: `<section class="page-intro"><p class="eyebrow"><a routerLink="/">ГЛАВНАЯ</a> / О НАС</p><h1>Вещи с характером.<br><span class="muted">Люди со своим стилем.</span></h1></section>
    <section class="about-layout"><div class="about-mark" aria-hidden="true"><img src="/images/futba-logo.svg" alt="" width="348" height="64"><span>ВЫБИРАЙ СВОЁ.</span></div><div class="about-copy"><p class="eyebrow">О ПРОЕКТЕ</p><h2>Гардероб начинается<br>с любопытства.</h2><p>FUTBA — каталог футболок, кроссовок, аксессуаров и головных уборов. Место, где можно спокойно рассмотреть вещь и найти то, что подходит именно тебе.</p><p>Мы строим каталог вокруг деталей: у каждой позиции есть бренд, год выпуска, тематика и описание. Несколько ракурсов и отдельное фото ярлычка помогают узнать вещь ближе.</p><a class="button dark" routerLink="/catalog">Найти свою вещь</a></div></section>
    <section class="about-principles"><article><p class="eyebrow">01 / ВЫБОР</p><h3>Не только футболки</h3><p>Четыре категории, которые легко собрать в собственный образ.</p></article><article><p class="eyebrow">02 / КОНТЕКСТ</p><h3>Больше, чем название</h3><p>Бренд, год и тематика помогают понять характер каждой вещи.</p></article><article><p class="eyebrow">03 / ДЕТАЛИ</p><h3>Рассмотреть поближе</h3><p>Основной вид, детали и ярлычок — в одной галерее.</p></article></section>`,
})
export class AboutPage {}
@Component({ selector: 'app-not-found', imports: [RouterLink], template: `<div class="status"><p class="eyebrow">404</p><h1>Страница не найдена</h1><p>Возможно, адрес изменился.</p><a class="button dark" routerLink="/catalog">Перейти в каталог</a></div>` })
export class NotFoundPage {}
