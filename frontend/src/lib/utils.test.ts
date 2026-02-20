/** utils.test.ts - Tests for utility functions */
import { describe, expect, it } from "vitest";
import { cn, preprocessLaTeX, sanitizeAriaLabel } from "./utils";

describe("cn", () => {
	it("should merge class names with tailwind-merge", () => {
		expect(cn("class1", "class2")).toBe("class1 class2");
	});

	it("should handle conditional classes", () => {
		expect(cn("base", true && "active", false && "inactive")).toBe("base active");
	});

	it("should handle undefined and null values", () => {
		expect(cn("base", undefined, null, "end")).toBe("base end");
	});

	it("should merge conflicting tailwind classes", () => {
		expect(cn("px-2", "px-4")).toBe("px-4");
		expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
	});

	it("should handle empty inputs", () => {
		expect(cn()).toBe("");
		expect(cn("")).toBe("");
	});
});

describe("sanitizeAriaLabel", () => {
	it("should remove newlines and extra whitespace", () => {
		expect(sanitizeAriaLabel("Hello\nWorld")).toBe("Hello World");
		expect(sanitizeAriaLabel("Hello\r\nWorld")).toBe("Hello World");
	});

	it("should collapse multiple spaces", () => {
		expect(sanitizeAriaLabel("Hello    World")).toBe("Hello World");
	});

	it("should trim whitespace", () => {
		expect(sanitizeAriaLabel("  Hello World  ")).toBe("Hello World");
	});

	it("should truncate text longer than maxLength", () => {
		const longText = "This is a very long text that should be truncated";
		// The function keeps spaces before truncation point
		expect(sanitizeAriaLabel(longText, 20)).toBe("This is a very long …");
	});

	it("should not truncate text shorter than maxLength", () => {
		expect(sanitizeAriaLabel("Short text", 50)).toBe("Short text");
	});

	it("should use default maxLength of 30", () => {
		// "This is exactly thirty charact" is 30 chars, so it gets truncated
		const text = "This is exactly thirty charact";
		expect(sanitizeAriaLabel(text)).toBe("This is exactly thirty charact");
		// Text longer than 30 chars gets truncated
		const longText = "This is exactly thirty characters!";
		expect(sanitizeAriaLabel(longText)).toBe("This is exactly thirty charact…");
	});
});

describe("preprocessLaTeX", () => {
	it("should convert \\[...\\] to $$...$$", () => {
		const input = "Here is display math: \\[E = mc^2\\]";
		const expected = "Here is display math: $$E = mc^2$$";
		expect(preprocessLaTeX(input)).toBe(expected);
	});

	it("should convert \\(...\\) to $...$", () => {
		const input = "Here is inline math: \\(x^2 + y^2 = z^2\\)";
		const expected = "Here is inline math: $x^2 + y^2 = z^2$";
		expect(preprocessLaTeX(input)).toBe(expected);
	});

	it("should handle multiple LaTeX expressions", () => {
		const input = "Inline: \\(a + b\\) and display: \\[a^2 + b^2\\]";
		const expected = "Inline: $a + b$ and display: $$a^2 + b^2$$";
		expect(preprocessLaTeX(input)).toBe(expected);
	});

	it("should not modify content inside code blocks", () => {
		const input = "```\nSome code with \\(latex\\) here\n```";
		expect(preprocessLaTeX(input)).toBe(input);
	});

	it("should not modify inline code", () => {
		const input = "Here is `inline code with \\(latex\\)`";
		expect(preprocessLaTeX(input)).toBe(input);
	});

	it("should handle LaTeX with special characters", () => {
		const input = "Equation: \\[\\sum_{i=1}^{n} x_i\\]";
		const expected = "Equation: $$\\sum_{i=1}^{n} x_i$$";
		expect(preprocessLaTeX(input)).toBe(expected);
	});

	it("should handle multiline LaTeX", () => {
		const input = "Matrix:\\[\n  a & b \\\\\n  c & d\n\\]";
		const expected = "Matrix:$$\n  a & b \\\\\n  c & d\n$$";
		expect(preprocessLaTeX(input)).toBe(expected);
	});

	it("should handle mixed content with code and LaTeX", () => {
		const input = "Formula: \\(x = 1\\) and code: `const x = 1`";
		const expected = "Formula: $x = 1$ and code: `const x = 1`";
		expect(preprocessLaTeX(input)).toBe(expected);
	});

	it("should handle empty string", () => {
		expect(preprocessLaTeX("")).toBe("");
	});

	it("should handle text without LaTeX", () => {
		const input = "Plain text without any math";
		expect(preprocessLaTeX(input)).toBe(input);
	});
});
