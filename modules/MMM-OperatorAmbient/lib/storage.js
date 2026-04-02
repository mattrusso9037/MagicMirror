const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Ensure the runtime storage directory exists.
 * @param {string} dirPath directory to create.
 * @returns {Promise<string>} resolved path.
 */
async function ensureStorageDir (dirPath) {
	await fs.mkdir(dirPath, {
		recursive: true,
		mode: 0o700
	});

	try {
		await fs.chmod(dirPath, 0o700);
	} catch (error) {
		// chmod can fail on some filesystems; the directory still exists.
	}

	return dirPath;
}

/**
 * Read a JSON file, falling back on missing or malformed content.
 * @param {string} filePath path to read.
 * @param {*} fallback value to return on failure.
 * @returns {Promise<*>} parsed JSON or fallback.
 */
async function readJson (filePath, fallback = null) {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw);
	} catch (error) {
		if (error.code === "ENOENT" || error.name === "SyntaxError") {
			return fallback;
		}

		throw error;
	}
}

/**
 * Write JSON to disk atomically.
 * @param {string} filePath path to write.
 * @param {*} value data to serialize.
 * @param {number} mode desired file mode.
 * @returns {Promise<void>}
 */
async function writeJson (filePath, value, mode = 0o600) {
	await ensureStorageDir(path.dirname(filePath));

	const tempPath = `${filePath}.tmp`;
	const serialized = `${JSON.stringify(value, null, "\t")}\n`;

	await fs.writeFile(tempPath, serialized, {
		mode
	});
	await fs.rename(tempPath, filePath);

	try {
		await fs.chmod(filePath, mode);
	} catch (error) {
		// chmod can fail on some filesystems; the write already succeeded.
	}
}

module.exports = {
	ensureStorageDir,
	readJson,
	writeJson
};
