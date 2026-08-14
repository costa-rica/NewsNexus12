#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trunkRefs = ["main", "origin/main"];
const projectFolderPattern = /^NewsNexus(\d+)$/;

export function getMajorVersion(projectFolderName = basename(repoRoot)) {
	const match = projectFolderName.match(projectFolderPattern);

	if (!match) {
		throw new Error(
			`[app-version] Invalid monorepo folder name "${projectFolderName}". ` +
				'Expected "NewsNexus##", with one or more digits after "NewsNexus". ' +
				"Portal startup and builds require this naming convention."
		);
	}

	return match[1];
}

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

function readEnvironmentCounts() {
	const mainCount = process.env.NEWSNEXUS_MAIN_COMMIT_COUNT;
	const branchCount = process.env.NEWSNEXUS_BRANCH_COMMIT_COUNT;

	if (mainCount === undefined && branchCount === undefined) return null;

	if (!/^\d+$/.test(mainCount ?? "") || !/^\d+$/.test(branchCount ?? "")) {
		throw new Error(
			"[app-version] NEWSNEXUS_MAIN_COMMIT_COUNT and " +
				"NEWSNEXUS_BRANCH_COMMIT_COUNT must both be non-negative integers."
		);
	}

	return { mainCount, branchCount };
}

export function getAppVersion() {
	const majorVersion = getMajorVersion();

	try {
		const isShallow = runGit(["rev-parse", "--is-shallow-repository"]);
		if (isShallow === "true") throw new Error("Git history is shallow.");

		const trunkRef = resolveTrunkRef();
		if (!trunkRef) throw new Error("No main branch reference is available.");

		const base = runGit(["merge-base", "HEAD", trunkRef]);
		const mainCount = runGit(["rev-list", "--count", base]);
		const branchCount = runGit(["rev-list", "--count", `${base}..HEAD`]);

		if (!/^\d+$/.test(mainCount) || !/^\d+$/.test(branchCount)) {
			return `${majorVersion}.dev`;
		}

		return `${majorVersion}.${mainCount}.${branchCount}`;
	} catch {
		const environmentCounts = readEnvironmentCounts();
		if (!environmentCounts) return `${majorVersion}.dev`;

		return `${majorVersion}.${environmentCounts.mainCount}.${environmentCounts.branchCount}`;
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
