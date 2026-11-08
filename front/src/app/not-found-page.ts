import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({ selector: 'app-not-found', imports: [RouterLink], template: `<div class="status"><p class="eyebrow">404</p><h1>Страница не найдена</h1><p>Возможно, адрес изменился.</p><a class="button dark" routerLink="/catalog">Перейти в каталог</a></div>` })
export class NotFoundPage {}
