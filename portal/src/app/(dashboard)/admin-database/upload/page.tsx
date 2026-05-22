"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import TableRowCounts, { RowCount } from "@/components/tables/TableRowCounts";
import AccessRestricted from "@/components/common/AccessRestricted";

export default function DatabaseUpload() {
	const { token, isAdmin } = useAppSelector((state) => state.user);
	const [arrayRowCountsByTable, setArrayRowCountsByTable] = useState<
		RowCount[]
	>([]);
	const [file, setFile] = useState<File | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);

	const fetchRowCountsByTable = useCallback(async () => {
		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/db-row-counts-by-table`,
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const resJson = await response.json();
			setArrayRowCountsByTable(resJson.arrayRowCountsByTable || []);
		} catch (error) {
			console.error("Error fetching row counts:", error);
		}
	}, [token]);

	useEffect(() => {
		fetchRowCountsByTable();
	}, [fetchRowCountsByTable]);

	// Check admin access
	if (!isAdmin) {
		return <AccessRestricted />;
	}

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFile = e.target.files?.[0];
		if (selectedFile) {
			setFile(selectedFile);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!file) {
			alert("Please select a file to upload.");
			return;
		}

		setIsUploading(true);
		setUploadProgress(0);

		const formData = new FormData();
		formData.append("backupFile", file);

		try {
			// Simulate progress (fetch API doesn't support upload progress)
			const progressInterval = setInterval(() => {
				setUploadProgress((prev) => {
					if (prev >= 90) {
						clearInterval(progressInterval);
						return 90;
					}
					return prev + 10;
				});
			}, 200);

			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/import-db-backup`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
					},
					body: formData,
				}
			);

			clearInterval(progressInterval);
			setUploadProgress(100);

			let resJson = null;
			const contentType = response.headers.get("Content-Type");
			if (contentType?.includes("application/json")) {
				resJson = await response.json();
			}

			if (!response.ok) {
				if (resJson?.failedOnTableName) {
					alert(
						`${resJson.error}, but failed on table: ${resJson.failedOnTableName}`
					);
				} else {
					const errorMessage =
						resJson?.error || `There was a server error: ${response.status}`;
					alert(errorMessage);
				}
			} else {
				alert("Upload successful!");
			}
		} catch (error) {
			console.error("Error uploading file:", error);
			alert("An error occurred while uploading the file.");
		} finally {
			setIsUploading(false);
			setUploadProgress(0);
			setFile(null);
			// Reset file input
			const fileInput = document.getElementById(
				"dbFileUpload"
			) as HTMLInputElement;
			if (fileInput) fileInput.value = "";
			fetchRowCountsByTable();
		}
	};

	return (
		<div className="flex flex-col gap-4 md:gap-6">
			<h1 className="text-title-xl text-gray-700 dark:text-gray-300">
				Upload to Database
			</h1>

			{/* Upload Instructions & Form */}
			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
					Upload a .zip file of your database. <u>Rules for uploads:</u>
				</p>
				<ul className="mb-6 ml-6 list-disc space-y-1 text-sm text-gray-600 dark:text-gray-400">
					<li>Only .zip files are accepted.</li>
					<li>Missing tables will be ignored.</li>
					<li>Empty cell values are ok (except for id column)</li>
					<li>Must have an id for each row that is not already in the table</li>
					<li>No missing columns.</li>
					<li>
						Contrary to db schema, names of columns in CSV should be in
						camelCase but that is how the Java Model properties are named.
					</li>
					<li>
						Also, names of files should follow naming conventions found in &quot;Row
						Counts by Table&quot; (yes, also contrary to db schema). They are the
						names of the JavaScript Model objects - all singular.
					</li>
					<li>
						If ANY Boolean column is modified, must have complete 0s and 1s for
						that column ( 0= false, 1=true) i.e. empty row is not false, and db
						doesn&apos;t handle it well.
					</li>
				</ul>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="flex flex-col gap-2">
						<label
							htmlFor="dbFileUpload"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							Upload DB .zip file:
						</label>
						<input
							id="dbFileUpload"
							type="file"
							accept=".zip"
							onChange={handleFileChange}
							className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-900/20 dark:file:text-brand-400 dark:hover:file:bg-brand-900/30"
						/>
					</div>

					<button
						type="submit"
						disabled={!file || isUploading}
						className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-brand-600 dark:hover:bg-brand-700"
					>
						{isUploading ? "Uploading..." : "Upload"}
					</button>
				</form>
			</div>

			{/* Row Counts Table */}
			<div className="flex flex-col gap-4">
				<h2 className="text-title-lg font-semibold text-gray-800 dark:text-white/90">
					Row Counts by Table
				</h2>
				<TableRowCounts data={arrayRowCountsByTable} />
			</div>

			{/* Upload Progress Modal */}
			{isUploading && (
				<div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/50">
					<div className="rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900 min-w-[300px]">
						<h2 className="mb-4 text-xl font-semibold text-gray-800 dark:text-white">
							Uploading...
						</h2>
						<p className="mb-4 text-2xl font-bold text-brand-500 dark:text-brand-400">
							{uploadProgress}%
						</p>
						<div className="h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700">
							<div
								className="h-3 rounded-full bg-brand-500 transition-all duration-300 dark:bg-brand-600"
								style={{ width: `${uploadProgress}%` }}
							></div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
