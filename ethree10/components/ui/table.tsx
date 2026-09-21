import * as React from "react";
import { cn } from "@/lib/utils/cn";

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto overscroll-x-contain">
    <table
      ref={ref}
      // tabular-nums so figures in a column line up digit over digit.
      // Proportional numerals in a money or hours column are the detail that
      // makes a data table read as unconsidered.
      className={cn("w-full caption-bottom text-sm tabular-nums", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  // The header is the one row that stays put while the body scrolls, so it
  // gets its own faint pane to sit on rather than letting rows slide under
  // bare text.
  <thead
    ref={ref}
    className={cn(
      "bg-glass-header backdrop-blur-sm [&_tr]:border-b [&_tr]:table-divider",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "table-divider border-b transition-colors hover:bg-muted/60 data-[state=selected]:bg-muted",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    // whitespace-nowrap by default: at 375px a long title wrapped to seven
    // lines and turned every row into a tower, which is far harder to scan
    // than scrolling the table sideways. Pass `whitespace-normal` on a cell
    // that genuinely wants to wrap.
    className={cn("whitespace-nowrap p-3 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
