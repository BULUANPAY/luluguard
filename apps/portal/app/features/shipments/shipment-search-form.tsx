import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@luluguard/ui/components/button";
import { Input } from "@luluguard/ui/components/input";
import { Search, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const searchSchema = z.object({
  search: z.string().trim().max(50, "搜尋內容不可超過 50 個字"),
});

type SearchValues = z.infer<typeof searchSchema>;

export function ShipmentSearchForm({
  initialSearch = "",
  onSearch,
}: {
  initialSearch?: string;
  onSearch: (search: string) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SearchValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: { search: initialSearch },
  });

  const clear = () => {
    reset({ search: "" });
    onSearch("");
  };

  return (
    <form
      className="flex flex-1 flex-wrap items-start gap-2"
      onSubmit={handleSubmit(({ search }) => onSearch(search))}
    >
      <div className="min-w-[240px] flex-1">
        <label className="sr-only" htmlFor="shipment-search">
          搜尋貨件
        </label>
        <Input
          id="shipment-search"
          placeholder="輸入貨件編號、起運地或目的地"
          type="search"
          {...register("search")}
        />
        {errors.search ? (
          <p className="mt-1 text-xs text-red-600">{errors.search.message}</p>
        ) : null}
      </div>
      <Button type="submit" variant="outline">
        <Search className="size-4" />
        搜尋
      </Button>
      {initialSearch ? (
        <Button aria-label="清除搜尋" onClick={clear} type="button" variant="ghost">
          <X className="size-4" />
        </Button>
      ) : null}
    </form>
  );
}
