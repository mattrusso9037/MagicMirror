#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_OUTPUT = path.resolve(process.cwd(), "config", "MMM-OperatorAmbient", "google-token.json");

/**
 * Entry point for the token writer helper.
 * @returns {Promise<void>}
 */
async function main () {
	const options = parseArgs(process.argv.slice(2), process.env);

	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}

	if (!options.refreshToken) {
		throw new Error("Missing Google refresh token. Pass --refresh-token=... or set GOOGLE_REFRESH_TOKEN.");
	}

	const payload = {
		email: options.email,
		refreshToken: options.refreshToken,
		updatedAt: options.updatedAt
	};

	process.stdout.write(`Writing Google token file to ${options.outputPath}\n`);
	await writeTokenFile(options.outputPath, payload);
	process.stdout.write("Token file created for MMM-OperatorAmbient.\n");
}

/**
 * Write the token payload to disk.
 * @param {string} outputPath target JSON file path.
 * @param {{email: string, refreshToken: string, updatedAt: string}} payload token payload.
 * @returns {Promise<void>}
 */
async function writeTokenFile (outputPath, payload) {
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${JSON.stringify(payload, null, "\t")}\n`, {
		mode: 0o600
	});
	await fs.chmod(outputPath, 0o600);
}

/**
 * Parse CLI flags and npm config env vars.
 * @param {string[]} argv raw CLI args.
 * @param {NodeJS.ProcessEnv} env process env.
 * @returns {{email: string, help: boolean, outputPath: string, refreshToken: string|undefined, updatedAt: string}}
 */
function parseArgs (argv, env) {
	const flags = parseFlags(argv);

	return {
		email: firstDefined(
			flags.email,
			env.GOOGLE_EMAIL,
			env.npm_config_email,
			""
		),
		help: Boolean(flags.help || flags.h),
		outputPath: path.resolve(
			firstDefined(
				flags.out,
				flags.output,
				env.GOOGLE_TOKEN_OUT,
				env.npm_config_out,
				env.npm_config_output,
				DEFAULT_OUTPUT
			)
		),
		refreshToken: firstDefined(
			flags["refresh-token"],
			flags.refreshToken,
			flags.token,
			env.GOOGLE_REFRESH_TOKEN,
			env.npm_config_refresh_token,
			env.npm_config_refreshToken,
			env.npm_config_token
		),
		updatedAt: firstDefined(
			flags["updated-at"],
			flags.updatedAt,
			env.GOOGLE_TOKEN_UPDATED_AT,
			env.npm_config_updated_at,
			env.npm_config_updatedAt,
			new Date().toISOString()
		)
	};
}

/**
 * Parse `--key=value`, `--key value`, and `--no-key` forms.
 * @param {string[]} argv raw args.
 * @returns {Record<string, string|boolean>} parsed flags.
 */
function parseFlags (argv) {
	const flags = {};

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (!current.startsWith("-")) {
			continue;
		}

		if (current.startsWith("--no-")) {
			flags[current.slice(5)] = false;
			continue;
		}

		if (current.startsWith("--")) {
			const eqIndex = current.indexOf("=");
			if (eqIndex > -1) {
				flags[current.slice(2, eqIndex)] = current.slice(eqIndex + 1);
				continue;
			}

			const next = argv[index + 1];
			if (next && !next.startsWith("-")) {
				flags[current.slice(2)] = next;
				index += 1;
				continue;
			}

			flags[current.slice(2)] = true;
			continue;
		}

		flags[current.slice(1)] = true;
	}

	return flags;
}

/**
 * Return the first non-empty string-like value.
 * @param {...*} values candidate values.
 * @returns {*} first defined candidate.
 */
function firstDefined (...values) {
	for (const value of values) {
		if (value !== undefined && value !== null && value !== "") {
			return value;
		}
	}

	return undefined;
}

/**
 * Format CLI usage text.
 * @returns {string} usage output.
 */
function usage () {
	return [
		"Usage:",
		"  npm run write-token -- --refresh-token=YOUR_REFRESH_TOKEN --email=you@example.com",
		"  npm run write-token --refresh-token=YOUR_REFRESH_TOKEN --email=you@example.com",
		"",
		"Options:",
		"  --refresh-token, --token  Google refresh token (required)",
		"  --email                   Account email metadata (optional)",
		"  --updated-at              Override ISO timestamp",
		"  --out, --output           Output path for google-token.json",
		"  --help                    Show this help",
		"",
		`Default output: ${DEFAULT_OUTPUT}`
	].join("\n");
}

if (require.main === module) {
	main().catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	});
}

module.exports = {
	DEFAULT_OUTPUT,
	parseArgs,
	parseFlags,
	writeTokenFile
};
