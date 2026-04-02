let config = {
	timeFormat: 12,

	modules: [
		{
			module: "MMM-OperatorAmbient",
			position: "fullscreen_below",
			config: {
				showSeconds: false,
				weather: {
					lat: 39.2997,
					lon: -75.6050,
					label: "Smyrna, DE"
				},
				google: {
					clientId: "test-client-id",
					clientSecret: "",
					calendarIds: ["primary"]
				}
			}
		},
		{
			module: "newsfeed",
			position: "bottom_bar",
			config: {
				feeds: [
					{
						title: "Rodrigo Ramirez Blog",
						url: "http://localhost:8080/tests/mocks/newsfeed_test.xml"
					}
				],
				showSourceTitle: true,
				showPublishDate: false
			}
		}
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {
	module.exports = config;
}
