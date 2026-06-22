#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trunkRefs = ["main", "origin/main"];

function runGit(args) {
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

function resolveTrunkRef() {
	for (const ref of trunkRefs) {
		try {
			runGit(["rev-parse", "--verify", ref]);
			return ref;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

export function getAppVersion() {
	try {
		const isShallow = runGit(["rev-parse", "--is-shallow-repository"]);
		if (isShallow === "true") return "dev";

		const trunkRef = resolveTrunkRef();
		if (!trunkRef) return "dev";

		const base = runGit(["merge-base", "HEAD", trunkRef]);
		const mainCount = runGit(["rev-list", "--count", base]);
		const branchCount = runGit(["rev-list", "--count", `${base}..HEAD`]);

		if (!/^\d+$/.test(mainCount) || !/^\d+$/.test(branchCount)) {
			return "dev";
		}

		return `${mainCount}.${branchCount}`;
	} catch {
		return "dev";
	}
}

function isDirectRun() {
	if (!process.argv[1]) return false;

	try {
		return (
			realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
		);
	} catch {
		return false;
	}
}

if (isDirectRun()) {
	console.log(getAppVersion());
}
