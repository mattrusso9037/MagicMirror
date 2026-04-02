const { normalizeAllDayDate, normalizeCalendarEvents, normalizeGoogleEvent } = require("../../../../modules/MMM-OperatorAmbient/lib/calendar");

describe("MMM-OperatorAmbient calendar helpers", () => {
	it("normalizes Google timed and all-day events", () => {
		const timed = normalizeGoogleEvent({
			id: "timed",
			summary: "Standup",
			start: { dateTime: "2026-04-01T13:00:00-04:00" },
			end: { dateTime: "2026-04-01T13:30:00-04:00" }
		}, "primary");

		const allDay = normalizeGoogleEvent({
			id: "all-day",
			summary: "Travel",
			start: { date: "2026-04-01" },
			end: { date: "2026-04-02" }
		}, "primary");

		expect(timed.isAllDay).toBe(false);
		expect(allDay.isAllDay).toBe(true);
		expect(allDay.startAt).toBe(normalizeAllDayDate("2026-04-01"));
	});

	it("summarizes visible events and next meeting state", () => {
		const now = "2026-04-01T12:00:00-04:00";
		const summary = normalizeCalendarEvents([
			{
				sourceCalendar: "primary",
				item: {
					id: "one",
					summary: "Planning",
					start: { dateTime: "2026-04-01T13:30:00-04:00" },
					end: { dateTime: "2026-04-01T14:00:00-04:00" }
				}
			},
			{
				sourceCalendar: "primary",
				item: {
					id: "two",
					summary: "Offsite",
					start: { date: "2026-04-01" },
					end: { date: "2026-04-02" }
				}
			}
		], { now });

		expect(summary.events).toHaveLength(2);
		expect(summary.nextMeetingStartsAt).toBe("2026-04-01T17:30:00.000Z");
		expect(summary.nextFreeWindowMinutes).toBe(90);
		expect(summary.todayEventCount).toBe(2);
	});
});
