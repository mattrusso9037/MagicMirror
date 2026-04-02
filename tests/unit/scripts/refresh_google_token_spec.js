const { DEFAULT_OUTPUT, getBooleanOption, parseArgs, parseFlags } = require("../../../scripts/refresh-google-token");

describe("refresh-google-token script", () => {
	it("parses long-form CLI flags", () => {
		expect(parseFlags(["--cid=abc", "--secret", "xyz", "--no-open"])).toEqual({
			cid: "abc",
			open: false,
			secret: "xyz"
		});
	});

	it("supports npm config env fallbacks", () => {
		const options = parseArgs([], {
			npm_config_cid: "from-npm",
			npm_config_secret: "from-secret",
			npm_config_out: "./tmp/token.json",
			npm_config_open: "false"
		});

		expect(options.clientId).toBe("from-npm");
		expect(options.clientSecret).toBe("from-secret");
		expect(options.outputPath.endsWith("tmp/token.json")).toBe(true);
		expect(options.openBrowser).toBe(false);
	});

	it("uses the default output path when none is provided", () => {
		const options = parseArgs(["--cid=test"], {});

		expect(options.outputPath).toBe(DEFAULT_OUTPUT);
	});

	it("normalizes boolean options", () => {
		expect(getBooleanOption(undefined, undefined, true)).toBe(true);
		expect(getBooleanOption(undefined, "false", true)).toBe(false);
		expect(getBooleanOption(false, "true", true)).toBe(false);
	});
});
