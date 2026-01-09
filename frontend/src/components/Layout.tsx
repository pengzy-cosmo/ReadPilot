import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col relative w-full h-full min-h-0 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
