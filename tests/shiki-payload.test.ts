import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import { copyShikiRuntime } from "../scripts/copy-shiki-runtime.mjs";
import { createRequire } from "node:module";

it("materializes a traced directory link without copying into the installed source package", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-shiki-link-"));
	try {
		const root = path.resolve(import.meta.dirname, "..");
		const code = path.join(root, "node_modules", "@streamdown", "code", "package.json");
		const sourceFile = createRequire(code).resolve.paths("shiki")!.map((lookup) => path.join(lookup, "shiki", "package.json")).find((p) => fs.existsSync(p))!;
		const source = path.dirname(sourceFile);
		const originalNames = fs.readdirSync(source);
		const alias = path.join(dir, ".next", "node_modules", "shiki-link");
		fs.mkdirSync(path.dirname(alias), { recursive: true });
		try { fs.symlinkSync(source, alias, process.platform === "win32" ? "junction" : "dir"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Directory links are denied in this execution environment"); return; }
			throw error;
		}
		copyShikiRuntime(root, dir);
		assert.equal(fs.lstatSync(alias).isSymbolicLink(), false);
		assert.ok(fs.existsSync(path.join(alias, "node_modules", "@shikijs", "core", "package.json")));
		assert.deepEqual(fs.readdirSync(source), originalNames);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("the isolated Turbopack Shiki alias can import and highlight after payload curation", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-shiki-payload-"));
	try {
		const alias = path.join(dir, ".next", "node_modules", "shiki-fixture");
		fs.mkdirSync(alias, { recursive: true });
		fs.writeFileSync(path.join(alias, "package.json"), JSON.stringify({ name: "shiki", version: "3.23.0", type: "module" }));
		copyShikiRuntime(path.resolve(import.meta.dirname, ".."), dir);
		const { codeToHtml } = await import(pathToFileURL(path.join(alias, "dist", "bundle-full.mjs")).href);
		const html = await codeToHtml("const n = 1", { lang: "javascript", theme: "github-dark" });
		assert.match(html, /<pre/);
		assert.match(html, /const/);
		assert.match(html, /class="line"/);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("does not overwrite an external alias whose version differs from the locked source", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-shiki-version-"));
	try {
		const alias = path.join(dir, ".next", "node_modules", "shiki-future");
		fs.mkdirSync(alias, { recursive: true });
		const record = '{"name":"shiki","version":"999.0.0"}';
		fs.writeFileSync(path.join(alias, "package.json"), record);
		assert.throws(() => copyShikiRuntime(path.resolve(import.meta.dirname, ".."), dir), /version/);
		assert.equal(fs.readFileSync(path.join(alias, "package.json"), "utf8"), record);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
