const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const Log = require("logger");
const NodeHelper = require("node_helper");

const { CALENDAR_STALE_MS, normalizeCalendarEvents } = require("./lib/calendar");
const { buildAuthorizationUrl, createOAuthState, createPkcePair, exchangeAuthorizationCode, fetchCalendarEvents, fetchUserEmail, refreshAccessToken } = require("./lib/google");
const { loadQuoteSet } = require("./lib/quotes");
const { ensureStorageDir, readJson, writeJson } = require("./lib/storage");
const { DEFAULT_WEATHER, WEATHER_STALE_MS, getObservationUrl, normalizeWeatherResponse } = require("./lib/weather");

const CONFIG_NOTIFICATION = "MMM_OPERATOR_AMBIENT_CONFIG";
const SNAPSHOT_NOTIFICATION = "MMM_OPERATOR_AMBIENT_SNAPSHOT";
const OAUTH_TIMEOUT_MS = 10 * 60 * 1000;

const DEFAULT_CONFIG = {
	calendarPollMs: 15 * 60 * 1000,
	weatherPollMs: 10 * 60 * 1000,
	weather: DEFAULT_WEATHER,
	google: {
		clientId: "",
		clientSecret: "",
		calendarIds: ["primary"]
	}
};

/**
 * Create the default runtime state shape.
 * @returns {object} state object.
 */
function createDefaultState () {
	return {
		offline: false,
		calendar: {
			authState: "required",
			authMessage: "Open the local auth route on the Pi to connect Google Calendar.",
			lastSuccessAt: null,
			lastError: null
		},
		weather: {
			lastSuccessAt: null,
			lastError: null
		}
	};
}

/**
 * Build a minimal error or success page for the auth flow.
 * @param {string} title page title.
 * @param {string} message page body.
 * @returns {string} HTML document.
 */
function renderStatusPage (title, message) {
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<title>${escapeHtml(title)}</title>
	<style>
		body {
			background: #06080b;
			color: #e8eef2;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			padding: 40px;
		}
		.card {
			max-width: 640px;
			margin: 0 auto;
			padding: 24px 28px;
			border: 1px solid rgba(255, 255, 255, 0.12);
			border-radius: 18px;
			background: rgba(255, 255, 255, 0.05);
		}
		h1 {
			margin-top: 0;
			font-size: 28px;
		}
		p {
			color: rgba(232, 238, 242, 0.76);
			line-height: 1.55;
		}
		code {
			color: #ee6c4d;
			font-family: ui-monospace, SFMono-Regular, monospace;
		}
	</style>
</head>
<body>
	<div class="card">
		<h1>${escapeHtml(title)}</h1>
		<p>${escapeHtml(message)}</p>
	</div>
</body>
</html>`;
}

/**
 * Escape HTML content for a tiny inline template.
 * @param {string} value raw string.
 * @returns {string} escaped string.
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
 * Determine whether a request came from the local machine.
 * @param {import("express").Request} req express request.
 * @returns {boolean} true when the request is loopback.
 */
function isLoopbackRequest (req) {
	const candidates = [req.ip, req.socket?.remoteAddress, req.connection?.remoteAddress].filter(Boolean);
	return candidates.some((value) => value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1");
}

/**
 * Merge user config with defaults.
 * @param {object} config raw module config.
 * @returns {object} normalized config.
 */
function normalizeConfig (config = {}) {
	const weather = Object.assign({}, DEFAULT_WEATHER, config.weather);
	const google = Object.assign({}, DEFAULT_CONFIG.google, config.google);

	return {
		calendarPollMs: Math.max(60 * 1000, config.calendarPollMs || DEFAULT_CONFIG.calendarPollMs),
		weatherPollMs: Math.max(60 * 1000, config.weatherPollMs || DEFAULT_CONFIG.weatherPollMs),
		weather: {
			lat: Number(weather.lat),
			lon: Number(weather.lon),
			label: weather.label || DEFAULT_WEATHER.label
		},
		google: {
			clientId: (google.clientId || "").trim(),
			clientSecret: (google.clientSecret || "").trim(),
			calendarIds: Array.isArray(google.calendarIds) && google.calendarIds.length ? google.calendarIds : ["primary"]
		}
	};
}

/**
 * Merge a stored state object into the default state shape.
 * @param {object|null} value stored state.
 * @returns {object} merged state.
 */
function mergeState (value) {
	const defaults = createDefaultState();
	return {
		offline: Boolean(value?.offline),
		calendar: Object.assign({}, defaults.calendar, value?.calendar),
		weather: Object.assign({}, defaults.weather, value?.weather)
	};
}

/**
 * Determine whether an error likely represents a network issue.
 * @param {Error} error failure to classify.
 * @returns {boolean} true when the error looks network related.
 */
function isLikelyNetworkError (error) {
	const code = error?.code || "";
	const message = error?.message || "";

	return [
		"EAI_AGAIN",
		"ECONNREFUSED",
		"ECONNRESET",
		"ENOTFOUND",
		"ETIMEDOUT"
	].includes(code) || (/fetch failed|network|timed out|ENOTFOUND|ECONN/i).test(message);
}

module.exports = NodeHelper.create({
	async start () {
		Log.log(`Starting node helper for: ${this.name}`);

		this.config = normalizeConfig();
		this.quotes = [];
		this.weatherCache = null;
		this.calendarCache = this.emptyCalendar();
		this.state = createDefaultState();
		this.pollingStarted = false;
		this.calendarTimer = null;
		this.weatherTimer = null;
		this.activeOAuth = null;
		this.weatherEndpoints = null;
		this.storageDir = path.resolve(global.root_path, "config", this.name);
		this.storagePaths = {
			token: path.join(this.storageDir, "google-token.json"),
			calendar: path.join(this.storageDir, "calendar-cache.json"),
			weather: path.join(this.storageDir, "weather-cache.json"),
			state: path.join(this.storageDir, "state.json")
		};

		await ensureStorageDir(this.storageDir);
		await this.loadQuotes();
		await this.loadRuntimeState();
	},

	setExpressApp (app) {
		this._super(app);

		app.get(`/${this.name}/auth/start`, (req, res) => {
			void this.handleAuthStart(req, res);
		});
	},

	async socketNotificationReceived (notification, payload) {
		if (notification !== CONFIG_NOTIFICATION) {
			return;
		}

		this.config = normalizeConfig(payload);
		this.weatherEndpoints = null;
		await this.refreshCalendarAuthState();
		this.sendSnapshot();

		if (!this.pollingStarted) {
			this.startPolling();
		}
	},

	async stop () {
		clearInterval(this.calendarTimer);
		clearInterval(this.weatherTimer);
		await this.closeOAuthSession();
	},

	emptyCalendar () {
		return {
			events: [],
			nextMeetingStartsAt: null,
			nextFreeWindowMinutes: null,
			todayEventCount: 0
		};
	},

	async loadQuotes () {
		try {
			const raw = JSON.parse(await fs.readFile(path.join(__dirname, "quotes.json"), "utf8"));
			this.quotes = loadQuoteSet(raw);
		} catch (error) {
			Log.error(`[${this.name}] Could not load bundled quotes:`, error);
			this.quotes = [];
		}
	},

	async loadRuntimeState () {
		this.state = mergeState(await readJson(this.storagePaths.state, null));
		this.calendarCache = Object.assign(this.emptyCalendar(), await readJson(this.storagePaths.calendar, null) || {});
		this.weatherCache = await readJson(this.storagePaths.weather, null);
	},

	async persistState () {
		await writeJson(this.storagePaths.state, this.state);
	},

	async refreshCalendarAuthState () {
		if (!this.config.google.clientId) {
			this.setCalendarAuth("required", "Add a Google OAuth client ID to the MMM-OperatorAmbient config.");
			await this.persistState();
			return;
		}

		const token = await this.readToken();
		if (!token?.refreshToken) {
			this.setCalendarAuth("required", "Open /MMM-OperatorAmbient/auth/start on the Pi to connect Google Calendar.");
			await this.persistState();
			return;
		}

		if (this.state.calendar.authState !== "error") {
			this.setCalendarAuth("ready", null);
			await this.persistState();
		}
	},

	startPolling () {
		this.pollingStarted = true;

		void this.refreshWeather();
		void this.refreshCalendar();

		this.weatherTimer = setInterval(() => {
			void this.refreshWeather();
		}, this.config.weatherPollMs);

		this.calendarTimer = setInterval(() => {
			void this.refreshCalendar();
		}, this.config.calendarPollMs);
	},

	async handleAuthStart (req, res) {
		if (!isLoopbackRequest(req)) {
			res.status(403).send(renderStatusPage("Local Access Required", "Open this route from the Raspberry Pi browser session. Remote devices are intentionally blocked for the local loopback Google sign-in flow."));
			return;
		}

		if (!this.config.google.clientId) {
			res.status(400).send(renderStatusPage("Missing OAuth Config", "Add your Google desktop OAuth client ID to the MMM-OperatorAmbient config before starting sign-in."));
			return;
		}

		try {
			const authUrl = await this.beginOAuthSession();
			res.redirect(authUrl);
		} catch (error) {
			Log.error(`[${this.name}] Failed to start Google auth flow:`, error);
			res.status(500).send(renderStatusPage("Sign-In Failed", error.message || "Could not start the Google sign-in flow."));
		}
	},

	async beginOAuthSession () {
		await this.closeOAuthSession();

		const { verifier, challenge } = createPkcePair();
		const state = createOAuthState();

		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				void this.handleOAuthCallback(req, res);
			});

			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				const redirectUri = `http://127.0.0.1:${address.port}/callback`;

				this.activeOAuth = {
					server,
					state,
					verifier,
					redirectUri,
					timeout: setTimeout(() => {
						void this.closeOAuthSession();
						this.setCalendarAuth("error", "Google sign-in timed out. Open the local auth route again.");
						void this.persistState();
						this.sendSnapshot();
					}, OAUTH_TIMEOUT_MS)
				};

				resolve(buildAuthorizationUrl({
					challenge,
					clientId: this.config.google.clientId,
					redirectUri,
					state
				}));
			});
		});
	},

	async handleOAuthCallback (req, res) {
		const session = this.activeOAuth;
		if (!session) {
			res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Session Expired", "This sign-in session is no longer active. Open the local auth route again."));
			return;
		}

		const requestUrl = new URL(req.url, "http://127.0.0.1");
		if (requestUrl.pathname !== "/callback") {
			res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Not Found", "That callback route does not exist."));
			return;
		}

		const errorParam = requestUrl.searchParams.get("error");
		if (errorParam) {
			this.setCalendarAuth("error", `Google sign-in failed: ${errorParam}.`);
			await this.persistState();
			this.sendSnapshot();
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Sign-In Failed", `Google returned: ${errorParam}.`));
			await this.closeOAuthSession();
			return;
		}

		const state = requestUrl.searchParams.get("state");
		const code = requestUrl.searchParams.get("code");

		if (!code || state !== session.state) {
			this.setCalendarAuth("error", "Google sign-in returned an invalid callback. Start the auth flow again.");
			await this.persistState();
			this.sendSnapshot();
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Invalid Callback", "The Google callback was missing a code or did not match the active session."));
			await this.closeOAuthSession();
			return;
		}

		try {
			const tokenPayload = await exchangeAuthorizationCode({
				clientId: this.config.google.clientId,
				clientSecret: this.config.google.clientSecret,
				code,
				codeVerifier: session.verifier,
				fetchImpl: fetch,
				redirectUri: session.redirectUri
			});

			if (!tokenPayload.refresh_token) {
				throw new Error("Google did not return a refresh token. Remove any existing token file and retry with prompt=consent.");
			}

			const email = await fetchUserEmail({
				accessToken: tokenPayload.access_token,
				fetchImpl: fetch
			});

			await writeJson(this.storagePaths.token, {
				email,
				refreshToken: tokenPayload.refresh_token,
				updatedAt: new Date().toISOString()
			});

			this.setCalendarAuth("ready", null);
			this.state.calendar.lastError = null;
			await this.persistState();
			this.sendSnapshot();

			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Calendar Connected", `Google Calendar is now connected for ${email}. You can close this browser tab.`));

			void this.refreshCalendar();
		} catch (error) {
			Log.error(`[${this.name}] Google auth callback failed:`, error);
			this.setCalendarAuth("error", error.message || "Google sign-in failed.");
			this.state.calendar.lastError = error.message || "Google sign-in failed.";
			await this.persistState();
			this.sendSnapshot();
			res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderStatusPage("Sign-In Failed", error.message || "Google sign-in could not be completed."));
		} finally {
			await this.closeOAuthSession();
		}
	},

	async closeOAuthSession () {
		const session = this.activeOAuth;
		this.activeOAuth = null;

		if (!session) {
			return;
		}

		clearTimeout(session.timeout);
		await new Promise((resolve) => {
			session.server.close(() => resolve());
		});
	},

	async refreshWeather () {
		try {
			const rawWeather = await this.fetchWeatherData();
			const normalizedWeather = normalizeWeatherResponse(rawWeather, this.config.weather);

			if (normalizedWeather) {
				this.weatherCache = normalizedWeather;
				this.state.weather.lastSuccessAt = new Date().toISOString();
				this.state.weather.lastError = null;
				this.state.offline = false;

				await writeJson(this.storagePaths.weather, normalizedWeather);
				await this.persistState();
			}
		} catch (error) {
			Log.error(`[${this.name}] Weather refresh failed:`, error);
			this.state.weather.lastError = error.message || "Weather refresh failed.";
			if (isLikelyNetworkError(error)) {
				this.state.offline = true;
			}
			await this.persistState();
		} finally {
			this.sendSnapshot();
		}
	},

	async fetchWeatherData () {
		const endpoints = await this.getWeatherEndpoints();
		const headers = {
			Accept: "application/geo+json",
			"User-Agent": `MagicMirror/${global.version || "local"} MMM-OperatorAmbient`
		};

		const hourlyForecast = await this.fetchJson(endpoints.hourlyForecastUrl, { headers });
		let currentObservation = null;

		if (endpoints.observationUrl) {
			try {
				currentObservation = await this.fetchJson(endpoints.observationUrl, { headers });
			} catch (error) {
				Log.warn(`[${this.name}] Falling back to forecast-only weather because the latest observation fetch failed.`);
			}
		}

		return {
			currentObservation,
			hourlyForecast,
			pointData: endpoints.pointData
		};
	},

	async getWeatherEndpoints () {
		const key = `${this.config.weather.lat}:${this.config.weather.lon}`;
		if (this.weatherEndpoints?.key === key) {
			return this.weatherEndpoints;
		}

		const headers = {
			Accept: "application/geo+json",
			"User-Agent": `MagicMirror/${global.version || "local"} MMM-OperatorAmbient`
		};
		const pointData = await this.fetchJson(`https://api.weather.gov/points/${this.config.weather.lat},${this.config.weather.lon}`, { headers });
		const stationsData = await this.fetchJson(pointData.properties.observationStations, { headers });

		this.weatherEndpoints = {
			key,
			hourlyForecastUrl: pointData.properties.forecastHourly,
			observationUrl: getObservationUrl(stationsData),
			pointData
		};

		return this.weatherEndpoints;
	},

	async refreshCalendar () {
		if (!this.config.google.clientId) {
			await this.refreshCalendarAuthState();
			this.sendSnapshot();
			return;
		}

		const token = await this.readToken();
		if (!token?.refreshToken) {
			await this.refreshCalendarAuthState();
			this.sendSnapshot();
			return;
		}

		try {
			const accessToken = await refreshAccessToken({
				clientId: this.config.google.clientId,
				clientSecret: this.config.google.clientSecret,
				fetchImpl: fetch,
				refreshToken: token.refreshToken
			});

			const now = new Date();
			const startOfDay = new Date(now);
			const endOfWindow = new Date(now);
			startOfDay.setHours(0, 0, 0, 0);
			endOfWindow.setHours(endOfWindow.getHours() + 24);

			const events = await fetchCalendarEvents({
				accessToken,
				calendarIds: this.config.google.calendarIds,
				fetchImpl: fetch,
				timeMax: endOfWindow.toISOString(),
				timeMin: startOfDay.toISOString(),
				timeZone: this.getTimeZone()
			});

			this.calendarCache = normalizeCalendarEvents(events, {
				horizonHours: 24,
				maxEvents: 4,
				now
			});
			this.state.calendar.lastSuccessAt = new Date().toISOString();
			this.state.calendar.lastError = null;
			this.state.offline = false;
			this.setCalendarAuth("ready", null);

			await writeJson(this.storagePaths.calendar, this.calendarCache);
			await this.persistState();
		} catch (error) {
			Log.error(`[${this.name}] Calendar refresh failed:`, error);
			this.state.calendar.lastError = error.message || "Calendar refresh failed.";

			if (error.isAuthError) {
				this.setCalendarAuth("error", "Google calendar sign-in expired. Delete google-token.json or open the local auth route again.");
			} else if (isLikelyNetworkError(error)) {
				this.state.offline = true;
				this.setCalendarAuth("ready", null);
			}

			await this.persistState();
		} finally {
			this.sendSnapshot();
		}
	},

	async readToken () {
		const token = await readJson(this.storagePaths.token, null);
		if (!token?.refreshToken) {
			return null;
		}

		return token;
	},

	setCalendarAuth (authState, authMessage) {
		this.state.calendar.authState = authState;
		this.state.calendar.authMessage = authMessage;
	},

	getTimeZone () {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
	},

	buildSnapshot () {
		const now = Date.now();
		const lastCalendarSyncAt = this.state.calendar.lastSuccessAt;
		const lastWeatherSyncAt = this.state.weather.lastSuccessAt;

		return {
			generatedAt: new Date().toISOString(),
			status: {
				isOffline: Boolean(this.state.offline),
				lastCalendarSyncAt,
				lastWeatherSyncAt,
				calendarStale: Boolean(lastCalendarSyncAt) && now - new Date(lastCalendarSyncAt).getTime() > CALENDAR_STALE_MS,
				weatherStale: Boolean(lastWeatherSyncAt) && now - new Date(lastWeatherSyncAt).getTime() > WEATHER_STALE_MS,
				calendarAuthState: this.state.calendar.authState,
				calendarAuthMessage: this.state.calendar.authMessage
			},
			clock: {
				timezone: this.getTimeZone()
			},
			weather: this.weatherCache,
			calendar: this.calendarCache || this.emptyCalendar(),
			quotes: {
				items: this.quotes
			}
		};
	},

	sendSnapshot () {
		this.sendSocketNotification(SNAPSHOT_NOTIFICATION, this.buildSnapshot());
	},

	async fetchJson (url, options = {}) {
		const response = await fetch(url, options);
		if (!response.ok) {
			const error = new Error(`${response.status} ${response.statusText}`);
			error.status = response.status;
			throw error;
		}

		return response.json();
	}
});
