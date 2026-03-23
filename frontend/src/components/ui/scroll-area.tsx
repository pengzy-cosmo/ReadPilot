import * as React from "react";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
	({ className, children, ...props }, ref) => {
		return (
			<div ref={ref} data-slot="scroll-area" className={cn("relative overflow-hidden", className)} {...props}>
				<div data-slot="scroll-area-viewport" className="size-full rounded-[inherit] overflow-auto">
					{children}
				</div>
			</div>
		);
	},
);
ScrollArea.displayName = "ScrollArea";

function ScrollBar({
	className: _className,
	orientation: _orientation = "vertical",
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
	// Native CSS scrollbar handles rendering; this component is kept for API compatibility
	return null;
}

export { ScrollArea, ScrollBar };
