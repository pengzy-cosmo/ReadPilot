/** BookshelfModal - Modal listing recent documents for quick access. */
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DocumentInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface BookshelfModalProps {
	isOpen: boolean;
	onClose: () => void;
	documents: DocumentInfo[];
	onOpenDocument: (docId: string) => void;
}

const formatTimestamp = (value?: number) => {
	if (!value) return "Unknown";
	return new Date(value).toLocaleString();
};

export function BookshelfModal({ isOpen, onClose, documents, onOpenDocument }: BookshelfModalProps) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
			<Card className="w-full max-w-4xl h-[75vh] border-border/60 bg-background/95 shadow-2xl flex flex-col">
				<CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/40 px-6 py-4">
					<div className="flex items-center gap-2">
						<div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
							<BookOpen className="size-4" />
						</div>
						<div>
							<CardTitle className="text-base">Library</CardTitle>
							<p className="text-xs text-muted-foreground">Open a recent document</p>
						</div>
					</div>
					<Button variant="ghost" size="icon" onClick={onClose}>
						<X className="size-4" />
						<span className="sr-only">Close</span>
					</Button>
				</CardHeader>
				<CardContent className="flex-1 min-h-0 p-0">
					<ScrollArea className="h-full">
						<div className="px-6 py-4 space-y-3">
							{documents.length === 0 && (
								<div className="text-sm text-muted-foreground text-center py-12">No recent documents yet.</div>
							)}
							{documents.map((doc) => (
								<button
									key={doc.doc_id}
									type="button"
									onClick={() => onOpenDocument(doc.doc_id)}
									className={cn(
										"group w-full rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-left transition flex items-center justify-between gap-4",
										"hover:bg-muted/40 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									)}
								>
									<div className="flex items-center gap-3 min-w-0 flex-1">
										<div className="size-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
											<BookOpen className="size-4" />
										</div>
										<div className="min-w-0">
											<div className="font-medium truncate">{doc.title || doc.filename}</div>
											<div className="text-xs text-muted-foreground truncate">{doc.filename}</div>
											<div className="text-xs text-muted-foreground mt-1">
												Last page: {doc.last_page} · Last opened: {formatTimestamp(doc.last_opened_at)}
											</div>
										</div>
									</div>
								</button>
							))}
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	);
}
