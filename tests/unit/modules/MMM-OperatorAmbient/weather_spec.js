const { getObservationUrl, mapWeatherType, normalizeWeatherResponse, toFahrenheit } = require("../../../../modules/MMM-OperatorAmbient/lib/weather");

describe("MMM-OperatorAmbient weather helpers", () => {
	it("converts Celsius observations to Fahrenheit", () => {
		expect(toFahrenheit(20, "wmoUnit:degC")).toBe(68);
		expect(toFahrenheit(72, "wmoUnit:degF")).toBe(72);
	});

	it("extracts the first observation endpoint", () => {
		expect(getObservationUrl({
			features: [{ id: "https://api.weather.gov/stations/KDOV" }]
		})).toBe("https://api.weather.gov/stations/KDOV/observations/latest");
	});

	it("normalizes a weather.gov response into three glanceable periods", () => {
		const weather = normalizeWeatherResponse({
			pointData: {
				properties: {
					relativeLocation: {
						properties: {
							city: "Smyrna",
							state: "DE"
						}
					}
				}
			},
			currentObservation: {
				properties: {
					textDescription: "Mostly Cloudy",
					timestamp: "2026-04-01T16:00:00Z",
					temperature: {
						value: 18,
						unitCode: "wmoUnit:degC"
					}
				}
			},
			hourlyForecast: {
				properties: {
					periods: [
						{
							startTime: "2026-04-01T13:00:00-04:00",
							shortForecast: "Mostly Cloudy",
							isDaytime: true,
							temperature: 67,
							temperatureUnit: "F",
							probabilityOfPrecipitation: { value: 25 }
						},
						{
							startTime: "2026-04-01T14:00:00-04:00",
							shortForecast: "Chance Showers",
							isDaytime: true,
							temperature: 69,
							temperatureUnit: "F",
							probabilityOfPrecipitation: { value: 38 }
						},
						{
							startTime: "2026-04-01T15:00:00-04:00",
							shortForecast: "Sunny",
							isDaytime: true,
							temperature: 71,
							temperatureUnit: "F",
							probabilityOfPrecipitation: { value: 5 }
						}
					]
				}
			}
		});

		expect(weather.location).toBe("Smyrna, DE");
		expect(weather.periods).toHaveLength(3);
		expect(weather.periods[0]).toMatchObject({
			label: "Now",
			condition: "Mostly Cloudy",
			iconClass: mapWeatherType("Mostly Cloudy", true),
			temperatureF: 64
		});
	});
});
