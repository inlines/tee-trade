import { Component, OnInit, OnDestroy, inject, input } from '@angular/core';
import { RequestsService } from './requests.service';
import { ChatToastStore } from './chat-toasts';
import { NotificationSound } from './notification-sound.service';
@Component({selector:'app-request-notifications',template:''})
export class RequestNotifications implements OnInit,OnDestroy {
 readonly admin=input(false);private readonly api=inject(RequestsService);private readonly toasts=inject(ChatToastStore);private readonly sound=inject(NotificationSound);
 private timer?:ReturnType<typeof setTimeout>;private destroyed=false;private busy=false;private cursor?:number;
 private readonly resume=()=>{if(!document.hidden)void this.poll();};
 ngOnInit(){void this.poll();window.addEventListener('online',this.resume);document.addEventListener('visibilitychange',this.resume);}
 private async poll(){
  if(this.destroyed||this.busy)return;clearTimeout(this.timer);this.busy=true;
  try{const result=await this.api.events(this.admin(),this.cursor);if(this.destroyed)return;
   const changed=result.events.length>0;this.cursor=result.cursor;
   for(const event of result.events)this.toasts.addRequest({...event,admin:this.admin()});
   if(changed){this.api.revision.update(v=>v+1);void this.sound.play();}
  }catch{/* Retry without advancing cursor so reconnect does not lose events. */}
  finally{this.busy=false;if(!this.destroyed)this.timer=setTimeout(()=>void this.poll(),5000);}
 }
 ngOnDestroy(){this.destroyed=true;clearTimeout(this.timer);window.removeEventListener('online',this.resume);document.removeEventListener('visibilitychange',this.resume);}
}
