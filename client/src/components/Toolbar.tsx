import { useMemo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SortKey = "username-asc" | "username-desc" | "newest" | "oldest";

export function Toolbar({
  search,
  onSearchChange,
  sort,
  onSortChange,
  onClear,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onClear: () => void;
}) {
  const sortLabel = useMemo(() => {
    switch (sort) {
      case "username-asc":
        return "Username (A-Z)";
      case "username-desc":
        return "Username (Z-A)";
      case "newest":
        return "Newest first";
      case "oldest":
        return "Oldest first";
      default:
        return "Sort";
    }
  }, [sort]);

  return (
    <div
      className={cn(
        "glass rounded-2xl p-4 md:p-5",
        "flex flex-col md:flex-row gap-3 md:items-center md:justify-between",
      )}
    >
      <div className="relative flex-1">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by username..."
          type="search"
          className={cn(
            "pl-10 pr-10 rounded-xl bg-background/60",
            "border-2 focus:ring-4 focus:ring-ring/10 focus:border-ring",
            "transition-all duration-200",
          )}
          data-testid="input-search"
        />
        {search ? (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2",
              "h-7 w-7 rounded-lg grid place-items-center",
              "text-muted-foreground",
              "transition-colors",
              "focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/15",
            )}
            aria-label="Clear search"
            data-testid="button-clear-search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "rounded-xl",
                "bg-background/60",
                "border-2",
                "transition-all duration-200",
              )}
              data-testid="button-sort"
            >
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              {sortLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 rounded-2xl p-2">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Sort
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="rounded-xl"
              onClick={() => onSortChange("newest")}
              data-testid="sort-newest"
            >
              Newest first
            </DropdownMenuItem>
            <DropdownMenuItem
              className="rounded-xl"
              onClick={() => onSortChange("oldest")}
              data-testid="sort-oldest"
            >
              Oldest first
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="rounded-xl"
              onClick={() => onSortChange("username-asc")}
              data-testid="sort-username-asc"
            >
              Username (A-Z)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="rounded-xl"
              onClick={() => onSortChange("username-desc")}
              data-testid="sort-username-desc"
            >
              Username (Z-A)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
