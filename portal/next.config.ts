import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

type WebpackRule = {
	test?: {
		test?: (path: string) => boolean;
	};
	exclude?: RegExp;
};

const appVersionScriptPath = fileURLToPath(
	new URL("../scripts/appVersion.mjs", import.meta.url)
);

function readAppVersion(): string {
	try {
		return (
			execFileSync(process.execPath, [appVersionScriptPath], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() || "dev"
		);
	} catch {
		return "dev";
	}
}

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_APP_VERSION: readAppVersion(),
	},

	/**
	 * SECURITY HEADERS CONFIGURATION
	 *
	 * PURPOSE: Implements HTTP security headers to protect against common web attacks
	 *
	 * SECURITY CONTEXT:
	 * During the December 2025 security breach, the application lacked defense-in-depth
	 * security measures. These headers provide additional protection layers even if
	 * other vulnerabilities exist.
	 *
	 * HEADERS EXPLAINED:
	 * - X-Frame-Options: Prevents clickjacking by blocking iframe embedding
	 * - X-Content-Type-Options: Prevents MIME-type sniffing attacks
	 * - X-XSS-Protection: Enables browser's built-in XSS filter (legacy browsers)
	 * - Referrer-Policy: Controls what information is sent in Referer header
	 * - Strict-Transport-Security: Forces HTTPS connections (prevents downgrade attacks)
	 *
	 * REFERENCE: docs/security-measures20251213/Security_Measures_01_Abbreviated.md
	 *
	 * @see https://nextjs.org/docs/app/api-reference/next-config-js/headers
	 */
	async headers() {
		return [
			{
				// Apply security headers to all routes
				source: "/:path*",
				headers: [
					{
						// Prevents the site from being embedded in iframes (clickjacking protection)
						key: "X-Frame-Options",
						value: "DENY",
					},
					{
						// Prevents browsers from MIME-sniffing responses away from declared content-type
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						// Enables browser XSS filter (legacy support for older browsers)
						key: "X-XSS-Protection",
						value: "1; mode=block",
					},
					{
						// Controls how much referrer information is sent with requests
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
					{
						// Forces browsers to only connect via HTTPS for next 1 year
						// Prevents protocol downgrade attacks and cookie hijacking
						key: "Strict-Transport-Security",
						value: "max-age=31536000; includeSubDomains",
					},
				],
			},
		];
	},

	/**
	 * SECURITY: Hide "X-Powered-By: Next.js" header
	 * Reduces information leakage about technology stack (security through obscurity)
	 * Makes automated reconnaissance slightly harder for attackers
	 */
	poweredByHeader: false,

	/**
	 * DEVELOPMENT: Enable React Strict Mode
	 * Helps identify potential problems in the application during development
	 * Double-renders components to catch side effects
	 */
	reactStrictMode: true,

	/**
	 * SVG LOADER CONFIGURATION (Turbopack)
	 * Configures Turbopack to load SVG files as React components using @svgr/webpack
	 * This is the Next.js 16+ way to handle SVG imports
	 *
	 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack
	 */
	turbopack: {
		rules: {
			"*.svg": {
				loaders: ["@svgr/webpack"],
				as: "*.js",
			},
		},
	},

	/**
	 * SVG LOADER CONFIGURATION (Webpack fallback)
	 * Fallback configuration for webpack mode (if explicitly used with --webpack flag)
	 * Configures webpack to load SVG files as React components using @svgr/webpack
	 */
	webpack(config) {
		const assetRule = config.module.rules.find((r: WebpackRule) =>
			r.test?.test?.(".svg")
		);
		if (assetRule) assetRule.exclude = /\.svg$/i;

		config.module.rules.push({
			test: /\.svg$/i,
			issuer: /\.[jt]sx?$/,
			use: ["@svgr/webpack"],
		});
		return config;
	},
};

export default nextConfig;
