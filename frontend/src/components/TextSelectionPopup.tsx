/** TextSelectionPopup - Floating button shown after text selection in PDF viewer. */
import { Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

export interface TextSelectionPopupProps {
	/** Container element to track selection within */
	containerRef: React.RefObject<HTMLElement | null>;
	/** Callback when user confirms adding the selected text */
	onAddSelection: (text: string) => void;
	/** Callback when user wants to explain the selected text immediately */
	onExplainSelection?: (text: string) => void;
	/** Maximum allowed length for selected text */
	maxLength?: number;
}

interface PopupPosition {
	x: number;
	y: number;
}

/**
 * Displays a floating "Add to context" button when text is selected in the PDF viewer.
 * Uses portal to render outside the container for proper z-index stacking.
 */
export function TextSelectionPopup({
	containerRef,
	onAddSelection,
	onExplainSelection,
	maxLength = 2000,
}: TextSelectionPopupProps) {
	const [selectedText, setSelectedText] = useState<string | null>(null);
	const [position, setPosition] = useState<PopupPosition | null>(null);
	const [isVisible, setIsVisible] = useState(false);
	const popupRef = useRef<HTMLDivElement | null>(null);

	/** Get currently selected text within the container. */
	const getSelectedTextInContainer = useCallback(() => {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || !selection.rangeCount) {
			return null;
		}

		const container = containerRef.current;
		if (!container) return null;

		// Check if selection is within the container
		const range = selection.getRangeAt(0);
		if (!container.contains(range.commonAncestorContainer)) {
			return null;
		}

		const text = selection.toString().trim();
		if (!text || text.length < 3) {
			return null; // Ignore very short selections
		}

		return text;
	}, [containerRef]);

	/** Calculate popup position based on selection range. */
	const calculatePosition = useCallback(() => {
		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) return null;

		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();

		// Position above the selection, centered horizontally
		return {
			x: rect.left + rect.width / 2,
			y: rect.top - 8, // Slightly above the selection
		};
	}, []);

	/** Handle mouseup event to detect text selection. */
	const handleMouseUp = useCallback(() => {
		// Small delay to ensure selection is complete
		requestAnimationFrame(() => {
			const text = getSelectedTextInContainer();
			if (text) {
				const pos = calculatePosition();
				if (pos) {
					setSelectedText(text);
					setPosition(pos);
					setIsVisible(true);
				}
			}
		});
	}, [calculatePosition, getSelectedTextInContainer]);

	/** Handle adding selection to context. */
	const handleAction = useCallback(
		(action: "add" | "explain") => {
			if (!selectedText) return;

			// Truncate if exceeds max length
			const textToAdd = selectedText.length > maxLength ? selectedText.slice(0, maxLength) : selectedText;

			if (action === "add") {
				onAddSelection(textToAdd);
			} else if (action === "explain" && onExplainSelection) {
				onExplainSelection(textToAdd);
			}

			setIsVisible(false);
			setSelectedText(null);

			// Clear the browser selection
			window.getSelection()?.removeAllRanges();
		},
		[maxLength, onAddSelection, onExplainSelection, selectedText],
	);

	/** Close popup when clicking outside or selection changes. */
	const handleClickOutside = useCallback((event: MouseEvent) => {
		if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
			setIsVisible(false);
			setSelectedText(null);
		}
	}, []);

	/** Close popup on scroll to avoid position mismatch. */
	const handleScroll = useCallback(() => {
		setIsVisible(false);
		setSelectedText(null);
	}, []);

	// Add event listeners
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.addEventListener("mouseup", handleMouseUp);
		container.addEventListener("keyup", handleMouseUp); // For keyboard selection (Shift+Arrow)
		container.addEventListener("touchend", handleMouseUp); // For touch devices
		document.addEventListener("mousedown", handleClickOutside);
		container.addEventListener("scroll", handleScroll, true);

		return () => {
			container.removeEventListener("mouseup", handleMouseUp);
			container.removeEventListener("keyup", handleMouseUp);
			container.removeEventListener("touchend", handleMouseUp);
			document.removeEventListener("mousedown", handleClickOutside);
			container.removeEventListener("scroll", handleScroll, true);
		};
	}, [containerRef, handleClickOutside, handleMouseUp, handleScroll]);

	// Close on Escape key
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && isVisible) {
				setIsVisible(false);
				setSelectedText(null);
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isVisible]);

	if (!isVisible || !position) return null;

	return createPortal(
		<div
			ref={popupRef}
			className="fixed z-[9999]"
			style={{
				left: position.x,
				top: position.y,
				transform: "translate(-50%, -100%)",
				paddingBottom: "8px", // Add spacing from selection
			}}
		>
			<div className="flex items-center gap-0.5 p-1 rounded-full bg-foreground/90 shadow-xl shadow-black/10 border border-border/10 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
				<Button
					size="sm"
					onClick={() => handleAction("add")}
					className="h-7 px-3 rounded-full hover:bg-white/20 text-background gap-1.5 border-0 bg-transparent"
					aria-label="Add to context list"
				>
					<Plus className="h-3.5 w-3.5" aria-hidden="true" />
					<span className="text-xs font-medium">Add</span>
				</Button>

				{onExplainSelection && (
					<>
						<div className="w-px h-3 bg-background/20 mx-0.5" aria-hidden="true" />
						<Button
							size="sm"
							onClick={() => handleAction("explain")}
							className="h-7 px-3 rounded-full hover:bg-white/20 text-background gap-1.5 border-0 bg-transparent"
							aria-label="Ask AI to explain this text"
						>
							<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
							<span className="text-xs font-medium">Explain</span>
						</Button>
					</>
				)}
			</div>
		</div>,
		document.body,
	);
}
