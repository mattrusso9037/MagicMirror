const CONFIG_NOTIFICATION = "MMM_OPERATOR_AMBIENT_CONFIG";
const SNAPSHOT_NOTIFICATION = "MMM_OPERATOR_AMBIENT_SNAPSHOT";

Module.register("MMM-OperatorAmbient", {
	defaults: {
		timeFormat: config.timeFormat,
		showSeconds: false,
		quoteRotationMs: 45 * 1000,
		calendarPollMs: 15 * 60 * 1000,
		weatherPollMs: 10 * 60 * 1000,
		accentColor: "#EE6C4D",
		sleepHours: {
			start: 22,
			end: 6
		},
		weather: {
			lat: 39.2997,
			lon: -75.6050,
			label: "Smyrna, DE"
		},
		google: {
			clientId: "",
			clientSecret: "",
			calendarIds: ["primary"]
		}
	},

	getStyles () {
		return ["font-awesome.css", "weather-icons.css", "operator-ambient.css"];
	},

	start () {
		this.snapshot = null;
		this.currentQuoteIndex = null;
		this.quoteBag = [];
		this.suspended = false;
		this.driftOffsets = [
			{ x: 0, y: 0 },
			{ x: 3, y: -2 },
			{ x: -4, y: 3 },
			{ x: 2, y: 4 }
		];
		this.driftIndex = 0;
		this.clockTimer = null;
		this.quoteTimer = null;
		this.driftTimer = null;

		this.sendSocketNotification(CONFIG_NOTIFICATION, this.config);
		this.startTimers();
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== SNAPSHOT_NOTIFICATION) {
			return;
		}

		this.snapshot = payload;
		this.ensureQuoteSelection();
		this.updateDom(400);
	},

	suspend () {
		this.suspended = true;
		this.stopTimers();
	},

	resume () {
		this.suspended = false;
		this.startTimers();
		this.sendSocketNotification(CONFIG_NOTIFICATION, this.config);
		this.updateDom(0);
	},

	startTimers () {
		this.stopTimers();
		this.scheduleClockTick();

		this.quoteTimer = setInterval(() => {
			if (!this.suspended) {
				this.rotateQuote();
			}
		}, this.config.quoteRotationMs);

		this.driftTimer = setInterval(() => {
			if (!this.suspended) {
				this.driftIndex = (this.driftIndex + 1) % this.driftOffsets.length;
				this.updateDom(350);
			}
		}, 5 * 60 * 1000);
	},

	stopTimers () {
		clearTimeout(this.clockTimer);
		clearInterval(this.quoteTimer);
		clearInterval(this.driftTimer);
		this.clockTimer = null;
		this.quoteTimer = null;
		this.driftTimer = null;
	},

	scheduleClockTick () {
		const delay = this.config.showSeconds ? 1000 : (60 - new Date().getSeconds()) * 1000;
		this.clockTimer = setTimeout(() => {
			if (!this.suspended) {
				this.updateDom(100);
				this.scheduleClockTick();
			}
		}, delay);
	},

	ensureQuoteSelection () {
		const quotes = this.snapshot?.quotes?.items || [];
		if (!quotes.length) {
			this.currentQuoteIndex = null;
			this.quoteBag = [];
			return;
		}

		if (this.currentQuoteIndex === null || !quotes[this.currentQuoteIndex]) {
			this.rotateQuote(true);
		}
	},

	rotateQuote (force = false) {
		const quotes = this.snapshot?.quotes?.items || [];
		if (!quotes.length) {
			return;
		}

		if (!this.quoteBag.length) {
			this.quoteBag = this.shuffleIndices(quotes.length, this.currentQuoteIndex);
		}

		const nextIndex = this.quoteBag.shift();
		if (nextIndex === undefined) {
			return;
		}

		if (!force && nextIndex === this.currentQuoteIndex && quotes.length > 1) {
			return this.rotateQuote(force);
		}

		this.currentQuoteIndex = nextIndex;
		this.updateDom(450);
	},

	shuffleIndices (length, currentIndex) {
		const indices = Array.from({ length }, (_, index) => index);
		for (let i = indices.length - 1; i > 0; i -= 1) {
			const swapIndex = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[swapIndex]] = [indices[swapIndex], indices[i]];
		}

		if (indices[0] === currentIndex && indices.length > 1) {
			[indices[0], indices[1]] = [indices[1], indices[0]];
		}

		return indices;
	},

	getDom () {
		const wrapper = document.createElement("div");
		const now = new Date();
		const snapshot = this.snapshot;
		const drift = this.driftOffsets[this.driftIndex] || this.driftOffsets[0];
		const quote = this.getCurrentQuote();
		const chip = this.getCalendarChip(snapshot?.calendar, now);

		wrapper.id = `${this.identifier}_ambient`;
		wrapper.className = `oa-root${this.isSleeping(now) ? " oa-root--sleeping" : ""}`;
		wrapper.style.setProperty("--oa-accent", this.config.accentColor);
		wrapper.style.setProperty("--oa-drift-x", `${drift.x}px`);
		wrapper.style.setProperty("--oa-drift-y", `${drift.y}px`);
		wrapper.innerHTML = `
			<div class="oa-shell">
				<section class="oa-clock-panel">
					<div class="oa-eyebrow">Operator Ambient</div>
					<div class="oa-clock-time">${escapeHtml(this.formatTime(now, this.config.showSeconds))}</div>
					<div class="oa-clock-date">${escapeHtml(this.formatDate(now))}</div>
					<div class="oa-chip oa-chip--${chip.tone}">${escapeHtml(chip.label)}</div>
				</section>
				<section class="oa-weather-card">
					${this.renderWeather(snapshot?.weather)}
				</section>
				<section class="oa-quote-panel">
					<div class="oa-panel-label">Quote</div>
					${this.renderQuote(quote)}
				</section>
				<aside class="oa-events-panel">
					<div class="oa-panel-label">Calendar</div>
					${this.renderCalendarState(snapshot?.status)}
					${this.renderEvents(snapshot?.calendar, now)}
				</aside>
				<div class="oa-status-row">
					${this.renderStatus(snapshot?.status)}
				</div>
			</div>
			<div class="oa-dim-layer"></div>
		`;

		return wrapper;
	},

	getCurrentQuote () {
		return this.snapshot?.quotes?.items?.[this.currentQuoteIndex] || null;
	},

	renderQuote (quote) {
		if (!quote) {
			return `
				<div class="oa-quote-copy">
					<p class="oa-quote-text">Loading quiet signals for the day.</p>
					<div class="oa-quote-meta">Ambient system</div>
				</div>
			`;
		}

		return `
			<div class="oa-quote-copy">
				<p class="oa-quote-text">“${escapeHtml(quote.text)}”</p>
				<div class="oa-quote-meta">${escapeHtml(quote.author)}${quote.tag ? ` <span class="oa-quote-tag">${escapeHtml(quote.tag)}</span>` : ""}</div>
			</div>
		`;
	},

	renderWeather (weather) {
		if (!weather?.periods?.length) {
			return `
				<div class="oa-weather-header">
					<div class="oa-weather-location">${escapeHtml(this.config.weather.label)}</div>
					<div class="oa-weather-empty">Weather unavailable</div>
				</div>
			`;
		}

		return `
			<div class="oa-weather-header">
				<div class="oa-weather-location">${escapeHtml(weather.location)}</div>
			</div>
			<div class="oa-weather-periods">
				${weather.periods.map((period) => `
					<div class="oa-weather-period">
						<div class="oa-weather-label">${escapeHtml(period.label)}</div>
						<div class="oa-weather-main">
							<span class="wi oa-weather-icon wi-${escapeHtml(period.iconClass || "na")}"></span>
							<span class="oa-weather-temp">${period.temperatureF === null ? "--" : escapeHtml(`${period.temperatureF}°`)}</span>
						</div>
						<div class="oa-weather-condition">${escapeHtml(period.condition)}</div>
						<div class="oa-weather-rain">${period.rainChance === null ? "Rain --" : escapeHtml(`Rain ${period.rainChance}%`)}</div>
					</div>
				`).join("")}
			</div>
		`;
	},

	renderCalendarState (status) {
		if (!status || status.calendarAuthState === "ready") {
			return "";
		}

		const tone = status.calendarAuthState === "error" ? "error" : "setup";
		return `<div class="oa-calendar-state oa-calendar-state--${tone}">${escapeHtml(status.calendarAuthMessage || "Calendar attention required.")}</div>`;
	},

	renderEvents (calendar, now) {
		if (!calendar?.events?.length) {
			return `<div class="oa-events-empty">${calendar?.todayEventCount ? "No more timed meetings today." : "No meetings scheduled today."}</div>`;
		}

		return `
			<ul class="oa-event-list">
				${calendar.events.map((event) => `
					<li class="oa-event-item">
						<div class="oa-event-time">${escapeHtml(this.formatEventTime(event, now))}</div>
						<div class="oa-event-body">
							<div class="oa-event-title">${escapeHtml(event.title)}</div>
							${event.location ? `<div class="oa-event-location">${escapeHtml(event.location)}</div>` : ""}
						</div>
					</li>
				`).join("")}
			</ul>
		`;
	},

	renderStatus (status) {
		if (!status) {
			return `
				<div class="oa-status-pill oa-status-pill--neutral">Calendar syncing</div>
				<div class="oa-status-pill oa-status-pill--neutral">Weather syncing</div>
			`;
		}

		const pills = [
			this.getStatusPill("Calendar", status.lastCalendarSyncAt, status.calendarStale, status.calendarAuthState !== "ready"),
			this.getStatusPill("Weather", status.lastWeatherSyncAt, status.weatherStale, false)
		];

		if (status.isOffline) {
			pills.push({
				label: "Offline cache mode",
				tone: "warning"
			});
		}

		return pills.map((pill) => `<div class="oa-status-pill oa-status-pill--${pill.tone}">${escapeHtml(pill.label)}</div>`).join("");
	},

	getStatusPill (name, timestamp, isStale, needsAttention) {
		if (needsAttention) {
			return {
				label: `${name} setup needed`,
				tone: "warning"
			};
		}

		if (!timestamp) {
			return {
				label: `${name} syncing`,
				tone: "neutral"
			};
		}

		if (isStale) {
			return {
				label: `${name} stale`,
				tone: "warning"
			};
		}

		return {
			label: `${name} ${this.formatSyncTime(timestamp)}`,
			tone: "ok"
		};
	},

	getCalendarChip (calendar, now) {
		const nextMeeting = calendar?.nextMeetingStartsAt ? new Date(calendar.nextMeetingStartsAt) : null;
		if (nextMeeting) {
			const minutesUntil = Math.max(0, Math.ceil((nextMeeting.getTime() - now.getTime()) / 60000));
			if (minutesUntil <= 30) {
				return {
					label: `Next meeting in ${minutesUntil} min`,
					tone: "urgent"
				};
			}

			if ((calendar?.nextFreeWindowMinutes || 0) >= 60) {
				return {
					label: `Clear for ${this.formatDuration(calendar.nextFreeWindowMinutes)}`,
					tone: "focus"
				};
			}

			return {
				label: `Next at ${this.formatTime(nextMeeting, false)}`,
				tone: "neutral"
			};
		}

		if ((calendar?.todayEventCount || 0) === 0) {
			return {
				label: "No meetings today",
				tone: "calm"
			};
		}

		return {
			label: "No timed meetings",
			tone: "calm"
		};
	},

	formatTime (date, showSeconds) {
		return new Intl.DateTimeFormat(config.locale || "en-US", {
			hour: "numeric",
			minute: "2-digit",
			second: showSeconds ? "2-digit" : undefined,
			hour12: this.config.timeFormat !== 24
		}).format(date);
	},

	formatDate (date) {
		return new Intl.DateTimeFormat(config.locale || "en-US", {
			weekday: "long",
			month: "long",
			day: "numeric"
		}).format(date);
	},

	formatEventTime (event, now) {
		if (event.isAllDay) {
			return "All day";
		}

		const eventDate = new Date(event.startAt);
		const options = this.isSameDay(eventDate, now)
			? { hour: "numeric", minute: "2-digit", hour12: this.config.timeFormat !== 24 }
			: { weekday: "short", hour: "numeric", minute: "2-digit", hour12: this.config.timeFormat !== 24 };

		return new Intl.DateTimeFormat(config.locale || "en-US", options).format(eventDate);
	},

	formatSyncTime (timestamp) {
		return `synced ${new Intl.DateTimeFormat(config.locale || "en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: this.config.timeFormat !== 24
		}).format(new Date(timestamp))}`;
	},

	formatDuration (minutes) {
		if (minutes < 60) {
			return `${minutes} min`;
		}

		const hours = Math.floor(minutes / 60);
		const remainder = minutes % 60;

		if (!remainder) {
			return `${hours}h`;
		}

		return `${hours}h ${remainder}m`;
	},

	isSameDay (left, right) {
		return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
	},

	isSleeping (date) {
		const start = Number(this.config.sleepHours?.start);
		const end = Number(this.config.sleepHours?.end);
		const hour = date.getHours();

		if (Number.isNaN(start) || Number.isNaN(end)) {
			return false;
		}

		if (start === end) {
			return false;
		}

		if (start < end) {
			return hour >= start && hour < end;
		}

		return hour >= start || hour < end;
	}
});

/**
 * Escape HTML for string interpolation.
 * @param {string} value raw text.
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
