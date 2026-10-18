import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Unified responsive container for tabular data.
 * - Desktop / tablet: native horizontal scroll inside a rounded, bordered surface.
 * - Mobile: same — horizontal scroll keeps column relationships intact.
 *
 * Wrap any `<table className="app-table">` (or the shadcn <Table />) with this.
 */
const TableScroll = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("table-scroll", className)} {...props} />
  ),
);
TableScroll.displayName = "TableScroll";

export { TableScroll };
