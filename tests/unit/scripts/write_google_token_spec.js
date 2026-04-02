const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { DEFAULT_OUTPUT, parseArgs, parseFlags, writeTokenFile } = require("../../../scripts/write-google-token");

describe("write-google-token script", () => {
	it("parses long-form CLI flags", () => {
		expect(parseFlags(["--refresh-token=abc", "--email", "user@example.com"])).toEqual({
			email: "user@example.com",
			"refresh-token": "abc"
		});
	});

	it("supports npm config env fallbacks", () => {
		const options = parseArgs([], {
			npm_config_email: "from-npm@example.com",
			npm_config_out: "./tmp/token.json",
			npm_config_refresh_token: "from-secret"
		});

		expect(options.email).toBe("from-npm@example.com");
		expect(options.outputPath.endsWith("tmp/token.json")).toBe(true);
		expect(options.refreshToken).toBe("from-secret");
	});

	it("uses the default output path when none is provided", () => {
		const options = parseArgs(["--refresh-token=test"], {});

		expect(options.outputPath).toBe(DEFAULT_OUTPUT);
	});

	it("writes the token file with the expected payload", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-token-"));
		const outputPath = path.join(tempDir, "google-token.json");

		await writeTokenFile(outputPath, {
			email: "user@example.com",
			refreshToken: "refresh-token",
			updatedAt: "2026-04-01T00:00:00.000Z"
		});

		const raw = await fs.readFile(outputPath, "utf8");
		expect(JSON.parse(raw)).toEqual({
			email: "user@example.com",
			refreshToken: "refresh-token",
			updatedAt: "2026-04-01T00:00:00.000Z"
		});
	});
});
