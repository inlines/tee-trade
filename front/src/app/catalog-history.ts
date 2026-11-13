import { NavigationStart, Router } from '@angular/router';
import { Injectable, inject } from '@angular/core';
import { Product } from './catalog';

export interface CatalogSnapshot {
  url: string; items: Product[]; total: number; offset: number; hasMore: boolean;
  search?: string;
  sort: string; selectedBrands: string[]; brands: string[]; brandsOpen: boolean;
  selectedSizes: string[]; sizes: string[]; sizesOpen: boolean;
  pageSize: number; y: number;
}

// Keep each history entry separate: the same URL can have different filters.
@Injectable({providedIn:'root'})
export class CatalogHistory {
  restoredId: number | undefined;
  fromProduct = false;
  constructor() {
    const router=inject(Router);
    router.events.subscribe(event=>{
      if(event instanceof NavigationStart){
        this.restoredId=event.restoredState?.navigationId;
        this.fromProduct=router.url.startsWith('/product/');
      }
    });
  }
  private entries = new Map<number, CatalogSnapshot>();
  save(id:number, snapshot:CatalogSnapshot) {
    this.entries.delete(id);
    this.entries.set(id, snapshot);
    while(this.entries.size>20)this.entries.delete(this.entries.keys().next().value!);
  }
  get(id:number|undefined,url:string) {
    const entry=id===undefined?undefined:this.entries.get(id);
    return entry?.url===url?entry:undefined;
  }
  latest(url:string) {
    return [...this.entries.values()].reverse().find(entry=>entry.url===url);
  }
}
