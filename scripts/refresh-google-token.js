#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/calendar.readonly",
	"https://www.googleapis.com/auth/userinfo.email"
];

const DEFAULT_OUTPUT = path.resolve(process.cwd(), "tmp", "MMM-OperatorAmbient-google-token.json");
const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Entry point for the token refresh script.
 * @returns {Promise<void>}
 */
async function main () {
	const options = parseArgs(process.argv.slice(2), process.env);

	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}

	if (!options.clientId) {
		throw new Error("Missing Google OAuth client ID. Pass --cid=... or set GOOGLE_CLIENT_ID.");
	}

	process.stdout.write("Starting Google Calendar token refresh helper.\n");
	process.stdout.write(`Resolved output path: ${options.outputPath}\n`);
	process.stdout.write("This file is written on the machine running this command. Copy it to the Pi after it is created.\n");

	const callbackServer = await createCallbackServer();
	const pkce = createPkcePair();
	const state = createOAuthState();
	const authUrl = buildAuthorizationUrl({
		challenge: pkce.challenge,
		clientId: options.clientId,
		redirectUri: callbackServer.redirectUri,
		state
	});

	process.stdout.write(`OAuth callback redirect URI: ${callbackServer.redirectUri}\n`);
	process.stdout.write(`Open this URL if the browser does not launch automatically:\n\n${authUrl}\n\n`);

	if (options.openBrowser) {
		openBrowser(authUrl);
	}

	process.stdout.write("Waiting for the Google OAuth callback...\n");

	let callbackResult;

	try {
		callbackResult = await waitForCallback(callbackServer.server, state);
	} finally {
		await closeServer(callbackServer.server);
	}

	process.stdout.write("OAuth callback received. Exchanging authorization code for tokens...\n");

	const tokenPayload = await exchangeAuthorizationCode({
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		code: callbackResult.code,
		codeVerifier: pkce.verifier,
		redirectUri: callbackServer.redirectUri
	});

	if (!tokenPayload.refresh_token) {
		throw new Error("Google did not return a refresh token. Remove any prior grant for this client and retry.");
	}

	process.stdout.write("Token exchange succeeded. Fetching signed-in account email...\n");

	const email = await fetchUserEmail(tokenPayload.access_token);
	const outputPayload = {
		email,
		refreshToken: tokenPayload.refresh_token,
		updatedAt: new Date().toISOString()
	};

	process.stdout.write(`Writing token file to ${options.outputPath}...\n`);

	try {
		await fs.mkdir(path.dirname(options.outputPath), {
			recursive: true
		});
		await fs.writeFile(options.outputPath, `${JSON.stringify(outputPayload, null, "\t")}\n`, {
			mode: 0o600
		});
	} catch (error) {
		throw new Error(`Failed to write ${options.outputPath}: ${error.message}`);
	}

	const fileStats = await fs.stat(options.outputPath);

	process.stdout.write(`Wrote ${options.outputPath} (${fileStats.size} bytes)\n`);
	process.stdout.write("Copy this file to the Pi at config/MMM-OperatorAmbient/google-token.json and restart MagicMirror.\n");
}

/**
 * Parse CLI flags and npm config env vars.
 * @param {string[]} argv raw CLI args.
 * @param {NodeJS.ProcessEnv} env process env.
 * @returns {object} normalized options.
 */
function parseArgs (argv, env) {
	const flags = parseFlags(argv);

	return {
		clientId: firstDefined(
			flags.cid,
			flags["client-id"],
			env.GOOGLE_CLIENT_ID,
			env.npm_config_cid,
			env.npm_config_client_id
		),
		clientSecret: firstDefined(
			flags.secret,
			flags["client-secret"],
			env.GOOGLE_CLIENT_SECRET,
			env.npm_config_secret,
			env.npm_config_client_secret,
			""
		),
		help: Boolean(flags.help || flags.h),
		openBrowser: getBooleanOption(flags.open, env.npm_config_open, true),
		outputPath: path.resolve(
			firstDefined(
				flags.out,
				flags.output,
				env.GOOGLE_TOKEN_OUT,
				env.npm_config_out,
				env.npm_config_output,
				DEFAULT_OUTPUT
			)
		)
	};
}

/**
 * Parse `--key=value`, `--key value`, and `--no-key` forms.
 * @param {string[]} argv raw args.
 * @returns {Record<string, string|boolean>} parsed flags.
 */
function parseFlags (argv) {
	const flags = {};

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (!current.startsWith("-")) {
			continue;
		}

		if (current.startsWith("--no-")) {
			flags[current.slice(5)] = false;
			continue;
		}

		if (current.startsWith("--")) {
			const eqIndex = current.indexOf("=");
			if (eqIndex > -1) {
				flags[current.slice(2, eqIndex)] = current.slice(eqIndex + 1);
				continue;
			}

			const next = argv[index + 1];
			if (next && !next.startsWith("-")) {
				flags[current.slice(2)] = next;
				index += 1;
				continue;
			}

			flags[current.slice(2)] = true;
			continue;
		}

		flags[current.slice(1)] = true;
	}

	return flags;
}

/**
 * Format CLI usage text.
 * @returns {string} usage output.
 */
function usage () {
	return [
		"Usage:",
		"  npm run refresh -- --cid=YOUR_GOOGLE_CLIENT_ID --secret=YOUR_GOOGLE_CLIENT_SECRET",
		"  npm run refresh --cid=YOUR_GOOGLE_CLIENT_ID --secret=YOUR_GOOGLE_CLIENT_SECRET",
		"",
		"Options:",
		"  --cid, --client-id       Google OAuth client ID (required)",
		"  --secret, --client-secret  Google OAuth client secret",
		"  --out, --output          Output path for google-token.json",
		"  --no-open                Do not auto-open the browser",
		"  --help                   Show this help",
		"",
		`Default output: ${DEFAULT_OUTPUT}`
	].join("\n");
}

/**
 * Create a localhost callback server on an ephemeral port.
 * @returns {Promise<{server: http.Server, redirectUri: string}>}
 */
async function createCallbackServer () {
	const server = http.createServer();

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve({
				redirectUri: `http://127.0.0.1:${address.port}/callback`,
				server
			});
		});
	});
}

/**
 * Wait for the Google OAuth callback.
 * @param {http.Server} server callback server.
 * @param {string} expectedState state token to validate.
 * @returns {Promise<{code: string}>}
 */
function waitForCallback (server, expectedState) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Timed out waiting for the Google OAuth callback."));
		}, CALLBACK_TIMEOUT_MS);

		server.once("request", (req, res) => {
			clearTimeout(timeout);

			const requestUrl = new URL(req.url, "http://127.0.0.1");
			const state = requestUrl.searchParams.get("state");
			const code = requestUrl.searchParams.get("code");
			const error = requestUrl.searchParams.get("error");

			if (error) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(renderStatusPage("Sign-In Failed", `Google returned: ${error}. You can close this tab.`));
				reject(new Error(`Google sign-in failed: ${error}.`));
				return;
			}

			if (!code || state !== expectedState) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(renderStatusPage("Invalid Callback", "The Google callback did not match the active session. You can close this tab."));
				reject(new Error("Google callback was missing a code or had an invalid state."));
				return;
			}

			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Google Auth Received", "The Google OAuth callback was received. You can close this tab."));
			resolve({ code });
		});
	});
}

/**
 * Close the callback server.
 * @param {http.Server} server server to close.
 * @returns {Promise<void>}
 */
async function closeServer (server) {
	if (!server.listening) {
		return;
	}

	await new Promise((resolve) => {
		server.close(() => resolve());
	});
}

/**
 * Build the Google authorization URL.
 * @param {object} options URL options.
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
 * Exchange the Google authorization code for tokens.
 * @param {object} options token exchange options.
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

	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: form
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google token exchange failed with status ${response.status}: ${body}`);
	}

	return response.json();
}

/**
 * Fetch the signed-in user's email.
 * @param {string} accessToken Google access token.
 * @returns {Promise<string>} email address.
 */
async function fetchUserEmail (accessToken) {
	const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google user info request failed with status ${response.status}: ${body}`);
	}

	const payload = await response.json();
	return payload.email;
}

/**
 * Create a PKCE verifier and challenge pair.
 * @returns {{ verifier: string, challenge: string }} PKCE values.
 */
function createPkcePair () {
	const verifier = base64UrlEncode(crypto.randomBytes(48));
	const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());

	return { challenge, verifier };
}

/**
 * Create a CSRF state token.
 * @returns {string} state token.
 */
function createOAuthState () {
	return base64UrlEncode(crypto.randomBytes(24));
}

/**
 * Encode bytes for PKCE parameters.
 * @param {Buffer} value bytes to encode.
 * @returns {string} base64url string.
 */
function base64UrlEncode (value) {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

/**
 * Open the auth URL in a desktop browser if possible.
 * @param {string} authUrl URL to open.
 */
function openBrowser (authUrl) {
	const command = process.platform === "darwin"
		? ["open", [authUrl]]
		: process.platform === "win32"
			? ["cmd", ["/c", "start", "", authUrl]]
			: ["xdg-open", [authUrl]];

	const child = spawn(command[0], command[1], {
		detached: true,
		stdio: "ignore"
	});
	child.unref();
}

/**
 * Render a tiny callback status page.
 * @param {string} title page title.
 * @param {string} message page body.
 * @returns {string} HTML page.
 */
function renderStatusPage (title, message) {
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>${escapeHtml(title)}</title>
</head>
<body style="font-family: sans-serif; padding: 24px;">
	<h1>${escapeHtml(title)}</h1>
	<p>${escapeHtml(message)}</p>
</body>
</html>`;
}

/**
 * Escape HTML in simple text content.
 * @param {string} value text to escape.
 * @returns {string} escaped text.
 */
function escapeHtml (value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\"", "&quot;")
		.replaceAll("'", "&#39;");
}

/**
 * Return the first non-empty string-like value.
 * @param {...*} values candidate values.
 * @returns {*} first defined candidate.
 */
function firstDefined (...values) {
	for (const value of values) {
		if (value !== undefined && value !== null && value !== "") {
			return value;
		}
	}

	return undefined;
}

/**
 * Parse a boolean option with fallback behavior.
 * @param {* } cliValue raw CLI value.
 * @param {*} envValue raw env value.
 * @param {boolean} fallback default value.
 * @returns {boolean} normalized boolean.
 */
function getBooleanOption (cliValue, envValue, fallback) {
	const chosen = cliValue === undefined ? envValue : cliValue;

	if (chosen === undefined) {
		return fallback;
	}

	if (typeof chosen === "boolean") {
		return chosen;
	}

	return !["0", "false", "no"].includes(String(chosen).toLowerCase());
}

if (require.main === module) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	});
}

module.exports = {
	DEFAULT_OUTPUT,
	buildAuthorizationUrl,
	getBooleanOption,
	parseArgs,
	parseFlags,
	usage
};
