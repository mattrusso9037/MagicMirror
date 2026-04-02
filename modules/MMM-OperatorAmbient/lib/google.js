const crypto = require("node:crypto");

const GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/calendar.readonly",
	"https://www.googleapis.com/auth/userinfo.email"
];

/**
 * Create a PKCE verifier and challenge pair.
 * @returns {{ verifier: string, challenge: string }} PKCE values.
 */
function createPkcePair () {
	const verifier = base64UrlEncode(crypto.randomBytes(48));
	const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());

	return { verifier, challenge };
}

/**
 * Create a CSRF state token.
 * @returns {string} state token.
 */
function createOAuthState () {
	return base64UrlEncode(crypto.randomBytes(24));
}

/**
 * Build the Google authorization URL for a local loopback flow.
 * @param {object} options auth options.
 * @returns {string} authorization URL.
 */
function buildAuthorizationUrl (options) {
	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	url.searchParams.set("client_id", options.clientId);
	url.searchParams.set("redirect_uri", options.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("prompt", "consent");
	url.searchParams.set("state", options.state);
	url.searchParams.set("code_challenge", options.challenge);
	url.searchParams.set("code_challenge_method", "S256");

	return url.toString();
}

/**
 * Exchange an authorization code for tokens.
 * @param {object} options exchange options.
 * @returns {Promise<object>} token payload.
 */
async function exchangeAuthorizationCode (options) {
	const form = new URLSearchParams({
		client_id: options.clientId,
		code: options.code,
		code_verifier: options.codeVerifier,
		grant_type: "authorization_code",
		redirect_uri: options.redirectUri
	});

	if (options.clientSecret) {
		form.set("client_secret", options.clientSecret);
	}

	const response = await options.fetchImpl("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: form
	});

	if (!response.ok) {
		throw await buildGoogleError(response);
	}

	return response.json();
}

/**
 * Refresh an access token from a stored refresh token.
 * @param {object} options refresh options.
 * @returns {Promise<string>} new access token.
 */
async function refreshAccessToken (options) {
	const form = new URLSearchParams({
		client_id: options.clientId,
		grant_type: "refresh_token",
		refresh_token: options.refreshToken
	});

	if (options.clientSecret) {
		form.set("client_secret", options.clientSecret);
	}

	const response = await options.fetchImpl("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: form
	});

	if (!response.ok) {
		throw await buildGoogleError(response);
	}

	const payload = await response.json();
	return payload.access_token;
}

/**
 * Retrieve the signed-in account email from Google.
 * @param {object} options request options.
 * @returns {Promise<string>} account email.
 */
async function fetchUserEmail (options) {
	const response = await options.fetchImpl("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: {
			Authorization: `Bearer ${options.accessToken}`
		}
	});

	if (!response.ok) {
		throw await buildGoogleError(response);
	}

	const payload = await response.json();
	return payload.email;
}

/**
 * Fetch upcoming events for each configured Google calendar.
 * @param {object} options request options.
 * @returns {Promise<Array<{sourceCalendar: string, item: object}>>} event tuples.
 */
async function fetchCalendarEvents (options) {
	const allEvents = [];

	for (const calendarId of options.calendarIds) {
		const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
		url.searchParams.set("singleEvents", "true");
		url.searchParams.set("orderBy", "startTime");
		url.searchParams.set("timeMin", options.timeMin);
		url.searchParams.set("timeMax", options.timeMax);
		url.searchParams.set("maxResults", "16");
		url.searchParams.set("timeZone", options.timeZone);

		const response = await options.fetchImpl(url, {
			headers: {
				Authorization: `Bearer ${options.accessToken}`
			}
		});

		if (!response.ok) {
			throw await buildGoogleError(response);
		}

		const payload = await response.json();
		for (const item of payload.items || []) {
			allEvents.push({
				sourceCalendar: calendarId,
				item
			});
		}
	}

	return allEvents;
}

/**
 * Convert provider response failures into a richer error object.
 * @param {Response} response fetch response.
 * @returns {Promise<Error>} parsed error.
 */
async function buildGoogleError (response) {
	const rawBody = await response.text();
	let parsedBody = null;

	try {
		parsedBody = JSON.parse(rawBody);
	} catch (error) {
		parsedBody = null;
	}

	const reason = parsedBody?.error_description || parsedBody?.error?.message || parsedBody?.error || response.statusText || "Google request failed.";
	const error = new Error(reason);
	error.status = response.status;
	error.code = parsedBody?.error;
	error.isAuthError = response.status === 401 || parsedBody?.error === "invalid_grant" || parsedBody?.error === "unauthorized_client";
	error.rawBody = rawBody;

	return error;
}

/**
 * Encode bytes for PKCE parameters.
 * @param {Buffer} value source bytes.
 * @returns {string} base64url string.
 */
function base64UrlEncode (value) {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

module.exports = {
	GOOGLE_SCOPES,
	buildAuthorizationUrl,
	createOAuthState,
	createPkcePair,
	exchangeAuthorizationCode,
	fetchCalendarEvents,
	fetchUserEmail,
	refreshAccessToken
};
