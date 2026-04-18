# AGENTS.md

This file provides guidance to AGENT Code (AGENT.ai/code) when working with code in this repository.

## Project Overview

NewsNexus12Portal is a Next.js 16 web application built with the App Router and Turbopack, serving as the modernized front end for the NewsNexus12Db and microservices suite. It uses Next.js conventions, TypeScript, TailwindCSS v4, and Redux Toolkit with persist for state management.

The project architecture is heavily inspired by the free-nextjs-admin-dashboard-main template, providing a structured file system, reusable components, and responsive dashboard layouts.

## Development Commands

```bash
# Start development server on port 3001
npm run dev

# Build production bundle
npm run build

# Start production server
npm start

# Run ESLint
npm run lint
```

## Architecture & Key Patterns

### Route Groups & Layouts

The app uses Next.js App Router with route groups for layout organization:

- **(dashboard)**: Routes wrapped with `AppHeader` + `AppSidebar`. Used for authenticated dashboard pages like `/articles/review`.
  - Layout: `src/app/(dashboard)/layout.tsx`
  - Provides sidebar navigation, header, and authenticated UI chrome
  - Uses `SidebarProvider` context for responsive sidebar state

- **(full-width)**: Routes without dashboard chrome, used for auth flows like `/login` and `/register`.
  - Layout: `src/app/(full-width)/(auth)/layout.tsx`
  - Provides split-screen auth layout with KM logo on right side
  - Nested `(auth)` route group for auth-specific pages

### State Management (Redux)

Redux Toolkit is configured in `src/store/index.ts` with `redux-persist` for localStorage persistence:

- **Store setup**: Uses `persistReducer` with `redux-persist/lib/storage`
- **User slice**: `src/store/features/user/userSlice.ts` manages authentication state and application preferences
  - `loginUser`: Sets token, username, email, isAdmin after successful login
  - `logoutUserFully`: Resets all user state completely
  - Article/request filtering params stored in Redux for persistence across sessions

- **Typed hooks**: Use `useAppDispatch` and `useAppSelector` from `src/store/hooks.ts` instead of raw Redux hooks

- **Provider setup**: `src/app/providers.tsx` wraps app with Redux Provider and PersistGate
  - All client components have access to Redux store
  - Persisted state rehydrates automatically on page load

### Authentication Flow

Login is handled in `src/components/auth/LoginForm.tsx`:

1. User submits email/password
2. POST to `${NEXT_PUBLIC_API_BASE_URL}/users/login`
3. On success, dispatch `loginUser(resJson)` to Redux
4. Router pushes to `/articles/review` (dashboard page)
5. Token and user data persisted via redux-persist

Logout should use `logoutUserFully` action to clear all state.

- **API integration**: All API calls go through `NEXT_PUBLIC_API_BASE_URL` environment variable

### SVG Icons

SVG icons in `src/icons/` are imported as React components using `@svgr/webpack` with Turbopack:

- Turbopack configuration in `next.config.ts` transforms `.svg` imports to React components
- Icons exported from `src/icons/index.tsx`
- Usage: `import { EyeIcon, EyeCloseIcon } from "@/icons"`
- **Turbopack is enabled by default in Next.js 16** — SVG loading is fully supported
- Webpack fallback configuration is also maintained for compatibility if `--webpack` flag is used

### Styling

- **TailwindCSS v4** via `@tailwindcss/postcss`
- Global styles in `src/app/globals.css`
- Theme context in `src/context/ThemeContext.tsx` for light/dark mode
- Sidebar responsive behavior managed by `src/context/SidebarContext.tsx`

### Component Organization

- `src/components/auth/`: Authentication forms (LoginForm, RegistrationForm)
- `src/components/form/`: Reusable form inputs, selects, switches, labels
- `src/components/ui/`: Reusable UI primitives (buttons, alerts, badges, modals, tables, dropdowns)
- `src/components/common/`: Shared components like breadcrumbs, theme toggles, chart tabs
- `src/layout/`: Top-level layout components (AppHeader, AppSidebar, Backdrop, SidebarWidget)

### Environment Variables

- `NEXT_PUBLIC_API_BASE_URL`: Base URL for NewsNexus12API backend
- `NEXT_PUBLIC_MODE`: Set to "workstation" to prefill login form for development

### TypeScript Configuration

Path alias: `@/*` → `./src/*`

Example: `import { AppHeader } from "@/layout/AppHeader"`

**IMPORTANT: Strict Typing Requirements**

This project enforces strict ESLint rules that **prohibit the use of `any` type**. All code must be properly typed:

- Use explicit types for all function parameters and return values
- Import proper types from libraries (e.g., `Row<T>` from `@tanstack/react-table`)
- Avoid `any` type — use specific types, generics, or `unknown` when appropriate
- The build will fail if ESLint detects `any` types in the code

When adding new code, always ensure proper TypeScript typing to pass `npm run build`.
