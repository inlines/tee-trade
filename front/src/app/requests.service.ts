import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AdminService } from './admin.service';
import { CustomerService } from './customer.service';
import { Chat } from './chat.service';
export type RequestStatus='new'|'in_progress'|'completed';
export interface PurchaseRequest {id:number;chat_id:number;product_id:number;product_name:string;username:string;last_name:string;first_name:string;patronymic:string;contact:string;city:string;status:RequestStatus;created_at:string;updated_at:string;product_exists:boolean;}
export interface RequestDraft {product_id:number;last_name:string;first_name:string;patronymic:string;contact:string;city:string;}
export interface RequestNotice {id:number;request_id:number;product_name:string;status:RequestStatus;admin:boolean;}
export const requestStatus=(status:RequestStatus)=>({new:'Новая',in_progress:'В работе',completed:'Завершена'}[status]);
export const requestError=(e:unknown)=>e instanceof HttpErrorResponse&&typeof e.error==='string'&&!e.error.startsWith('<')?e.error:'Не удалось выполнить запрос. Попробуйте ещё раз.';
@Injectable({providedIn:'root'})
export class RequestsService {
 private readonly http=inject(HttpClient);private readonly admin=inject(AdminService);private readonly customer=inject(CustomerService);
 readonly revision=signal(0);readonly formOpen=signal(false);
 private headers(admin=false){return {'X-CSRF-Token':(admin?this.admin.session():this.customer.session())?.csrf_token??''};}
 list(admin=false){return firstValueFrom(this.http.get<PurchaseRequest[]>('/api/'+(admin?'admin':'auth')+'/requests'));}
 create(draft:RequestDraft){return firstValueFrom(this.http.post<PurchaseRequest>('/api/auth/requests',draft,{headers:this.headers()}));}
 update(id:number,status:RequestStatus){return firstValueFrom(this.http.post<PurchaseRequest>('/api/admin/requests/'+id+'/status',{status},{headers:this.headers(true)}));}
 chat(id:number){return firstValueFrom(this.http.get<Chat>('/api/admin/requests/'+id+'/chat'));}
 events(admin:boolean,after?:number){return firstValueFrom(this.http.get<{cursor:number;events:RequestNotice[]}>('/api/'+(admin?'admin':'auth')+'/requests/events',{params:after===undefined?{}:{after}}));}
}
