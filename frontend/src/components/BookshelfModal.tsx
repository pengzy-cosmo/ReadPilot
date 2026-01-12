/** BookshelfModal - Modal listing recent documents for quick access. */
import { BookOpen, FolderOpen, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type DocumentInfo, deleteDocument } from "@/lib/api";
import { cn } from "@/lib/utils";

interface BookshelfModalProps {
	isOpen: boolean;
	onClose: () => void;
	documents: DocumentInfo[];
	onOpenDocument: (docId: string) => void;
	onImportClick: () => void;
	onDelete: (docId: string) => void;
}

const formatBytes = (bytes: number) => {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
};

const formatTimestamp = (value?: number) => {
	if (!value) return "Unknown";
	return new Date(value).toLocaleString();
};

export function BookshelfModal({
	isOpen,
	onClose,
	documents,
	onOpenDocument,
	onImportClick,
	onDelete,
}: BookshelfModalProps) {
	if (!isOpen) return null;

	const totalSize = documents.reduce((acc, doc) => acc + doc.file_size, 0);

	const handleDelete = async (e: React.MouseEvent, docId: string) => {
		e.stopPropagation();
		if (!confirm("Are you sure you want to delete this document?")) return;
		try {
			await deleteDocument(docId);
			toast.success("Document deleted");
			onDelete(docId);
		} catch (error) {
			console.error("Failed to delete document:", error);
			toast.error("Failed to delete document");
		}
	};

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
							<p className="text-xs text-muted-foreground">
								{documents.length} documents · Total size: {formatBytes(totalSize)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<Button variant="outline" size="sm" className="h-8 gap-2" onClick={onImportClick}>
							<FolderOpen className="size-3.5" />
							<span className="hidden sm:inline">Open PDF</span>
							<span className="sm:hidden">Open</span>
						</Button>
						<Button variant="ghost" size="icon" onClick={onClose}>
							<X className="size-4" />
							<span className="sr-only">Close</span>
						</Button>
					</div>
				</CardHeader>
				<CardContent className="flex-1 min-h-0 p-0">
					<ScrollArea className="h-full">
						<div className="pl-6 pr-6 py-4 space-y-3">
							{documents.length === 0 && (
								<div className="text-sm text-muted-foreground text-center py-12">No recent documents yet.</div>
							)}
							{documents.map((doc) => (
								<div
									key={doc.doc_id}
									className={cn(
										"group w-full rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-left transition grid grid-cols-[1fr_auto] gap-4 items-center",
										"hover:bg-muted/40 hover:border-border",
									)}
								>
									<button
										type="button"
										onClick={() => onOpenDocument(doc.doc_id)}
										className="flex items-center gap-3 min-w-0 overflow-hidden text-left"
									>
										<div className="size-9 shrink-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
											<BookOpen className="size-4" />
										</div>
										<div className="min-w-0 flex-1 space-y-0.5">
											<div className="font-medium truncate">{doc.title || doc.filename}</div>
											<div className="text-xs text-muted-foreground flex gap-2 items-center min-w-0">
												<span className="truncate">{doc.filename}</span>
												<span className="shrink-0">·</span>
												<span className="shrink-0">{formatBytes(doc.file_size)}</span>
											</div>
											<div className="text-xs text-muted-foreground truncate">
												Last page: {doc.last_page} · Last opened: {formatTimestamp(doc.last_opened_at)}
											</div>
										</div>
									</button>
									<Button
										variant="ghost"
										size="icon"
										className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
										onClick={(e) => handleDelete(e, doc.doc_id)}
									>
										<Trash2 className="size-4" />
									</Button>
								</div>
							))}
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	);
}
