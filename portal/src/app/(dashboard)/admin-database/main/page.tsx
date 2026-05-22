"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { Modal } from "@/components/ui/modal";
import { ModalInformationYesOrNo } from "@/components/ui/modal/ModalInformationYesOrNo";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import TableAdminDatabaseMain from "@/components/tables/TableAdminDatabaseMain";
import { createColumnHelper, ColumnDef } from "@tanstack/react-table";
import AccessRestricted from "@/components/common/AccessRestricted";

interface TableRow {
  id: number | null;
  [key: string]: unknown;
}

export default function AdminDatabaseMain() {
  const { token, isAdmin } = useAppSelector((state) => state.user);
  const [selectedTable, setSelectedTable] = useState<string>("User");
  const [tableData, setTableData] = useState<TableRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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

  const tableKeys = useMemo(
    () =>
      tableData.length === 0
        ? []
        : Object.keys(tableData[0]).filter((key) => key !== "id"),
    [tableData]
  );

  const fetchTableData = useCallback(
    async (tableName: string) => {
      if (!token) return;

      setLoading(true);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/table/${tableName}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server Error: ${errorText}`);
        }

        const result = await response.json();

        if (result.result && Array.isArray(result.data)) {
          setTableData(result.data);
        } else {
          setTableData([]);
        }
      } catch (error) {
        console.error("Error fetching table data:", error);
        setAlertModal({
          show: true,
          variant: "error",
          title: "Error",
          message: `Error fetching ${tableName} data. Please try again.`,
        });
        setTableData([]);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  // Fetch table data when selectedTable changes
  useEffect(() => {
    fetchTableData(selectedTable);
  }, [selectedTable, fetchTableData]);

  const handleAddOrUpdateRow = async () => {
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/table-row/${selectedTable}/${selectedId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(selectedRow),
        }
      );

      if (response.status !== 200) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      setAlertModal({
        show: true,
        variant: "success",
        title: "Success",
        message: selectedId
          ? "Row updated successfully!"
          : "Row added successfully!",
      });

      // Refresh data and clear form
      fetchTableData(selectedTable);
      handleClearSelectionAndForm();
    } catch (error) {
      console.error("Error adding/updating row:", error);
      setAlertModal({
        show: true,
        variant: "error",
        title: "Error",
        message: "Error saving row. Please try again.",
      });
    }
  };

  const handleDelete = async () => {
    if (!token || selectedId === null) return;

    setShowDeleteModal(false);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/admin-db/table-row/${selectedTable}/${selectedId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status !== 200) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      setAlertModal({
        show: true,
        variant: "success",
        title: "Success",
        message: "Row deleted successfully!",
      });

      // Refresh data
      fetchTableData(selectedTable);
    } catch (error) {
      console.error("Error deleting row:", error);
      setAlertModal({
        show: true,
        variant: "error",
        title: "Error",
        message: "Error deleting row. Please try again.",
      });
    } finally {
      setSelectedId(null);
    }
  };

  const handleClearSelectionAndForm = () => {
    setSelectedId(null);
    setSelectedRow({});
  };

  const handleFieldChange = (key: string, value: unknown) => {
    setSelectedRow((prev) => ({ ...prev, [key]: value }));
  };

  const handleSelectRow = useCallback(
    (id: number) => {
      setSelectedId(id);
      const row = tableData.find((r) => r.id === id);
      if (row) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { createdAt, updatedAt, ...filteredRow } = row;
        setSelectedRow(filteredRow);
      }
    },
    [tableData]
  );

  const handleConfirmDelete = (id: number) => {
    setSelectedId(id);
    setShowDeleteModal(true);
  };

  const isBooleanField = (key: string): boolean => {
    return key.startsWith("is") || key.startsWith("processing");
  };

  // Build dynamic columns based on table keys
  const columns = useMemo<ColumnDef<TableRow, unknown>[]>(() => {
    if (tableData.length === 0 || tableKeys.length === 0) return [];

    const columnHelper = createColumnHelper<TableRow>();

    // ID column with select button
    const idColumn = columnHelper.accessor("id", {
      header: "ID",
      enableSorting: true,
      cell: (info) => (
        <button
          onClick={() => {
            const id = info.getValue();
            if (id !== null) handleSelectRow(id);
          }}
          className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium"
        >
          {info.getValue()}
        </button>
      ),
    });

    // Dynamic columns based on table keys
    const dynamicCols = tableKeys.map((key) => {
      return columnHelper.accessor((row) => row[key], {
        id: key,
        header: key,
        enableSorting: true,
        cell: (info) => {
          const value = info.getValue();
          // Handle boolean display
          if (key.startsWith("is") || key.startsWith("processing")) {
            return value ? "true" : "false";
          }
          // Handle null/undefined
          if (value === null || value === undefined) {
            return "";
          }
          return String(value);
        },
      });
    });

    // Delete column
    const isDummyRow = tableData.length === 1 && tableData[0].id === null;
    const deleteColumn = columnHelper.display({
      id: "delete",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={() => {
            const id = row.original.id;
            if (id !== null) handleConfirmDelete(id);
          }}
          className="px-3 py-1 text-sm font-medium text-white bg-red-500 rounded hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
        >
          Delete
        </button>
      ),
    });

    // Only include delete column if not a dummy row
    return (
      isDummyRow
        ? [idColumn, ...dynamicCols]
        : [idColumn, ...dynamicCols, deleteColumn]
    ) as ColumnDef<TableRow, unknown>[];
  }, [tableData, tableKeys, handleSelectRow]);

  // Check admin access
  if (!isAdmin) {
    return <AccessRestricted />;
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
        Database Tables
      </h1>

      {/* Table Selection Dropdown */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Select Table:
          </label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-600"
          >
            <option value="User">User</option>
            <option value="ArtificialIntelligence">
              ArtificialIntelligence
            </option>
            <option value="EntityWhoCategorizedArticle">
              EntityWhoCategorizedArticle
            </option>
            <option value="NewsArticleAggregatorSource">
              NewsArticleAggregatorSource
            </option>
            <option value="EntityWhoFoundArticle">EntityWhoFoundArticle</option>
          </select>
        </div>
      </div>

      {/* Add/Update Form */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90 mb-4">
          {selectedId ? `Update Row (ID: ${selectedId})` : "Add New Row"}
        </h2>

        {tableKeys.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">
            {loading ? "Loading..." : "No data available"}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {tableKeys
                .filter((key) => key !== "createdAt" && key !== "updatedAt")
                .map((key) => (
                  <div key={key} className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {key}
                    </label>
                    {isBooleanField(key) ? (
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`radio-${key}`}
                            checked={selectedRow[key] === true}
                            onChange={() => handleFieldChange(key, true)}
                            className="text-brand-500 focus:ring-brand-500"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            true
                          </span>
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`radio-${key}`}
                            checked={selectedRow[key] === false}
                            onChange={() => handleFieldChange(key, false)}
                            className="text-brand-500 focus:ring-brand-500"
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            false
                          </span>
                        </label>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={
                          selectedRow[key] !== undefined &&
                          selectedRow[key] !== null
                            ? String(selectedRow[key])
                            : ""
                        }
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        disabled={key === "password"}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    )}
                  </div>
                ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClearSelectionAndForm}
                className="px-6 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Clear
              </button>
              <button
                onClick={handleAddOrUpdateRow}
                className="px-6 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
              >
                {selectedId ? "Update Row" : "Add Row"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Table */}
      <TableAdminDatabaseMain
        data={tableData}
        columns={columns}
        selectedRowId={selectedId}
        loading={loading}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        showCloseButton={true}
      >
        <ModalInformationYesOrNo
          title="Delete Row?"
          message={`You are about to delete ${selectedTable} ID: ${selectedId}. This action cannot be undone.`}
          onYes={handleDelete}
          onClose={() => setShowDeleteModal(false)}
          yesButtonText="Yes, Delete"
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
