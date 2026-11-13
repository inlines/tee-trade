import { CurrencyPipe } from '@angular/common';
import { Component,computed,DestroyRef,effect,inject,signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute,Router,RouterLink } from '@angular/router';
import { combineLatest,map,of,startWith,Subject,Subscription,switchMap } from 'rxjs';
import { AdminService } from './admin.service';
import { CatalogService,categoryName,loadState,LoadState,previewUrl,Product } from './catalog';
import { CatalogNavigation,parseCatalogNavigation } from './catalog-navigation';
import { ChatService } from './chat.service';
import { CustomerService } from './customer.service';
import { ProgressiveImage } from './progressive-image';
import { RequestDialog } from './request-dialog';
import { RequestsService } from './requests.service';

@Component({
  selector: 'app-product', imports: [RouterLink, CurrencyPipe, RequestDialog, ProgressiveImage],
  template: `@if (state(); as state) {
    @if (state.loading) { <div class="product-loading" role="status" aria-label="Загружаем товар"><div class="breadcrumbs" aria-hidden="true">&nbsp;</div><div class="product-detail" aria-hidden="true"><div class="product-image-placeholder skeleton"></div><div class="product-info skeleton"></div></div></div> }
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
          <dl><div><dt>Бренды</dt><dd>{{ product.brands.join(' × ') || 'Не указаны' }}</dd></div><div><dt>Размеры</dt><dd>{{ product.sizes.join(' · ') || 'Не указаны' }}</dd></div><div><dt>Тематика</dt><dd>{{ product.theme || 'Не указан' }}</dd></div><div><dt>Категория</dt><dd><a [routerLink]="product.category ? ['/catalog', product.category] : ['/catalog']">{{ categoryName(product.category) }}</a></dd></div></dl>
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
    this.navigationRequest = this.api.page(context.category, context.sold, context.sort, context.limit, offset, context.brands, context.sizes, context.search).subscribe({
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
