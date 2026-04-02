const CALENDAR_STALE_MS = 20 * 60 * 1000;

/**
 * Normalize one Google Calendar event.
 * @param {object} item raw Google event.
 * @param {string|null} sourceCalendar configured calendar id.
 * @returns {object|null} normalized event.
 */
function normalizeGoogleEvent (item, sourceCalendar = null) {
	if (!item || item.status === "cancelled" || !item.start) {
		return null;
	}

	const isAllDay = Boolean(item.start.date);
	const startAt = isAllDay ? normalizeAllDayDate(item.start.date) : normalizeDateTime(item.start.dateTime);
	const endAt = isAllDay ? normalizeAllDayDate(item.end?.date) : normalizeDateTime(item.end?.dateTime);

	if (!startAt) {
		return null;
	}

	return {
		id: item.id || `${sourceCalendar || "calendar"}-${startAt}`,
		title: item.summary || "Untitled event",
		startAt,
		endAt,
		isAllDay,
		location: item.location || null,
		sourceCalendar: sourceCalendar || null,
		status: item.status || null
	};
}

/**
 * Normalize and summarize a collection of Google Calendar events.
 * @param {Array<{sourceCalendar: string|null, item: object}>} rawEvents raw event tuples.
 * @param {object} options normalization options.
 * @returns {object} normalized calendar data.
 */
function normalizeCalendarEvents (rawEvents, options = {}) {
	const now = options.now ? new Date(options.now) : new Date();
	const horizonHours = options.horizonHours || 24;
	const maxEvents = options.maxEvents || 4;
	const dayStart = new Date(now);
	const dayEnd = new Date(now);
	const horizonEnd = new Date(now);

	dayStart.setHours(0, 0, 0, 0);
	dayEnd.setHours(24, 0, 0, 0);
	horizonEnd.setHours(horizonEnd.getHours() + horizonHours);

	const allEvents = rawEvents
		.map(({ sourceCalendar, item }) => normalizeGoogleEvent(item, sourceCalendar))
		.filter(Boolean)
		.sort(sortEvents);

	const todayEventCount = allEvents.filter((event) => overlapsWindow(event, dayStart, dayEnd)).length;
	const visibleEvents = allEvents
		.filter((event) => overlapsWindow(event, dayStart, horizonEnd) && eventEndsAfter(event, now))
		.slice(0, maxEvents);

	const timedEvents = allEvents.filter((event) => !event.isAllDay && eventEndsAfter(event, now));
	const currentTimedEvent = timedEvents.find((event) => isOngoing(event, now)) || null;
	const nextTimedEvent = timedEvents.find((event) => getStartTime(event) > now.getTime()) || null;

	let nextFreeWindowMinutes = null;
	if (currentTimedEvent) {
		const currentEnd = getEndTime(currentTimedEvent);
		const nextAfterCurrent = timedEvents.find((event) => getStartTime(event) >= currentEnd);
		if (nextAfterCurrent) {
			nextFreeWindowMinutes = diffMinutes(currentEnd, getStartTime(nextAfterCurrent));
		}
	} else if (nextTimedEvent) {
		nextFreeWindowMinutes = diffMinutes(now.getTime(), getStartTime(nextTimedEvent));
	}

	return {
		events: visibleEvents,
		nextMeetingStartsAt: nextTimedEvent ? nextTimedEvent.startAt : null,
		nextFreeWindowMinutes,
		todayEventCount
	};
}

/**
 * Convert a Google all-day date string to local midnight ISO.
 * @param {string|null} value Google date string.
 * @returns {string|null} ISO timestamp.
 */
function normalizeAllDayDate (value) {
	if (!value) {
		return null;
	}

	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Convert a Google dateTime string to ISO.
 * @param {string|null} value raw dateTime.
 * @returns {string|null} ISO timestamp.
 */
function normalizeDateTime (value) {
	if (!value) {
		return null;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Determine whether an event overlaps a target window.
 * @param {object} event normalized event.
 * @param {Date} windowStart window start.
 * @param {Date} windowEnd window end.
 * @returns {boolean} true when the event overlaps the window.
 */
function overlapsWindow (event, windowStart, windowEnd) {
	const start = getStartTime(event);
	const end = getEndTime(event);

	return start < windowEnd.getTime() && end > windowStart.getTime();
}

/**
 * Sort events consistently by start time and all-day flag.
 * @param {object} left first event.
 * @param {object} right second event.
 * @returns {number} sort value.
 */
function sortEvents (left, right) {
	if (getStartTime(left) !== getStartTime(right)) {
		return getStartTime(left) - getStartTime(right);
	}

	if (left.isAllDay !== right.isAllDay) {
		return left.isAllDay ? -1 : 1;
	}

	return left.title.localeCompare(right.title);
}

/**
 * Check whether an event is still in progress or upcoming.
 * @param {object} event normalized event.
 * @param {Date} now reference time.
 * @returns {boolean} true when the event has not ended.
 */
function eventEndsAfter (event, now) {
	return getEndTime(event) > now.getTime();
}

/**
 * Check whether an event is currently underway.
 * @param {object} event normalized event.
 * @param {Date} now reference time.
 * @returns {boolean} true when the event is underway.
 */
function isOngoing (event, now) {
	const nowTime = now.getTime();
	return getStartTime(event) <= nowTime && getEndTime(event) > nowTime;
}

/**
 * Get an event start time in milliseconds.
 * @param {object} event normalized event.
 * @returns {number} start time.
 */
function getStartTime (event) {
	return new Date(event.startAt).getTime();
}

/**
 * Get an event end time in milliseconds.
 * @param {object} event normalized event.
 * @returns {number} end time.
 */
function getEndTime (event) {
	return new Date(event.endAt || event.startAt).getTime();
}

/**
 * Round a duration up to the next minute.
 * @param {number} startMs start timestamp.
 * @param {number} endMs end timestamp.
 * @returns {number} rounded minutes.
 */
function diffMinutes (startMs, endMs) {
	return Math.max(0, Math.ceil((endMs - startMs) / 60000));
}

module.exports = {
	CALENDAR_STALE_MS,
	diffMinutes,
	normalizeAllDayDate,
	normalizeCalendarEvents,
	normalizeDateTime,
	normalizeGoogleEvent
};
