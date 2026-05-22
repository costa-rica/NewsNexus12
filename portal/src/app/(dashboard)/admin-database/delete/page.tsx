"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import { Modal } from "@/components/ui/modal";
import { ModalInformationYesOrNo } from "@/components/ui/modal/ModalInformationYesOrNo";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import AccessRestricted from "@/components/common/AccessRestricted";

interface TableRowCount {
	tableName: string;
	rowCount: number;
}

// Tables that cannot be deleted (protected system tables)
const PROTECTED_TABLES = [
	"User",
	"State",
	"Keyword",
	"WebsiteDomain",
	"NewsArticleAggregatorSource",
	"EntityWhoFoundArticle",
	"NewsArticleAggregatorSourceStateContract",
];

export default function DatabaseDelete() {
	const { token, isAdmin } = useAppSelector((state) => state.user);
	const [arrayRowCountsByTable, setArrayRowCountsByTable] = useState<
		TableRowCount[]
	>([]);
	const [loading, setLoading] = useState(false);
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [selectedTable, setSelectedTable] = useState<string | null>(null);
	const [alertModal, setAlertModal] = useState<{
		show: boolean;
		variant: "success" | "error";
		title: string;
		message: string;
	}>({
		show: false,
		variant: "success",
		title: "",
		message: "",
	});

	const fetchRowCountsByTable = useCallback(async () => {
		if (!token) return;

		setLoading(true);
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

			if (response.status !== 200) {
				console.log(`There was a server error: ${response.status}`);
				setAlertModal({
					show: true,
					variant: "error",
					title: "Error",
					message: `Failed to fetch table counts. Server returned status ${response.status}.`,
				});
				return;
			}

			const resJson = await response.json();
			setArrayRowCountsByTable(resJson.arrayRowCountsByTable || []);
		} catch (error) {
			console.error("Error fetching row counts:", error);
			setAlertModal({
				show: true,
				variant: "error",
				title: "Error",
				message: "Error fetching table row counts. Please try again.",
			});
		} finally {
			setLoading(false);
		}
	}, [token]);

	useEffect(() => {
		fetchRowCountsByTable();
	}, [fetchRowCountsByTable]);

	// Check admin access
	if (!isAdmin) {
		return <AccessRestricted />;
	}

	const handleConfirmDelete = (tableName: string) => {
		setSelectedTable(tableName);
		setShowDeleteModal(true);
	};

	const handleDeleteTable = async () => {
		if (!selectedTable || !token) return;

		setShowDeleteModal(false);

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/table/${selectedTable}`,
				{
					method: "DELETE",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (response.status !== 200) {
				console.log(`There was a server error: ${response.status}`);
				setAlertModal({
					show: true,
					variant: "error",
					title: "Delete Failed",
					message: `Failed to delete table "${selectedTable}". Server returned status ${response.status}.`,
				});
				return;
			}

			setAlertModal({
				show: true,
				variant: "success",
				title: "Success",
				message: `Table "${selectedTable}" deleted successfully!`,
			});

			// Refresh the table list
			fetchRowCountsByTable();
		} catch (error) {
			console.error("Error deleting table:", error);
			setAlertModal({
				show: true,
				variant: "error",
				title: "Error",
				message: `Error deleting table "${selectedTable}". Please try again.`,
			});
		} finally {
			setSelectedTable(null);
		}
	};

	const isProtectedTable = (tableName: string): boolean => {
		return PROTECTED_TABLES.includes(tableName);
	};

	return (
		<div className="flex flex-col gap-4 md:gap-6">
			<h1 className="text-title-xl text-gray-700 dark:text-gray-300">
				Delete Tables
			</h1>

			{/* Warning Section */}
			<div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/10">
				<h2 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-3">
					⚠️ Warning: Database Table Deletion
				</h2>
				<p className="text-sm text-red-700 dark:text-red-300 mb-2">
					Deleting tables is a destructive operation that cannot be undone.
				</p>
				<ul className="list-disc list-inside text-sm text-red-700 dark:text-red-300 space-y-1">
					<li>
						Deleting tables with relationships defined could cause cascading
						deletes
					</li>
					<li>
						For example, deleting certain tables may cause all related records
						to be deleted
					</li>
					<li>Protected system tables cannot be deleted</li>
				</ul>
			</div>

			{/* Table Section */}
			<div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="border-b border-gray-200 dark:border-gray-800">
							<tr>
								<th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">
									Table Name
								</th>
								<th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">
									Row Count
								</th>
								<th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{loading ? (
								<tr>
									<td
										colSpan={3}
										className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
									>
										Loading table data...
									</td>
								</tr>
							) : arrayRowCountsByTable.length === 0 ? (
								<tr>
									<td
										colSpan={3}
										className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
									>
										No tables found
									</td>
								</tr>
							) : (
								arrayRowCountsByTable.map((item, index) => (
									<tr
										key={index}
										className="border-b border-gray-200 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50"
									>
										<td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
											{item.tableName}
											{isProtectedTable(item.tableName) && (
												<span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
													(Protected)
												</span>
											)}
										</td>
										<td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
											{item.rowCount.toLocaleString()}
										</td>
										<td className="px-6 py-4">
											{!isProtectedTable(item.tableName) ? (
												<button
													onClick={() => handleConfirmDelete(item.tableName)}
													className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors dark:bg-red-600 dark:hover:bg-red-700"
												>
													Delete Table
												</button>
											) : (
												<span className="text-sm text-gray-400 dark:text-gray-600">
													Cannot delete
												</span>
											)}
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>

			{/* Delete Confirmation Modal */}
			<Modal
				isOpen={showDeleteModal}
				onClose={() => setShowDeleteModal(false)}
				showCloseButton={true}
			>
				<ModalInformationYesOrNo
					title="Delete Table?"
					message={`Are you sure you want to delete the table "${selectedTable}"? This action cannot be undone and may cause cascading deletes.`}
					onYes={handleDeleteTable}
					onClose={() => setShowDeleteModal(false)}
					yesButtonText="Yes, Delete Table"
					noButtonText="Cancel"
					yesButtonStyle="danger"
				/>
			</Modal>

			{/* Alert Modal */}
			<Modal
				isOpen={alertModal.show}
				onClose={() => setAlertModal({ ...alertModal, show: false })}
				showCloseButton={true}
			>
				<ModalInformationOk
					title={alertModal.title}
					message={alertModal.message}
					variant={alertModal.variant}
					onClose={() => setAlertModal({ ...alertModal, show: false })}
				/>
			</Modal>
		</div>
	);
}
