import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full bg-emerald-50 px-2.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100",
        className,
      )}
      {...props}
    />
  );
}
