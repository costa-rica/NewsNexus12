"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { logoutUserFully } from "../store/features/user/userSlice";
import {
  ChevronDownIcon,
  CloseIcon,
  DatabaseIcon,
  FileIcon,
  GearIcon,
  HorizontaLDots,
  LogoutIcon,
  NewspaperIcon,
  PieChartIcon,
} from "../icons/index";
import SidebarWidget from "./SidebarWidget";
import { ThemeToggleButton } from "../components/common/ThemeToggleButton";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  onClick?: () => void;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

const navItems: NavItem[] = [
  {
    icon: <NewspaperIcon />,
    name: "Articles",
    subItems: [
      { name: "Review", path: "/articles/review", pro: false },
      { name: "Add / Delete", path: "/articles/add-delete", pro: false },
      {
        name: "Automations",
        path: "/articles/automations",
        pro: false,
      },
      { name: "Get Google RSS", path: "/articles/get/google-rss", pro: false },
    ],
  },
  {
    icon: <FileIcon />,
    name: "Reports",
    subItems: [
      { name: "Weekly CPSC Report", path: "/reports/weekly-cpsc", pro: false },
    ],
  },
  {
    name: "Analysis",
    icon: <PieChartIcon />,
    subItems: [
      {
        name: "Article Request",
        path: "/analysis/article-requests",
        pro: false,
      },
      { name: "Count by State", path: "/analysis/count-by-state", pro: false },
      {
        name: "Approved Duplicate Analysis",
        path: "/analysis/approved-article-duplicate",
        pro: false,
      },
      {
        name: "Approved ChatGPT",
        path: "/analysis/approved-chatgpt",
        pro: false,
      },
      {
        name: "AI State Assigner",
        path: "/analysis/state-assigner",
        pro: false,
      },
    ],
  },
  {
    icon: <GearIcon />,
    name: "User Settings",
    path: "/user-settings",
  },
  {
    icon: <LogoutIcon />,
    name: "Logout",
    onClick: () => {}, // Placeholder - actual handler assigned in renderMenuItems
  },
];

const othersItems: NavItem[] = [
  {
    icon: <DatabaseIcon />,
    name: "Database",
    subItems: [
      { name: "Main", path: "/admin-database/main", pro: false },
      { name: "Backup", path: "/admin-database/backup", pro: false },
      { name: "Upload", path: "/admin-database/upload", pro: false },
      { name: "Delete", path: "/admin-database/delete", pro: false },
    ],
  },
];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, toggleSidebar, toggleMobileSidebar } =
    useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { isAdmin } = useAppSelector((state) => state.user);

  const handleLogout = () => {
    dispatch(logoutUserFully());
    router.push("/login");
  };

  const renderMenuItems = (
    navItems: NavItem[],
    menuType: "main" | "others"
  ) => (
    <ul className="flex flex-col gap-4">
      {navItems.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group  ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded ? "lg:justify-center" : "lg:justify-start"
              }`}
            >
              <span
                className={` ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
              )}
              {(isExpanded || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200  ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : nav.onClick ? (
            <button
              onClick={nav.name === "Logout" ? handleLogout : nav.onClick}
              className={`menu-item group menu-item-inactive cursor-pointer`}
            >
              <span className="menu-item-icon-inactive">{nav.icon}</span>
              {(isExpanded || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isMobileOpen) && (
                  <span className={`menu-item-text`}>{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            new
                          </span>
                        )}
                        {subItem.pro && (
                          <span
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge `}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // const isActive = (path: string) => path === pathname;
  const isActive = useCallback((path: string) => path === pathname, [pathname]);

  useEffect(() => {
    // Check if the current path matches any submenu item
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
	          nav.subItems.forEach((subItem) => {
	            if (isActive(subItem.path)) {
	              setOpenSubmenu({
	                type: menuType as "main" | "others",
	                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

	    // If no submenu item matches, close the open submenu
	    if (!submenuMatched) {
	      // eslint-disable-next-line react-hooks/set-state-in-effect
	      setOpenSubmenu(null);
	    }
  }, [pathname, isActive]);

  useEffect(() => {
    // Set the height of the submenu items when the submenu is opened
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  const handleCloseSidebar = () => {
    if (window.innerWidth >= 1024) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };

  const handleSidebarClick = () => {
    // Only expand on large screens when sidebar is collapsed
    if (window.innerWidth >= 1024 && !isExpanded) {
      toggleSidebar();
    }
  };

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 right-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-[100000] border-l border-gray-200
        ${isExpanded || isMobileOpen ? "w-[290px]" : "w-[90px] cursor-pointer"}
        ${isMobileOpen ? "translate-x-0" : "translate-x-full"}
        lg:translate-x-0`}
      onClick={handleSidebarClick}
    >
      <div className="absolute top-6 left-5 right-5 z-10 flex items-center justify-between">
        {(isExpanded || isMobileOpen) && (
          <button
            onClick={handleCloseSidebar}
            className="hidden lg:flex items-center justify-center text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-white"
            aria-label="Close Sidebar"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        )}
        {!isExpanded && !isMobileOpen && <div />}
        <ThemeToggleButton />
      </div>

      {/* Scrollable nav area */}
      <div className="pt-20 flex-1 overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded ? "lg:justify-center" : "justify-start"
                }`}
              >
                {isExpanded || isMobileOpen ? "Main" : <HorizontaLDots />}
              </h2>
              {renderMenuItems(navItems, "main")}
            </div>

            {isAdmin && (
              <div className="">
                <h2
                  className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                    !isExpanded ? "lg:justify-center" : "justify-start"
                  }`}
                >
                  {isExpanded || isMobileOpen ? "Admin" : <HorizontaLDots />}
                </h2>
                {renderMenuItems(othersItems, "others")}
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Widget anchored to bottom */}
      <div className="pb-6">
        {(isExpanded || isMobileOpen) && <SidebarWidget />}
        <div
          className={`mx-auto w-full text-center ${
            isExpanded || isMobileOpen ? "px-2 pt-1" : "px-0"
          }`}
        >
          {isExpanded || isMobileOpen ? (
            <p className="break-words text-sm leading-tight text-gray-400 dark:text-gray-600">
              version {appVersion}
            </p>
          ) : (
            <p className="break-words text-sm leading-tight text-gray-400 dark:text-gray-600">
              {appVersion}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
