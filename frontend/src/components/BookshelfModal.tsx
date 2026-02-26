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
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm p-4">
			<Card className="flex h-[75vh] w-full max-w-4xl flex-col rounded-2xl border-border/70 bg-card/95 shadow-2xl">
				<CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
					<div className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
							<BookOpen className="size-4" aria-hidden="true" />
						</div>
						<div>
							<CardTitle className="text-base">Library</CardTitle>
							<p className="text-xs text-muted-foreground">
								{documents.length} documents · Total size: {formatBytes(totalSize)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<Button
							variant="outline"
							size="sm"
							className="h-8 gap-2 rounded-full border-border/70 bg-card/80"
							onClick={onImportClick}
						>
							<FolderOpen className="size-3.5" aria-hidden="true" />
							<span className="hidden sm:inline">Open PDF</span>
							<span className="sm:hidden">Open</span>
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={onClose}
							aria-label="Close"
							className="rounded-lg hover:bg-muted/70"
						>
							<X className="size-4" aria-hidden="true" />
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
										"group grid w-full grid-cols-[1fr_auto] items-center gap-4 rounded-xl border border-border/60 bg-card/65 px-4 py-3 text-left transition",
										"hover:border-border hover:bg-muted/45",
									)}
								>
									<button
										type="button"
										onClick={() => onOpenDocument(doc.doc_id)}
										className="flex items-center gap-3 min-w-0 overflow-hidden text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none rounded-lg"
									>
										<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/75 text-muted-foreground">
											<BookOpen className="size-4" aria-hidden="true" />
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
										className="shrink-0 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive"
										onClick={(e) => handleDelete(e, doc.doc_id)}
										aria-label={`Delete ${doc.title || doc.filename}`}
									>
										<Trash2 className="size-4" aria-hidden="true" />
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
