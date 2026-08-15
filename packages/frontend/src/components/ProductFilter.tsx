import { useState, useMemo, useDeferredValue } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, Search } from 'lucide-react';
import { useSalesProducts } from '@/hooks/useSalesProducts';
import { cn } from '@/lib/utils';

interface ProductFilterProps {
  selectedProducts: string[];
  onSelectionChange: (products: string[]) => void;
}

/** Above this count the list gets a search box — below it, scanning is faster than typing. */
const SEARCH_THRESHOLD = 8;

export function ProductFilter({ selectedProducts, onSelectionChange }: ProductFilterProps) {
  const { products, loading } = useSalesProducts();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const visibleProducts = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) => product.toLowerCase().includes(term));
  }, [products, deferredSearch]);

  if (loading || products.length <= 1) return null;

  // Empty selection means "all" — keeps the query param off the wire in the default case.
  const allSelected = selectedProducts.length === 0 || selectedProducts.length === products.length;

  const handleToggle = (product: string) => {
    if (selectedProducts.length === 0) {
      onSelectionChange(products.filter((p) => p !== product));
      return;
    }

    if (selectedProducts.includes(product)) {
      const next = selectedProducts.filter((p) => p !== product);
      onSelectionChange(next);
      return;
    }

    const next = [...selectedProducts, product];
    onSelectionChange(next.length === products.length ? [] : next);
  };

  const handleSelectAll = () => {
    onSelectionChange([]);
  };

  const getLabel = () => {
    if (allSelected) return 'Todos os produtos';
    if (selectedProducts.length === 0) return 'Nenhum produto';
    if (selectedProducts.length === 1) return selectedProducts[0];
    return `${selectedProducts.length} produtos`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'gap-1.5 text-xs h-8 max-w-[200px]',
            !allSelected && 'border-accent-readable/30 text-accent-readable',
          )}
        >
          <span className="truncate">{getLabel()}</span>
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        {products.length > SEARCH_THRESHOLD && (
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}

        <div className="space-y-1 max-h-72 overflow-y-auto">
          <button
            onClick={handleSelectAll}
            className={cn(
              'flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-foreground/5 transition-colors',
              allSelected && 'text-accent-readable',
            )}
          >
            <Checkbox checked={allSelected} className="h-3.5 w-3.5" />
            <span>Todos os produtos</span>
          </button>

          <div className="h-px bg-foreground/5 my-1" />

          {visibleProducts.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground/70 text-center">
              Nenhum produto encontrado
            </p>
          ) : (
            visibleProducts.map((product) => (
              <button
                key={product}
                onClick={() => handleToggle(product)}
                className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-foreground/5 transition-colors text-left"
              >
                <Checkbox
                  checked={allSelected || selectedProducts.includes(product)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="truncate">{product}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
