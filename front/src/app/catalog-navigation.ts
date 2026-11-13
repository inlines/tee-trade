import { categories } from './catalog';

export interface CatalogNavigation {
  search?: string;
  category: string;
  sold: boolean;
  sort: string;
  brands: string[];
  sizes: string[];
  limit: number;
  index: number;
  total: number;
}

export function parseCatalogNavigation(value: string | null): CatalogNavigation | null {
  if (!value) return null;
  try {
    const context = JSON.parse(value);
    if (!context || typeof context.category !== 'string'
      || (context.category !== '' && !categories.some(category => category.slug === context.category))
      || typeof context.sold !== 'boolean'
      || !['default', 'price-asc', 'price-desc'].includes(context.sort)
      || !Array.isArray(context.brands) || !context.brands.every((brand: unknown) => typeof brand === 'string')
      || ![4, 8].includes(context.limit)
      || !Number.isSafeInteger(context.index) || context.index < 0
      || !Number.isSafeInteger(context.total) || context.total <= context.index) return null;
    if(context.sizes === undefined) context.sizes = [];
    if(!Array.isArray(context.sizes) || !context.sizes.every((size: unknown) => typeof size === 'string')) return null;
    if(context.search !== undefined && (typeof context.search !== 'string' || context.search.length>160)) return null;
    return context;
  } catch {
    return null;
  }
}
