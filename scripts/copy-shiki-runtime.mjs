import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Locate the installed package without executing it or assuming it exports
// package.json/a CommonJS entry. Shiki and Streamdown have import-only exports.
function packageFile(name, anchor) {
	for (const lookup of createRequire(anchor).resolve.paths(name) ?? []) {
		const file = path.join(lookup, name, "package.json");
		if (fs.existsSync(file)) return file;
	}
	throw new Error(`Missing installed runtime dependency: ${name}`);
}

/** Turbopack materializes Shiki under .next/node_modules/<alias>, away from
 * its original nested dependency scope. Include the locked runtime closure
 * beside that alias so both SSR imports and dynamic grammars/themes resolve. */
export function copyShikiRuntime(root, standalone) {
	const modules = path.join(standalone, ".next", "node_modules");
	if (!fs.existsSync(modules)) return;
	const aliases = fs.readdirSync(modules).filter((name) => name.startsWith("shiki-"));
	if (!aliases.length) return;
	const code = packageFile("@streamdown/code", path.join(root, "package.json"));
	const source = packageFile("shiki", code);
	const version = JSON.parse(fs.readFileSync(source, "utf8")).version;
	for (const name of aliases) {
		const target = path.join(modules, name);
		const record = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
		if (record.name !== "shiki" || record.version !== version) throw new Error("Shiki alias version differs from locked source");
		// The fresh Windows trace is a junction; archives materialize it as
		// a directory. Detach only the link so copying cannot write through
		// into the source dependency or fail Node's directory/link guard.
		if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
		const seen = new Map();
		const dependencyRoot = path.join(target, "node_modules");
		function copy(file, destination) {
			const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
			const previous = seen.get(pkg.name);
			if (previous) {
				if (previous !== pkg.version) throw new Error(`Conflicting Shiki dependency version: ${pkg.name}`);
				return;
			}
			seen.set(pkg.name, pkg.version);
			const directory = path.dirname(file);
			fs.cpSync(directory, destination, { recursive: true,
				filter: (candidate) => path.relative(directory, candidate).split(path.sep)[0] !== "node_modules" });
			for (const dependency of Object.keys(pkg.dependencies ?? {})) {
				copy(packageFile(dependency, file), path.join(dependencyRoot, dependency));
			}
		}
		copy(source, target);
	}
}
