# MMM-OperatorAmbient

`MMM-OperatorAmbient` is a full-screen ambient companion for a Raspberry Pi MagicMirror setup. It renders the clock, weather, quotes, and Google Calendar as one calm composition while leaving any existing bottom-bar newsfeed alone.

## Features

- Full-screen ambient layout with a bottom safe area for an existing `newsfeed` module
- Smyrna, Delaware weather defaults via `weather.gov`
- Local disk cache for calendar and weather snapshots
- Bundled quote rotation with shuffle-bag behavior
- Pi-local Google Calendar sign-in route using a loopback OAuth callback
- Sync health, stale-state handling, dimming, and subtle burn-in drift

## Install

The module lives directly in this repo:

- `modules/MMM-OperatorAmbient/`

Add it to your `config/config.js`:

```js
{
	module: "MMM-OperatorAmbient",
	position: "fullscreen_below",
	config: {
		timeFormat: 12,
		showSeconds: false,
		quoteRotationMs: 45 * 1000,
		calendarPollMs: 15 * 60 * 1000,
		weatherPollMs: 10 * 60 * 1000,
		accentColor: "#EE6C4D",
		sleepHours: { start: 22, end: 6 },
		weather: {
			lat: 39.2997,
			lon: -75.6050,
			label: "Smyrna, DE"
		},
		google: {
			clientId: "YOUR_GOOGLE_DESKTOP_CLIENT_ID",
			clientSecret: "YOUR_GOOGLE_DESKTOP_CLIENT_SECRET",
			calendarIds: ["primary"]
		}
	}
}
```

## Runtime Files

The module stores runtime state in `config/MMM-OperatorAmbient/`:

- `google-token.json`
- `calendar-cache.json`
- `weather-cache.json`
- `state.json`

Delete `google-token.json` and revisit the local auth route if you need to reconnect Google Calendar.

## Manual Calendar Setup

1. Create or reuse a Google Cloud project.
2. Enable the Google Calendar API.
3. Create an OAuth client of type `Desktop app`.
4. If the consent screen is still in Testing, add the calendar account as a test user.
5. Copy the client ID and client secret into the module config.
6. Start MagicMirror on the Raspberry Pi with local browser access.
7. Open `http://127.0.0.1:8080/MMM-OperatorAmbient/auth/start` on the Pi itself.
8. Complete Google sign-in and grant `calendar.readonly` and `userinfo.email`.
9. Confirm that `config/MMM-OperatorAmbient/google-token.json` exists.
10. If the token is revoked or expires in a way Google cannot refresh, delete the token file and run the local auth route again.

## Notes

- The auth route is intentionally local-only. Remote devices are blocked.
- This version does not replace your existing headline module.
- Weather defaults to Smyrna, Delaware, but the coordinates remain configurable.
