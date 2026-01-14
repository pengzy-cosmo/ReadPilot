import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Sanitize text for use in aria-label: collapse whitespace, remove newlines,
 * and truncate to a reasonable length for screen readers.
 */
export function sanitizeAriaLabel(text: string, maxLength = 30): string {
	const cleaned = text
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (cleaned.length <= maxLength) return cleaned;
	return `${cleaned.slice(0, maxLength)}…`;
}

/**
 * Preprocess LaTeX math delimiters to convert \[..\] and \(...\) to $$..$$ and $..$
 * This enables remark-math to parse LaTeX-style delimiters that some LLMs output.
 */
export function preprocessLaTeX(content: string): string {
	// Protect code blocks from replacement by temporarily replacing them
	const codeBlocks: string[] = [];
	let processed = content.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
		codeBlocks.push(match);
		return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
	});

	// Convert \[..\] to $$...$$ (display math)
	// Match \[ followed by content (non-greedy) and \]
	processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$${math}$$`);

	// Convert \(..\) to $..$ (inline math)
	// Match \( followed by content (non-greedy) and \)
	processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math}$`);

	// Restore code blocks
	processed = processed.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[Number(index)]);

	return processed;
}
