import { Component, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { categories } from './catalog';

@Component({
  selector: 'app-catalog-menu',
  imports: [RouterLink, RouterLinkActive],
  template: `<details #dropdown class="catalog-dropdown" routerLinkActive="active" (focusout)="onFocusOut($event)" (toggle)="positionMenu()">
    <summary>Каталог <svg class="dropdown-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" /></svg></summary>
    <div class="catalog-dropdown-panel">
      <a routerLink="/catalog" routerLinkActive="selected" [routerLinkActiveOptions]="{exact:true}" ariaCurrentWhenActive="page" (click)="close()">Все вещи</a>
      @for (category of categories; track category.slug) {
        <a [routerLink]="['/catalog', category.slug]" routerLinkActive="selected" ariaCurrentWhenActive="page" (click)="close()">{{ category.name }}</a>
      }
    </div>
  </details>`,
})
export class CatalogMenu {
  readonly categories = categories;
  @ViewChild('dropdown') private dropdown?: ElementRef<HTMLDetailsElement>;
  private readonly element = inject(ElementRef<HTMLElement>);

  constructor() {
    inject(Router).events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.close());
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  positionMenu() {
    const details=this.dropdown?.nativeElement;
    if(!details?.open)return;
    const panel=details.querySelector<HTMLElement>('.catalog-dropdown-panel')!;
    const anchor=details.querySelector('summary')!.getBoundingClientRect();
    const width=Math.min(260,document.documentElement.clientWidth-24);
    const height=window.innerHeight;
    panel.style.width=width+'px'; panel.style.maxHeight=Math.max(80,height-24)+'px';
    panel.style.left=Math.max(12,Math.min(anchor.right-width,document.documentElement.clientWidth-width-12))+'px';
    panel.style.top=Math.max(12,Math.min(anchor.bottom+8,height-panel.getBoundingClientRect().height-12))+'px';
  }
  close() { if (this.dropdown) this.dropdown.nativeElement.open = false; }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent) {
    if (!this.element.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('keydown.escape', ['$event'])
  onEscape(event: Event) {
    if (this.dropdown?.nativeElement.open) {
      this.close();
      this.dropdown.nativeElement.querySelector('summary')?.focus();
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onFocusOut(event: FocusEvent) {
    // Touch browsers can blur the summary with no new focus target before
    // dispatching the link's click. Keep it visible so that tap can complete.
    // An outside click or completed navigation still closes the menu.
    if (event.relatedTarget instanceof Node && !this.element.nativeElement.contains(event.relatedTarget)) this.close();
  }
}
