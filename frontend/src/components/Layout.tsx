/** Layout - Root layout wrapper for the application. */
import type { ReactNode } from "react";

interface LayoutProps {
	children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
	return (
		<div className="flex h-screen flex-col text-foreground overflow-hidden">
			<main className="relative mx-auto flex h-full w-full max-w-[1920px] min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{children}
			</main>
		</div>
	);
}
