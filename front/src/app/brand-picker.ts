import { Component, computed, effect, input, output, signal } from '@angular/core';

@Component({
  selector:'app-brand-picker',
  host:{'(focusout)':'leave($event)'},
  template:`<label for="product-brand">Бренд</label>
    <div class="brand-input"><input id="product-brand" role="combobox" autocomplete="off" maxlength="100" [value]="value()" [disabled]="disabled()" [attr.aria-expanded]="open()" aria-controls="brand-options" aria-autocomplete="list" [attr.aria-activedescendant]="open() && options().length ? 'brand-option-'+active() : null" (input)="type($event)" (focus)="show()" (keydown)="key($event)">
    <button type="button" [disabled]="disabled()" aria-label="Показать бренды" [attr.aria-expanded]="open()" (click)="open() ? open.set(false) : show()">⌄</button></div>
    @if(open()) { <div class="brand-options" id="brand-options" role="listbox" aria-label="Бренды">
      @for(option of options();track option.name;let i=$index){<button type="button" role="option" [id]="'brand-option-'+i" [attr.aria-selected]="active()===i" [class.active]="active()===i" (pointerdown)="$event.preventDefault()" (click)="choose(option.name)">{{option.create?'Добавить «'+option.name+'»':option.name}}{{option.create?'':''}}</button>}
      @if(!options().length){<p>Введите название нового бренда</p>}
    </div> }
    <small>Выберите бренд или введите новый. Новый бренд появится в списке после сохранения товара.</small>`,
  styles:`:host{display:block;position:relative;min-width:0;margin-bottom:20px;font-size:13px}label{display:block;margin-bottom:8px}.brand-input{display:flex;border:1px solid #c9cdbf;background:#fff}.brand-input input{width:100%;min-width:0;border:0;padding:12px;background:transparent;font:inherit;color:var(--ink)}button{font:inherit;color:var(--ink);cursor:pointer}.brand-input button{border:0;background:none;padding:0 14px}.brand-options{position:absolute;top:69px;left:0;right:0;z-index:10;max-height:240px;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--line);background:var(--paper,#f8f7f3);box-shadow:0 8px 20px #0001}.brand-options button{display:block;width:100%;border:0;background:none;padding:12px;text-align:left;overflow-wrap:anywhere}.brand-options button:hover,.brand-options button.active{background:#e8e7e0}.brand-options p{padding:12px}small{display:block;color:var(--muted);line-height:1.5;margin-top:7px}input:focus-visible,button:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}`,
})
export class BrandPicker {
  readonly value=input('');
  readonly brands=input<string[]>([]);
  readonly disabled=input(false);
  readonly valueChange=output<string>();
  readonly open=signal(false);
  readonly filter=signal('');
  readonly active=signal(0);
  readonly options=computed(()=>{
    const text=this.filter().trim();
    const found=this.brands().filter(b=>b.toLowerCase().includes(text.toLowerCase())).map(name=>({name,create:false}));
    if(text && !this.brands().some(b=>b.toLowerCase()===text.toLowerCase())) found.push({name:text,create:true});
    return found;
  });
  constructor(){effect(()=>{if(this.disabled())this.open.set(false);});}
  show(){this.filter.set('');this.active.set(0);this.open.set(true);}
  type(event:Event){const text=(event.target as HTMLInputElement).value;this.valueChange.emit(text);this.filter.set(text);this.active.set(0);this.open.set(true);}
  choose(name:string){this.valueChange.emit(name);this.open.set(false);}
  leave(event:FocusEvent){if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))this.open.set(false);}
  key(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();this.open.set(false);}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!this.open()){this.show();return;}const count=this.options().length;this.active.set(count?(this.active()+(event.key==='ArrowDown'?1:-1)+count)%count:0);document.getElementById('brand-option-'+this.active())?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'&&this.open()){event.preventDefault();const option=this.options()[this.active()];if(option)this.choose(option.name);}
  }
}
