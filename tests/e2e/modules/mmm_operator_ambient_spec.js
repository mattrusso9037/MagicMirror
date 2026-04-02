const fs = require("node:fs");
const path = require("node:path");

const helpers = require("../helpers/global-setup");

const storageDir = path.resolve(__dirname, "../../../config/MMM-OperatorAmbient");
const statePath = path.join(storageDir, "state.json");
const weatherPath = path.join(storageDir, "weather-cache.json");
const calendarPath = path.join(storageDir, "calendar-cache.json");

function writeFixtureCache () {
	const now = new Date();
	const meetingStart = new Date(now.getTime() + 90 * 60 * 1000);
	const meetingEnd = new Date(meetingStart.getTime() + 30 * 60 * 1000);

	fs.mkdirSync(storageDir, { recursive: true });
	fs.writeFileSync(statePath, `${JSON.stringify({
		offline: false,
		calendar: {
			authState: "required",
			authMessage: "Open /MMM-OperatorAmbient/auth/start on the Pi to connect Google Calendar.",
			lastSuccessAt: now.toISOString(),
			lastError: null
		},
		weather: {
			lastSuccessAt: now.toISOString(),
			lastError: null
		}
	}, null, "\t")}\n`);
	fs.writeFileSync(weatherPath, `${JSON.stringify({
		location: "Smyrna, DE",
		periods: [
			{ label: "Now", condition: "Mostly Cloudy", iconClass: "day-cloudy", temperatureF: 66, rainChance: 25, isNow: true },
			{ label: "2 PM", condition: "Chance Showers", iconClass: "day-showers", temperatureF: 69, rainChance: 38, isNow: false },
			{ label: "3 PM", condition: "Sunny", iconClass: "day-sunny", temperatureF: 71, rainChance: 5, isNow: false }
		]
	}, null, "\t")}\n`);
	fs.writeFileSync(calendarPath, `${JSON.stringify({
		events: [
			{
				id: "planning",
				title: "Architecture Review",
				startAt: meetingStart.toISOString(),
				endAt: meetingEnd.toISOString(),
				isAllDay: false,
				location: "Studio",
				sourceCalendar: "primary",
				status: "confirmed"
			}
		],
		nextMeetingStartsAt: meetingStart.toISOString(),
		nextFreeWindowMinutes: 90,
		todayEventCount: 1
	}, null, "\t")}\n`);
}

describe("MMM-OperatorAmbient module", () => {
	beforeAll(async () => {
		writeFixtureCache();
		await helpers.startApplication("tests/configs/modules/MMM-OperatorAmbient/default.js");
		await helpers.getDocument();
	});

	afterAll(async () => {
		await helpers.stopApplication();
		if (global.window?.close) {
			global.window.close();
		}
		delete global.window;
		delete global.document;
		fs.rmSync(storageDir, { recursive: true, force: true });
	});

	it("renders cached weather and calendar content while newsfeed stays visible", async () => {
		const clock = await helpers.waitForElement(".oa-clock-time");
		const weather = await helpers.waitForElement(".oa-weather-location");
		const event = await helpers.waitForElement(".oa-event-title");
		const authState = await helpers.waitForElement(".oa-calendar-state");
		const newsSource = await helpers.waitForElement(".newsfeed .newsfeed-source");

		expect(clock).not.toBeNull();
		expect(weather.textContent).toContain("Smyrna, DE");
		expect(event.textContent).toContain("Architecture Review");
		expect(authState.textContent).toContain("/MMM-OperatorAmbient/auth/start");
		expect(newsSource.textContent).toContain("Rodrigo Ramirez Blog");
	});
});
