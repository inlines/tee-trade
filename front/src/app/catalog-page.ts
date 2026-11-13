import { Component,computed,DestroyRef,effect,inject,signal,untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute,NavigationEnd,NavigationStart,Router,RouterLink,RouterLinkActive,Scroll } from '@angular/router';
import { map,Subscription } from 'rxjs';
import { CatalogService,categories,categoryName,Product } from './catalog';
import { CatalogEnd } from './catalog-end';
import { CatalogHistory,CatalogSnapshot } from './catalog-history';
import { ProductCard } from './product-card';

@Component({
  selector: 'app-catalog', imports: [RouterLink, RouterLinkActive, ProductCard, CatalogEnd],
  template: `<section class="page-intro"><p class="eyebrow"><a routerLink="/">ГЛАВНАЯ</a> / {{ archived ? 'АРХИВ' : 'КАТАЛОГ' }}</p><h1>{{ title() }}</h1></section>
    @if(!archived){<nav class="catalog-tabs" aria-label="Категории каталога"><a routerLink="/catalog" routerLinkActive="selected" [routerLinkActiveOptions]="{exact:true}" ariaCurrentWhenActive="page">Все вещи</a>
      @for (category of categories; track category.slug) { <a [routerLink]="['/catalog', category.slug]" routerLinkActive="selected" ariaCurrentWhenActive="page">{{ category.name }}</a> }</nav>}
    <form class="catalog-search" role="search" (submit)="applySearch($event, searchInput.value)">
      <label for="catalog-search-input">Поиск товаров</label><div><input #searchInput id="catalog-search-input" type="search" maxlength="160" [value]="search()" placeholder="Название, бренд или описание"><button class="button dark" type="submit">Найти</button>@if(search()){<button class="button" type="button" (click)="searchInput.value=''; search.set('')">Сбросить</button>}</div>
    </form>
    <section class="brand-filter" aria-label="Фильтр по размерам">
      <button class="brand-filter-toggle" type="button" [attr.aria-expanded]="sizesOpen()" aria-controls="catalog-sizes" (click)="sizesOpen.set(!sizesOpen())">Размеры @if(selectedSizes().length){<span>({{selectedSizes().length}})</span>} <span aria-hidden="true">{{sizesOpen()?'−':'+'}}</span></button>
      @if(sizesOpen()) { <div id="catalog-sizes" class="brand-tags">
        @for(size of sizes(); track size) { <button type="button" class="brand-tag" [class.selected]="selectedSizes().includes(size)" [attr.aria-pressed]="selectedSizes().includes(size)" (click)="toggleSize(size)">{{size}}</button> }
        @if(!sizes().length && !loading()){<p>В этой категории пока нет указанных размеров.</p>}
        @if(selectedSizes().length){<button type="button" class="text-link" (click)="selectedSizes.set([])">Сбросить размеры</button>}
      </div>}
    </section>
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
      @if (loading() && !items().length) { <p class="status catalog-loading" role="status">Загружаем вещи…</p> }
      @else {
        <div class="catalog-toolbar"><p>Позиций: {{ total() }}</p><label>Сортировка <select [value]="sort()" (change)="setSort($event)"><option value="default">По умолчанию</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option></select></label></div>
        <div class="product-grid">@for (product of items(); track product.id; let i = $index) { <app-product-card [product]="product" [priority]="i < 2" [headingLevel]="2" [catalogQuery]="productQuery(i)" /> } @empty { @if(!error()){ <div class="status"><h2>{{search()?'По вашему запросу ничего не найдено':archived?'В архиве пока нет товаров':'В этой категории пока нет вещей'}}</h2><a routerLink="/catalog" class="text-link">Посмотреть весь каталог →</a></div> } }</div>
        @if (loading()) { <p class="status" role="status">Загружаем вещи…</p> }
        @else if (error()) { <div class="status" role="alert"><p>{{error()}}</p><button class="button" (click)="loadMore()">Повторить</button></div> }
        @else if (hasMore() && !restoring()) { <app-catalog-end (reached)="loadMore()" /> }
        @if (hasDemo()) { <p class="demo-note">Демо-коллекция: товары и иллюстрации показывают устройство каталога. Фотографии реальных вещей будут добавлены отдельно.</p> }
      }
    }`,
})
export class CatalogPage {
  private readonly router = inject(Router);
  private readonly history = inject(CatalogHistory);
  readonly restoring = signal(false);
  private entryId = this.router.getCurrentNavigation()?.id ?? window.history.state?.navigationId ?? 0;
  private restoredId = this.history.restoredId;
  private fromProduct = this.history.fromProduct;
  private filterKey = '';
  private restoreY: number | null = null;
  private frame = 0;
  private url() { return this.archived ? '/archive' : '/catalog'+(this.category()?'/'+this.category():''); }
  private savePosition() {
    if(!this.items().length)return;
    this.history.save(this.entryId,{url:this.url(),items:this.items(),total:this.total(),offset:this.offset,
      hasMore:this.hasMore(),search:this.search(),sort:this.sort(),selectedBrands:this.selectedBrands(),brands:this.brands(),
      selectedSizes:this.selectedSizes(),sizes:this.sizes(),sizesOpen:this.sizesOpen(),brandsOpen:this.brandsOpen(),pageSize:this.pageSize,y:window.scrollY});
  }
  private restore(snapshot:CatalogSnapshot) {
    this.request?.unsubscribe();
    this.search.set(snapshot.search ?? '');
    this.items.set(snapshot.items);this.total.set(snapshot.total);this.offset=snapshot.offset;
    this.hasMore.set(snapshot.hasMore);this.sort.set(snapshot.sort);this.selectedBrands.set(snapshot.selectedBrands);
    this.selectedSizes.set(snapshot.selectedSizes);this.sizes.set(snapshot.sizes);this.sizesOpen.set(snapshot.sizesOpen);
    this.brands.set(snapshot.brands);this.brandsOpen.set(snapshot.brandsOpen);this.pageSize=snapshot.pageSize;
    this.loading.set(false);this.error.set('');this.restoring.set(true);this.restoreY=snapshot.y;
    this.filterKey=JSON.stringify([this.category(),snapshot.sort,snapshot.selectedBrands,snapshot.selectedSizes,snapshot.search ?? '']);
  }
  readonly search = signal('');
  applySearch(event:Event,value:string){event.preventDefault();this.search.set(value.trim());}
  readonly categories = categories;
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CatalogService);
  readonly category = toSignal(this.route.paramMap.pipe(map(params => params.get('category') ?? '')), { initialValue: '' });
  readonly validCategory = computed(() => !this.category() || categories.some(category => category.slug === this.category()));
  readonly archived = this.route.snapshot.data['archive']===true;
  readonly title = computed(() => this.archived ? 'Архив' : this.validCategory() ? (this.category() ? categoryName(this.category()) : 'Каталог') : 'Категория не найдена');
  readonly sizesOpen = signal(false);
  readonly sizes = signal<string[]>([]);
  readonly selectedSizes = signal<string[]>([]);
  toggleSize(size:string) { this.selectedSizes.update(values=>values.includes(size)?values.filter(value=>value!==size):[...values,size]); }
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
    return { catalog: JSON.stringify({ category: this.category(), sold: this.archived, sort: this.sort(), search:this.search(), brands: this.selectedBrands(), sizes: this.selectedSizes(), limit: this.pageSize, index, total: this.total() }) };
  }
  private request?: Subscription;
  constructor() {
    const events=this.router.events.subscribe(event=>{
      if(event instanceof NavigationStart){
        this.savePosition();
        this.restoredId=event.restoredState?.navigationId;
        this.fromProduct=this.router.url.startsWith('/product/');
      }
      if(event instanceof NavigationEnd)this.entryId=event.id;
      if(event instanceof Scroll && this.restoreY!==null){
        const y=this.restoreY;this.restoreY=null;
        this.frame=requestAnimationFrame(()=>{
          window.scrollTo({top:y,behavior:'instant'});
          this.restoring.set(false);
        });
      }
    });
    effect(() => {
      const category=this.category(); const key=JSON.stringify([category,this.sort(),this.selectedBrands(),this.selectedSizes(),this.search()]);
      untracked(() => {
        if(key===this.filterKey)return;
        const restoredId=this.restoredId;this.restoredId=undefined;
        const snapshot=this.history.get(restoredId,this.url())
          ?? (this.fromProduct?this.history.latest(this.url()):undefined);
        this.fromProduct=false;
        if(snapshot){this.lastCategory=category;this.restore(snapshot);return;}
        this.filterKey=key;
        if(category!==this.lastCategory){ this.lastCategory=category; this.selectedBrands.set([]); this.brands.set([]); this.selectedSizes.set([]); this.sizes.set([]); }
        this.request?.unsubscribe(); this.items.set([]); this.offset=0;
        this.pageSize=window.matchMedia('(max-width:700px)').matches?4:8;
        this.total.set(0); this.hasMore.set(true); this.loading.set(false); this.error.set('');
        if(this.validCategory()) this.loadMore();
      });
    });
    inject(DestroyRef).onDestroy(()=>{this.request?.unsubscribe();events.unsubscribe();cancelAnimationFrame(this.frame);});
  }
  loadMore() {
    if(this.loading() || !this.hasMore()) return;
    this.loading.set(true); this.error.set('');
    const limit=this.pageSize;
    this.request=this.api.page(this.category(),this.archived,this.sort(),limit,this.offset,this.selectedBrands(),this.selectedSizes(),this.search()).subscribe({
      next: page => {
        this.brands.set(page.brands); this.sizes.set(page.sizes);
        this.offset+=page.items.length;
        this.items.update(items=>{const ids=new Set(items.map(p=>p.id));return [...items,...page.items.filter(p=>!ids.has(p.id))];});
        this.total.set(page.total); this.hasMore.set(page.items.length>0 && this.offset<page.total); this.loading.set(false);
      },
      error: () => { this.error.set('Не удалось загрузить товары. Попробуйте ещё раз.'); this.loading.set(false); }
    });
  }
  setSort(event: Event) { this.sort.set((event.target as HTMLSelectElement).value); }
}
