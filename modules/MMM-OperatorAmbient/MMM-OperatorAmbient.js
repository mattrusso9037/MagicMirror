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
		const sceneTone = this.getSceneTone(now);
		const timeParts = this.getTimeDisplayParts(now, this.config.showSeconds);

		wrapper.id = `${this.identifier}_ambient`;
		wrapper.className = `oa-root oa-root--${sceneTone}${this.isSleeping(now) ? " oa-root--sleeping" : ""}`;
		wrapper.style.setProperty("--oa-accent", this.config.accentColor);
		wrapper.style.setProperty("--oa-drift-x", `${drift.x}px`);
		wrapper.style.setProperty("--oa-drift-y", `${drift.y}px`);
		wrapper.innerHTML = `
			<div class="oa-shell">
				<div class="oa-atmosphere" aria-hidden="true">
					<div class="oa-orb oa-orb--primary"></div>
					<div class="oa-orb oa-orb--secondary"></div>
					<div class="oa-orb oa-orb--tertiary"></div>
					<div class="oa-grid-glow"></div>
				</div>
				<div class="oa-clear-zone" aria-hidden="true"></div>
				<header class="oa-topbar">
					<div class="oa-brand-lockup">
						<div class="oa-brand-eyebrow">${escapeHtml(this.getDayPhaseLabel(now))}</div>
						<div class="oa-brand-name">Operator Ambient</div>
					</div>
					<div class="oa-chip oa-chip--${chip.tone}">${escapeHtml(chip.label)}</div>
				</header>
				<main class="oa-layout">
					<section class="oa-main-row">
						<section class="oa-time-block">
							<div class="oa-clock-time">
								${escapeHtml(timeParts.main)}
								${timeParts.dayPeriod ? `<span class="oa-clock-period">${escapeHtml(timeParts.dayPeriod)}</span>` : ""}
							</div>
							<div class="oa-clock-date">${escapeHtml(this.formatDate(now))}</div>
							<p class="oa-hero-summary">${escapeHtml(this.getHeroSummary(snapshot, now))}</p>
						</section>
						<aside class="oa-weather-rail">
							${this.renderWeatherRail(snapshot?.weather)}
						</aside>
					</section>
					<section class="oa-bottom-row">
						<section class="oa-upcoming-rail">
							${this.renderUpcomingRail(snapshot?.calendar, snapshot?.status, now)}
						</section>
						<footer class="oa-brief-column">
							${this.renderBriefRail(snapshot, now)}
							${this.renderQuote(quote)}
						</footer>
					</section>
				</main>
			</div>
			<div class="oa-dim-layer"></div>
		`;

		return wrapper;
	},

	getCurrentQuote () {
		return this.snapshot?.quotes?.items?.[this.currentQuoteIndex] || null;
	},

	getSceneTone (date) {
		const hour = date.getHours();

		if (hour >= 5 && hour < 11) {
			return "morning";
		}

		if (hour >= 11 && hour < 17) {
			return "day";
		}

		if (hour >= 17 && hour < 21) {
			return "evening";
		}

		return "night";
	},

	getDayPhaseLabel (date) {
		const tone = this.getSceneTone(date);

		if (tone === "morning") {
			return "Morning brief";
		}

		if (tone === "day") {
			return "Daylight focus";
		}

		if (tone === "evening") {
			return "Evening reset";
		}

		return "Night watch";
	},

	getHeroSummary (snapshot, now) {
		const calendar = snapshot?.calendar;
		const currentWeather = snapshot?.weather?.periods?.[0];
		const condition = currentWeather?.condition;
		const nextMeeting = calendar?.nextMeetingStartsAt ? new Date(calendar.nextMeetingStartsAt) : null;

		if (calendar?.nextFreeWindowMinutes && nextMeeting) {
			return `${condition ? `${condition}. ` : ""}${this.formatDuration(calendar.nextFreeWindowMinutes)} of open focus time before ${this.formatTime(nextMeeting, false)}.`;
		}

		if (nextMeeting) {
			return `${condition ? `${condition}. ` : ""}Next conversation starts at ${this.formatTime(nextMeeting, false)}.`;
		}

		if ((calendar?.todayEventCount || 0) === 0) {
			return condition ? `${condition}. The schedule is open and quiet.` : "The schedule is open and quiet.";
		}

		if (calendar?.events?.length) {
			return `${condition ? `${condition}. ` : ""}${calendar.events.length} moments remain on the board today.`;
		}

		return `${this.getDayPhaseLabel(now)} with a calm signal and room to think.`;
	},

	getAgendaTitle (calendar) {
		const count = calendar?.todayEventCount || 0;

		if (count === 0) {
			return "An open day";
		}

		if (count === 1) {
			return "One event shapes today";
		}

		return `${count} events shape today`;
	},

	getAgendaCountLabel (calendar) {
		const visibleCount = calendar?.events?.length || 0;

		if (visibleCount === 0) {
			return "Clear";
		}

		if (visibleCount === 1) {
			return "1 ahead";
		}

		return `${visibleCount} ahead`;
	},

	getTimeDisplayParts (date, showSeconds) {
		const formatter = new Intl.DateTimeFormat(config.locale || "en-US", {
			hour: "numeric",
			minute: "2-digit",
			second: showSeconds ? "2-digit" : undefined,
			hour12: this.config.timeFormat !== 24
		});
		const parts = formatter.formatToParts(date);
		const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value || "";
		const main = parts
			.filter((part) => part.type !== "dayPeriod")
			.map((part) => part.value)
			.join("")
			.replaceAll(/\s+/g, " ")
			.trim();

		return {
			main,
			dayPeriod
		};
	},

	getAgendaSummary (calendar, now) {
		const total = calendar?.todayEventCount || 0;
		const visible = calendar?.events?.length || 0;
		const nextMeeting = calendar?.nextMeetingStartsAt ? new Date(calendar.nextMeetingStartsAt) : null;

		if (!total) {
			return "Nothing scheduled. The mirror stays in ambient mode all day.";
		}

		if (nextMeeting) {
			const minutesUntil = Math.max(0, Math.ceil((nextMeeting.getTime() - now.getTime()) / 60000));
			if (minutesUntil <= 30) {
				return `A meeting starts in ${minutesUntil} minutes. Keep the next move close.`;
			}

			if (calendar?.nextFreeWindowMinutes) {
				return `${this.formatDuration(calendar.nextFreeWindowMinutes)} of open time remains before ${this.formatTime(nextMeeting, false)}.`;
			}
		}

		if (visible < total) {
			return `${visible} upcoming items are shown here, with ${total} total scheduled today.`;
		}

		return total === 1 ? "One commitment shapes the day." : `${total} commitments are spaced across the day.`;
	},

	renderWeatherRail (weather) {
		if (!weather?.periods?.length) {
			return `
				<div class="oa-section-label">Forecast</div>
				<div class="oa-weather-location">${escapeHtml(this.config.weather.label)}</div>
				<div class="oa-weather-empty-note">Weather will appear here when the local feed is available.</div>
			`;
		}

		return `
			<div class="oa-section-label">Next 3 Hours</div>
			<div class="oa-weather-location">${escapeHtml(weather.location)}</div>
			<ul class="oa-weather-list">
				${weather.periods.slice(0, 3).map((period) => `
					<li class="oa-weather-row">
						<div class="oa-weather-time">${escapeHtml(period.label)}</div>
						<span class="wi oa-weather-icon wi-${escapeHtml(period.iconClass || "na")}" aria-hidden="true"></span>
						<div class="oa-weather-temp">${period.temperatureF === null ? "--" : escapeHtml(`${period.temperatureF}°`)}</div>
					</li>
				`).join("")}
			</ul>
		`;
	},

	renderUpcomingRail (calendar, status, now) {
		const event = this.getPrimaryEvent(calendar, now);
		if (event) {
			return `
				<div class="oa-section-label">Upcoming</div>
				<div class="oa-upcoming-block">
					<div class="oa-upcoming-title">${escapeHtml(event.title)}</div>
					<div class="oa-upcoming-meta">${escapeHtml(this.formatUpcomingMeta(event, now))}</div>
				</div>
			`;
		}

		if (status?.calendarAuthState !== "ready") {
			return `
				<div class="oa-section-label">Calendar</div>
				<div class="oa-upcoming-block">
					<div class="oa-upcoming-title">Setup needed</div>
					<div class="oa-upcoming-meta">${escapeHtml(this.getCalendarAttentionSummary(status))}</div>
				</div>
			`;
		}

		return `
			<div class="oa-section-label">Upcoming</div>
			<div class="oa-upcoming-block">
				<div class="oa-upcoming-title">Open day</div>
				<div class="oa-upcoming-meta">No timed meetings are holding the middle of the day.</div>
			</div>
		`;
	},

	renderBriefRail (snapshot, now) {
		return `
			<section class="oa-brief-section">
				<div class="oa-section-label">Today</div>
				<div class="oa-brief-title">${escapeHtml(this.getAgendaTitle(snapshot?.calendar))}</div>
				<div class="oa-brief-copy">${escapeHtml(this.getAgendaSummary(snapshot?.calendar, now))}</div>
			</section>
		`;
	},

	renderQuote (quote) {
		if (!quote) {
			return `
				<section class="oa-quote-section">
					<div class="oa-section-label">Reflection</div>
					<p class="oa-quote-text">Loading quiet signals for the day.</p>
					<div class="oa-quote-meta">Ambient system</div>
				</section>
			`;
		}

		return `
			<section class="oa-quote-section">
				<div class="oa-section-label">Reflection</div>
				<p class="oa-quote-text">${escapeHtml(quote.text)}</p>
				<div class="oa-quote-meta">${escapeHtml(quote.author)}${quote.tag ? ` <span class="oa-quote-tag">${escapeHtml(quote.tag)}</span>` : ""}</div>
			</section>
		`;
	},

	getCalendarAttentionSummary (status) {
		const message = status?.calendarAuthMessage || "";
		if (message.includes("OAuth client ID")) {
			return "Add a Google OAuth client ID in the module config.";
		}

		if (message.includes("/MMM-OperatorAmbient/auth/start")) {
			return "Open the local auth route on the Pi to connect Google Calendar.";
		}

		return "Calendar attention required before events can appear here.";
	},

	getPrimaryEvent (calendar, now) {
		const events = calendar?.events || [];
		const futureEvent = events.find((event) => {
			if (event.isAllDay) {
				return true;
			}

			return new Date(event.endAt || event.startAt).getTime() > now.getTime();
		});

		return futureEvent || null;
	},

	formatUpcomingMeta (event, now) {
		const timeLabel = this.formatEventTime(event, now);
		if (event.location) {
			return `${timeLabel} — ${event.location}`;
		}

		return timeLabel;
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
