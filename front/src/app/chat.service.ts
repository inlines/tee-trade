import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CustomerService } from './customer.service';
import { AdminService } from './admin.service';
export interface Chat { unread_count:number; id:number; product_id:number; product_name:string; username:string; updated_at:string; last_message:string|null; product_exists:boolean; }
export interface ChatMessage { id:number; chat_id:number; is_admin:boolean; client_id:string; body:string; created_at:string; }
export interface History { messages:ChatMessage[]; has_more:boolean; }
@Injectable({providedIn:'root'})
export class ChatService {
  private readonly http=inject(HttpClient);
  private readonly customer=inject(CustomerService);
  private readonly adminAuth=inject(AdminService);
  readonly drawer=signal(false);
  readonly rows=signal<Chat[]>([]);
  readonly loading=signal(false);
  readonly error=signal('');
  readonly unread=computed(()=>this.rows().reduce((total,chat)=>total+chat.unread_count,0));
  private generation=0; private request=0; private side=false;
  reset(admin:boolean) {this.generation++;this.side=admin;this.rows.set([]);this.loading.set(false);this.error.set('');this.drawer.set(false);this.close();}
  async refresh(admin=this.side) {
    const generation=this.generation,request=++this.request;this.loading.set(true);
    try{const rows=await this.list(admin);if(generation===this.generation&&request===this.request){this.rows.set(rows);this.error.set('');}}
    catch{if(generation===this.generation&&request===this.request)this.error.set('Не удалось загрузить чаты. Повторите попытку.');}
    finally{if(generation===this.generation&&request===this.request)this.loading.set(false);}
  }
  async markRead(chatId:number,admin:boolean,through:number) {
    const generation=this.generation;
    const session=admin?this.adminAuth.session():this.customer.session();
    await firstValueFrom(this.http.post(`/api/${admin?'admin':'auth'}/chats/${chatId}/read`,{through},{headers:{'X-CSRF-Token':session?.csrf_token??''}}));
    if(generation===this.generation)await this.refresh(admin);
  }
  readonly selected=signal<{chat:Chat; admin:boolean}|null>(null);
  readonly active=computed(()=>{const selected=this.selected();return selected?[selected]:[];});
  list(admin=false) {return firstValueFrom(this.http.get<Chat[]>(`/api/${admin?'admin':'auth'}/chats`));}
  history(id:number,admin:boolean,before?:number) {return firstValueFrom(this.http.get<History>(`/api/${admin?'admin':'auth'}/chats/${id}/messages`,{params:before===undefined?{}:{before}}));}
  async openProduct(productId:number) {
    const chat=await firstValueFrom(this.http.post<Chat>('/api/auth/chats',{product_id:productId},{headers:{'X-CSRF-Token':this.customer.session()?.csrf_token??''}}));
    this.open(chat,false);
  }
  open(chat:Chat,admin:boolean) {this.selected.set({chat,admin});}
  close() {this.selected.set(null);}
}
