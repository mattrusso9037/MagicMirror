const { isQuoteTooLong, loadQuoteSet, validateQuote } = require("../../../../modules/MMM-OperatorAmbient/lib/quotes");

describe("MMM-OperatorAmbient quotes", () => {
	it("filters malformed and oversized quote entries", () => {
		const items = [
			{ text: "Stay curious.", author: "Ada Lovelace", tag: "curiosity" },
			{ text: "", author: "Nobody" },
			{ text: "word ".repeat(30), author: "Too Long" }
		];

		expect(loadQuoteSet(items)).toEqual([{ text: "Stay curious.", author: "Ada Lovelace", tag: "curiosity" }]);
	});

	it("normalizes whitespace in quote content", () => {
		expect(validateQuote({
			text: "  Simplicity   is   power. ",
			author: "  Anonymous ",
			tag: " focus "
		})).toEqual({
			text: "Simplicity is power.",
			author: "Anonymous",
			tag: "focus"
		});
	});

	it("detects glanceability limits", () => {
		expect(isQuoteTooLong("word ".repeat(29).trim())).toBe(true);
		expect(isQuoteTooLong("Small and readable.")).toBe(false);
	});
});
