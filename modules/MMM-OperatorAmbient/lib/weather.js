const DEFAULT_WEATHER = {
	lat: 39.2997,
	lon: -75.6050,
	label: "Smyrna, DE"
};

const WEATHER_STALE_MS = 15 * 60 * 1000;

/**
 * Convert a provider temperature value to Fahrenheit.
 * @param {number|null} value source temperature.
 * @param {string|null} unitCode source unit.
 * @returns {number|null} temperature in Fahrenheit.
 */
function toFahrenheit (value, unitCode = null) {
	if (value === null || value === undefined || Number.isNaN(Number(value))) {
		return null;
	}

	if ((unitCode || "").includes("degC")) {
		return Math.round((Number(value) * 9) / 5 + 32);
	}

	return Math.round(Number(value));
}

/**
 * Convert Weather.gov condition text into a weather-icons token.
 * @param {string} weatherType condition text.
 * @param {boolean} isDaytime whether the period is daytime.
 * @returns {string} weather icon token.
 */
function mapWeatherType (weatherType = "", isDaytime = true) {
	if (weatherType.includes("Cloudy") || weatherType.includes("Partly")) {
		return isDaytime ? "day-cloudy" : "night-cloudy";
	}

	if (weatherType.includes("Overcast")) {
		return isDaytime ? "cloudy" : "night-cloudy";
	}

	if (weatherType.includes("Freezing") || weatherType.includes("Ice")) {
		return "rain-mix";
	}

	if (weatherType.includes("Snow")) {
		return isDaytime ? "snow" : "night-snow";
	}

	if (weatherType.includes("Thunderstorm")) {
		return isDaytime ? "thunderstorm" : "night-thunderstorm";
	}

	if (weatherType.includes("Showers")) {
		return isDaytime ? "showers" : "night-showers";
	}

	if (weatherType.includes("Rain") || weatherType.includes("Drizzle")) {
		return isDaytime ? "rain" : "night-rain";
	}

	if (weatherType.includes("Breezy") || weatherType.includes("Windy")) {
		return isDaytime ? "cloudy-windy" : "night-alt-cloudy-windy";
	}

	if (weatherType.includes("Fair") || weatherType.includes("Clear") || weatherType.includes("Few") || weatherType.includes("Sunny")) {
		return isDaytime ? "day-sunny" : "night-clear";
	}

	if (weatherType.includes("Dust") || weatherType.includes("Sand")) {
		return "dust";
	}

	if (weatherType.includes("Fog")) {
		return "fog";
	}

	if (weatherType.includes("Smoke")) {
		return "smoke";
	}

	if (weatherType.includes("Haze")) {
		return "day-haze";
	}

	return "na";
}

/**
 * Format a future period label.
 * @param {string} startTime ISO timestamp.
 * @returns {string} label.
 */
function formatPeriodLabel (startTime) {
	if (!startTime) {
		return "Soon";
	}

	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric"
	}).format(new Date(startTime));
}

/**
 * Build the current period from observations or fallback forecast data.
 * @param {object|null} observation observation payload.
 * @param {object|null} forecastPeriod fallback forecast period.
 * @returns {object} normalized current period.
 */
function buildCurrentPeriod (observation, forecastPeriod) {
	if (observation?.properties) {
		const current = observation.properties;
		const condition = current.textDescription || forecastPeriod?.shortForecast || "Unavailable";

		return {
			label: "Now",
			condition,
			iconClass: mapWeatherType(condition, inferIsDaytime(current.timestamp)),
			temperatureF: toFahrenheit(current.temperature?.value, current.temperature?.unitCode),
			rainChance: forecastPeriod?.probabilityOfPrecipitation?.value ?? null,
			isNow: true
		};
	}

	const fallback = forecastPeriod || {};
	const condition = fallback.shortForecast || "Unavailable";

	return {
		label: "Now",
		condition,
		iconClass: mapWeatherType(condition, fallback.isDaytime !== false),
		temperatureF: toFahrenheit(fallback.temperature, fallback.temperatureUnit),
		rainChance: fallback.probabilityOfPrecipitation?.value ?? null,
		isNow: true
	};
}

/**
 * Normalize Weather.gov responses into the module snapshot shape.
 * @param {object} payload raw provider payloads.
 * @param {object} weatherConfig module weather config.
 * @returns {object|null} normalized weather card.
 */
function normalizeWeatherResponse (payload, weatherConfig = DEFAULT_WEATHER) {
	if (!payload || !payload.hourlyForecast?.properties?.periods?.length) {
		return null;
	}

	const periods = payload.hourlyForecast.properties.periods;
	const nowPeriod = buildCurrentPeriod(payload.currentObservation, periods[0]);
	const futurePeriods = periods
		.slice(payload.currentObservation?.properties ? 0 : 1, payload.currentObservation?.properties ? 2 : 3)
		.map((period) => ({
			label: formatPeriodLabel(period.startTime),
			condition: period.shortForecast || "Unavailable",
			iconClass: mapWeatherType(period.shortForecast || "", period.isDaytime !== false),
			temperatureF: toFahrenheit(period.temperature, period.temperatureUnit),
			rainChance: period.probabilityOfPrecipitation?.value ?? null,
			isNow: false
		}));

	return {
		location: weatherConfig.label || getPointLabel(payload.pointData) || DEFAULT_WEATHER.label,
		periods: [nowPeriod, ...futurePeriods].slice(0, 3)
	};
}

/**
 * Infer a display label from the points API payload.
 * @param {object|null} pointData points payload.
 * @returns {string|null} location label.
 */
function getPointLabel (pointData) {
	const relative = pointData?.properties?.relativeLocation?.properties;

	if (!relative?.city || !relative?.state) {
		return null;
	}

	return `${relative.city}, ${relative.state}`;
}

/**
 * Find the first observation endpoint from the stations collection.
 * @param {object|null} stationData observation stations payload.
 * @returns {string|null} latest observation URL.
 */
function getObservationUrl (stationData) {
	const stationId = stationData?.features?.[0]?.id;

	if (!stationId) {
		return null;
	}

	return `${stationId}/observations/latest`;
}

/**
 * Best-effort day/night inference from an observation timestamp.
 * @param {string|null} timestamp ISO timestamp.
 * @returns {boolean} true when the hour is likely daytime.
 */
function inferIsDaytime (timestamp) {
	if (!timestamp) {
		return true;
	}

	const hour = new Date(timestamp).getHours();
	return hour >= 6 && hour < 19;
}

module.exports = {
	DEFAULT_WEATHER,
	WEATHER_STALE_MS,
	getObservationUrl,
	getPointLabel,
	mapWeatherType,
	normalizeWeatherResponse,
	toFahrenheit
};
