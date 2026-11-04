import { Directive, computed, effect, input, signal } from '@angular/core';
import { previewUrl } from './catalog';

/** Keep the preview visible until the full image is both downloaded and decoded. */
@Directive({selector:'img[appProgressiveImage]',host:{'[src]':'displaySource()','(load)':'loaded()'}})
export class ProgressiveImage {
  readonly source=input.required<string>({alias:'appProgressiveImage'});
  private readonly previewLoaded=signal('');
  private readonly fullLoaded=signal('');
  readonly displaySource=computed(()=>this.fullLoaded()===this.source()?this.source():previewUrl(this.source()));
  loaded(){this.previewLoaded.set(this.source());}
  constructor(){
    effect(cleanup=>{
      const url=this.source();
      if(this.previewLoaded()!==url || this.fullLoaded()===url || previewUrl(url)===url)return;
      let active=true;
      const image=new Image();
      image.decoding='async';image.fetchPriority='low';
      image.onload=()=>{void image.decode().then(()=>{if(active)this.fullLoaded.set(url);}).catch(()=>{});};
      image.src=url;
      cleanup(()=>{active=false;image.onload=null;image.src='';});
    });
  }
}
