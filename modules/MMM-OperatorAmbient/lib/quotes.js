const MAX_QUOTE_CHARACTERS = 180;
const MAX_QUOTE_WORDS = 28;

/**
 * Normalize repeated whitespace.
 * @param {string} value input text.
 * @returns {string} normalized value.
 */
function normalizeWhitespace (value) {
	return String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Check whether a quote is too long to remain glanceable.
 * @param {string} text quote text.
 * @returns {boolean} true when the quote is too long.
 */
function isQuoteTooLong (text) {
	if (text.length > MAX_QUOTE_CHARACTERS) {
		return true;
	}

	return text.split(" ").filter(Boolean).length > MAX_QUOTE_WORDS;
}

/**
 * Validate one quote entry from the bundled dataset.
 * @param {object} item raw quote entry.
 * @returns {object|null} normalized quote or null.
 */
function validateQuote (item) {
	if (!item || typeof item !== "object") {
		return null;
	}

	const text = normalizeWhitespace(item.text);
	const author = normalizeWhitespace(item.author);
	const tag = normalizeWhitespace(item.tag);

	if (!text || !author || isQuoteTooLong(text)) {
		return null;
	}

	return {
		text,
		author,
		tag: tag || null
	};
}

/**
 * Normalize the full quote dataset.
 * @param {object[]} items raw quotes.
 * @returns {object[]} validated quotes.
 */
function loadQuoteSet (items = []) {
	return items
		.map((item) => validateQuote(item))
		.filter(Boolean);
}

module.exports = {
	MAX_QUOTE_CHARACTERS,
	MAX_QUOTE_WORDS,
	isQuoteTooLong,
	loadQuoteSet,
	normalizeWhitespace,
	validateQuote
};
