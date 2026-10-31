import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CustomerService } from './customer.service';
export interface Chat { id:number; product_id:number; product_name:string; username:string; updated_at:string; last_message:string|null; product_exists:boolean; }
export interface ChatMessage { id:number; chat_id:number; is_admin:boolean; client_id:string; body:string; created_at:string; }
export interface History { messages:ChatMessage[]; has_more:boolean; }
@Injectable({providedIn:'root'})
export class ChatService {
  private readonly http=inject(HttpClient);
  private readonly customer=inject(CustomerService);
  readonly selected=signal<{chat:Chat; admin:boolean}|null>(null);
  list(admin=false) {return firstValueFrom(this.http.get<Chat[]>(`/api/${admin?'admin':'auth'}/chats`));}
  history(id:number,admin:boolean,before:number) {return firstValueFrom(this.http.get<History>(`/api/${admin?'admin':'auth'}/chats/${id}/messages`,{params:{before}}));}
  async openProduct(productId:number) {
    const chat=await firstValueFrom(this.http.post<Chat>('/api/auth/chats',{product_id:productId},{headers:{'X-CSRF-Token':this.customer.session()?.csrf_token??''}}));
    this.open(chat,false);
  }
  open(chat:Chat,admin:boolean) {this.selected.set({chat,admin});}
  close() {this.selected.set(null);}
}
