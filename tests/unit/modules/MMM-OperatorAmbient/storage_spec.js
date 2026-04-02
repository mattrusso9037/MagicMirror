const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { ensureStorageDir, readJson, writeJson } = require("../../../../modules/MMM-OperatorAmbient/lib/storage");

describe("MMM-OperatorAmbient storage helpers", () => {
	it("creates directories and round-trips JSON payloads", async () => {
		const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "mmm-operator-ambient-"));
		const nestedDir = path.join(dirPath, "runtime");
		const filePath = path.join(nestedDir, "state.json");

		await ensureStorageDir(nestedDir);
		await writeJson(filePath, { ok: true });

		await expect(readJson(filePath, null)).resolves.toEqual({ ok: true });
		await fs.rm(dirPath, { recursive: true, force: true });
	});

	it("returns a fallback for missing JSON files", async () => {
		await expect(readJson(path.join(os.tmpdir(), "missing-ambient-state.json"), { missing: true })).resolves.toEqual({ missing: true });
	});
});
