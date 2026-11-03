import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { RequestsService, PurchaseRequest, RequestStatus, requestStatus, requestError } from './requests.service';
import { ChatService } from './chat.service';
@Component({selector:'app-request-list',imports:[RouterLink,DatePipe],template:`
<section class="requests"><div class="heading"><h2>{{admin()?'Заявки':'Мои заявки'}}</h2><button class="text-link" (click)="load()" [disabled]="loading()">Обновить</button></div>
@if(error()){<p role="alert" class="error">{{error()}}</p>}
@if(loading()&&!rows().length){<p role="status">Загружаем заявки…</p>}
<nav aria-label="Статусы заявок"><button [class.active]="!archive()" (click)="showArchive(false)">Активные ({{activeCount()}})</button><button [class.active]="archive()" (click)="showArchive(true)">Архив ({{rows().length-activeCount()}})</button></nav>
@if(selected();as row){
<article class="detail"><div class="heading"><h3>Заявка №{{row.id}}</h3><button class="text-link" (click)="close()">К списку</button></div>
<p class="badge" role="status">{{label(row.status)}}</p><h3>{{row.product_name||'Без названия'}}</h3>
@if(row.product_exists){<a class="text-link" [routerLink]="['/product',row.product_id]">Открыть товар №{{row.product_id}}</a>}@else{<p>Товар №{{row.product_id}} удалён из каталога</p>}
<dl><div><dt>Покупатель</dt><dd>{{row.username}}</dd></div><div><dt>Фамилия</dt><dd>{{row.last_name}}</dd></div><div><dt>Имя</dt><dd>{{row.first_name}}</dd></div><div><dt>Отчество</dt><dd>{{row.patronymic||'Не указано'}}</dd></div><div><dt>Контакт</dt><dd>{{row.contact}}</dd></div><div><dt>Город доставки</dt><dd>{{row.city}}</dd></div><div><dt>Создана</dt><dd>{{date(row.created_at)|date:'dd.MM.yyyy HH:mm'}}</dd></div><div><dt>Обновлена</dt><dd>{{date(row.updated_at)|date:'dd.MM.yyyy HH:mm'}}</dd></div></dl>
@if(admin()){<div class="actions">@if(row.status==='new'){<button class="button dark" [disabled]="busy()" (click)="update(row,'in_progress')">Принять в работу</button>}@if(row.status==='in_progress'){<button class="button dark" [disabled]="busy()" (click)="update(row,'completed')">Завершить</button>}<button class="button" [disabled]="busy()" (click)="openChat(row)">Открыть чат с покупателем</button></div>}
</article>
}
@else{
<div class="rows">@for(row of visible();track row.id){<button class="request-row" (click)="select(row)"><span>№{{row.id}} · {{date(row.created_at)|date:'dd.MM.yyyy HH:mm'}}</span><strong>{{row.product_name||'Без названия'}}</strong>@if(admin()){<span>{{row.last_name}} {{row.first_name}} · {{row.city}}</span>}<b>{{label(row.status)}}</b></button>}@empty{<p class="empty">{{archive()?'Завершённых заявок пока нет.':'Активных заявок пока нет.'}}</p>}</div>
}
</section>`,styles:[`
:host{display:block;margin-top:32px;min-width:0}.heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}h2{font-size:26px}h3{font-size:20px;overflow-wrap:anywhere}nav{display:flex;gap:20px;margin:24px 0;border-bottom:1px solid var(--line)}nav button{border:0;background:none;padding:12px 0;color:var(--muted)}nav .active{color:var(--ink);border-bottom:2px solid var(--ink)}.rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}.request-row{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:20px;background:var(--paper);border:1px solid var(--line);text-align:left;color:var(--ink);overflow-wrap:anywhere}.request-row span{font-size:12px;color:var(--muted)}.request-row strong{font-size:18px}.request-row b,.badge{font-size:13px}.badge{background:#e0e8cc;width:fit-content;padding:8px 12px;margin:16px 0}.detail{padding:24px;border:1px solid var(--line);background:var(--paper)}.detail>h3{margin-bottom:12px}dl{margin:24px 0}dl div{display:grid;grid-template-columns:140px minmax(0,1fr);gap:14px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}dt{color:var(--muted)}dd{overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap}.error{color:#852e22;margin:16px 0}.empty{padding:24px 0;color:var(--muted)}button:disabled{opacity:.5}@media(max-width:500px){.detail{padding:16px}dl div{grid-template-columns:1fr;gap:6px}.actions .button{width:100%}}
`]})
export class RequestList {
 readonly admin=input(false);readonly api=inject(RequestsService);private readonly chats=inject(ChatService);private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);
 readonly params=toSignal(this.route.queryParamMap);readonly rows=signal<PurchaseRequest[]>([]);readonly archive=signal(false);readonly loading=signal(false);readonly error=signal('');readonly busy=signal(false);
 readonly selected=computed(()=>this.rows().find(r=>r.id===Number(this.params()?.get('request'))));
 readonly activeCount=computed(()=>this.rows().filter(r=>r.status!=='completed').length);
 readonly visible=computed(()=>this.rows().filter(r=>(r.status==='completed')===this.archive()));
 readonly label=requestStatus;private generation=0;
 constructor(){effect(()=>{this.api.revision();this.admin();void this.load();});effect(()=>{const row=this.selected();if(row)this.archive.set(row.status==='completed');});}
 date(value:string){return new Date(value.replace(' ','T').replace(/\+00$/,'+00:00'));}
 async load(){const generation=++this.generation;this.loading.set(true);this.error.set('');try{const rows=await this.api.list(this.admin());if(generation===this.generation){this.rows.set(rows);const selected=this.selected();if(selected)this.archive.set(selected.status==='completed');}}catch(e){if(generation===this.generation)this.error.set(requestError(e));}finally{if(generation===this.generation)this.loading.set(false);}}
 select(row:PurchaseRequest){void this.router.navigate([],{relativeTo:this.route,queryParams:{request:row.id},queryParamsHandling:'merge'});}
 showArchive(value:boolean){this.archive.set(value);this.close();}
 close(){void this.router.navigate([],{relativeTo:this.route,queryParams:{request:null},queryParamsHandling:'merge'});}
 async update(row:PurchaseRequest,status:RequestStatus){if(this.busy())return;this.busy.set(true);this.error.set('');try{const saved=await this.api.update(row.id,status);this.rows.update(rows=>rows.map(r=>r.id===saved.id?saved:r));if(status==='completed'){this.archive.set(true);this.close();}}catch(e){this.error.set(requestError(e));}finally{this.busy.set(false);}}
 async openChat(row:PurchaseRequest){this.busy.set(true);this.error.set('');try{this.chats.open(await this.api.chat(row.id),true);}catch(e){this.error.set(requestError(e));}finally{this.busy.set(false);}}
}
