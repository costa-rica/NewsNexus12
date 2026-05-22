"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import TableRowCounts, { RowCount } from "@/components/tables/TableRowCounts";
import { Modal } from "@/components/ui/modal";
import { LoadingDots } from "@/components/common/LoadingDots";

export default function DatabaseBackup() {
	const { token } = useAppSelector((state) => state.user);
	const [arrayBackups, setArrayBackups] = useState<string[]>([]);
	const [arrayRowCountsByTable, setArrayRowCountsByTable] = useState<
		RowCount[]
	>([]);
	const [isCreatingBackup, setIsCreatingBackup] = useState(false);
	const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);

	const fetchBackupList = useCallback(async () => {
		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/backup-database-list`,
				{
					method: "GET",
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
			setArrayBackups(resJson.backups || []);
		} catch (error) {
			console.error("Error fetching backups:", error);
		}
	}, [token]);

	const createBackup = async () => {
		setIsCreatingBackup(true);
		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/create-database-backup`,
				{
					method: "GET",
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

			alert("Backup created successfully!");
			fetchBackupList();
		} catch (error) {
			console.error("Error creating backup:", error);
			alert("Error creating backup. Please try again.");
		} finally {
			setIsCreatingBackup(false);
		}
	};

	const handleDelete = async (backup: string) => {
		if (window.confirm("Are you sure you want to delete this backup?")) {
			try {
				const response = await fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/delete-db-backup/${backup}`,
					{
						method: "DELETE",
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

				alert("Backup deleted successfully!");
				fetchBackupList();
			} catch (error) {
				console.error("Error deleting backup:", error);
				alert("Error deleting backup. Please try again.");
			}
		}
	};

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
		fetchBackupList();
		fetchRowCountsByTable();
	}, [fetchBackupList, fetchRowCountsByTable]);

	const fetchBackupZipFile = async (backup: string) => {
		setIsDownloadingBackup(true);
		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/send-db-backup/${backup}`,
				{
					method: "GET",
					headers: {
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = backup;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Error downloading backup:", error);
			alert("Error downloading backup. Please try again.");
		} finally {
			setIsDownloadingBackup(false);
		}
	};

	return (
		<div className="flex flex-col gap-4 md:gap-6">
			<h1 className="text-title-xl text-gray-700 dark:text-gray-300">
				Back up Database
			</h1>

			{/* Create Backup Section */}
			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<button
					onClick={createBackup}
					className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
				>
					Create a Backup
				</button>
			</div>

			{/* Row Counts Table */}
			<div className="flex flex-col gap-4">
				<h2 className="text-title-lg font-semibold text-gray-800 dark:text-white/90">
					Row Counts by Table
				</h2>
				<TableRowCounts data={arrayRowCountsByTable} />
			</div>

			{/* Backups List */}
			<div className="flex flex-col gap-4">
				<h2 className="text-title-lg font-semibold text-gray-800 dark:text-white/90">
					Backups
				</h2>
				<div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
					{arrayBackups.length > 0 ? (
						<ul className="divide-y divide-gray-200 dark:divide-gray-800">
							{arrayBackups.map((backup, index) => (
								<li
									key={index}
									className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
								>
									<button
										onClick={() => fetchBackupZipFile(backup)}
										className="flex-1 text-left text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
									>
										{backup}
									</button>
									<button
										onClick={() => handleDelete(backup)}
										className="ml-4 flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors"
										aria-label="Delete backup"
									>
										×
									</button>
								</li>
							))}
						</ul>
					) : (
						<div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
							No backups available
						</div>
					)}
				</div>
			</div>

			{/* Loading Modal */}
			<Modal
				isOpen={isCreatingBackup}
				onClose={() => {}}
				showCloseButton={false}
				className="flex items-center justify-center"
			>
				<div className="p-12">
					<LoadingDots size={4} />
				</div>
			</Modal>

			<Modal
				isOpen={isDownloadingBackup}
				onClose={() => {}}
				showCloseButton={false}
				className="flex items-center justify-center"
			>
				<div className="p-12 text-center">
					<LoadingDots size={4} />
					<p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
						Preparing download. Large backup files may take a minute.
					</p>
				</div>
			</Modal>
		</div>
	);
}
