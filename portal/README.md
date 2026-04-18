# News Nexus 10 Portal

## Overview

NewsNexus12Portal is the web interface for the NewsNexus12Db and microservices suite of applications.
NewsNexus12Portal is a updated version of NewsNexusPortal09 - and complete modernization of the previous NewsNexus08Portal web app.
While v08 was built with plain JavaScript, minimal styling, and without Next.js conventions, v09 rebuilds the Portal from the ground up using Next.js (App Router), TailwindCSS, and TypeScript, ensuring long-term scalability, maintainability, and alignment with modern React best practices.

This version starts from a clean npx create-next-app@latest base and adopts the architectural patterns and UI structure of the open-source free-nextjs-admin-dashboard-main project. That template provides a well-organized file system, reusable components, and responsive dashboard layouts — features that will serve as the foundation for implementing all existing NewsNexus08Portal content, workflows, and user interfaces in a structured, convention-driven way.

The goal of NewsNexus12Portal is to faithfully re-create and enhance the functionality of the previous Portal within a modern Next.js environment, ultimately serving as the main front end for interacting with NewsNexus12API and the broader News Nexus 09 microservice suite.

### Overview TL;DR

- started from `npx create-next-app@latest`
- Heavily lifting the architecture from [free-nextjs-admin-dashboard-main](https://tailadmin.com/download)
- Customizeing it to fit the needs of the NewsNexus Portal.
- Uses App Router
- Uses TailwindCSS
- Uses Redux for state management
- Uses TypeScript

## Project Structure

```
.
├── eslint.config.mjs
├── next-env.d.ts
├── next.config.ts
├── package-lock.json
├── package.json
├── postcss.config.mjs
├── public
│   ├── file.svg
│   ├── globe.svg
│   ├── images
│   │   ├── buttons
│   │   ├── deleteCircleX.svg
│   │   ├── kmLogo_square1500.png
│   │   ├── logoAndNameRound.png
│   │   ├── logoWhiteBackground.png
│   │   ├── menu
│   │   └── new.png
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
├── README.md
├── src
│   ├── app
│   │   ├── (dashboard)
│   │   ├── (full-width)
│   │   ├── favicon.ico
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── providers.tsx
│   ├── components
│   │   ├── auth
│   │   ├── common
│   │   ├── form
│   │   ├── header
│   │   └── ui
│   ├── context
│   │   ├── SidebarContext.tsx
│   │   └── ThemeContext.tsx
│   ├── icons
│   │   └── contains all .svg icons
│   ├── layout
│   │   ├── AppHeader.tsx
│   │   ├── AppSidebar.tsx
│   │   ├── Backdrop.tsx
│   │   └── SidebarWidget.tsx
│   ├── store
│   │   ├── features
│   │   ├── hooks.ts
│   │   └── index.ts
│   └── svg.d.ts
└── tsconfig.json
```

## .env

```
NEXT_PUBLIC_API_BASE_URL=https://api.news-nexus.kineticmetrics.com
NEXT_PUBLIC_API_BASE_URL_DEV=https://api.news-nexus-dev.kineticmetrics.com
NEXT_PUBLIC_API_BASE_URL_WORKSTATION=http://localhost:3000
NEXT_PUBLIC_NAME_APP=NewsNexus
NEXT_PUBLIC_MODE=dev
```

## Key differences from version 08

- **Layout vs `TemplateView.js`**: In v08 (Pages Router) we used a `TemplateView.js` component to render the top/side navigation across pages. In v09 (App Router), this responsibility moves to `layout.tsx`.
  - Use `src/app/(dashboard)/layout.tsx` to wrap all dashboard routes with the sidebar/header chrome (this replaces `TemplateView.js`).
  - Optionally use `src/app/(full-width)/layout.tsx` for auth and other pages that should not include the dashboard chrome.
- **Route groups don’t affect URLs**: `(dashboard)` and `(full-width)` are organizational; they scope layouts and don’t appear in the path.
- **Per‑segment routing**: Routes are defined by folders with a `page.tsx`. Shared UI (including what lived in `components/common/`) belongs under `src/components/`.
- **No `[root_navigator].js` / `[navigator].js`**: Navigation is file‑system based; those dynamic navigator files are no longer needed.

## Template Changes

This version of the News Nexus Portal will heavily leverage the [free-nextjs-admin-dashboard-main](https://tailadmin.com/download) project. The following is a list of modification we I am making from the template.

- SignUpForm.tsx changed to RegistrationForm.tsx
- SignInForm.tsx changed to LoginForm.tsx

## Imports

### Required for Template

- `npm install tailwind-merge`
- `npm i -D @svgr/webpack`

## Modals

This project uses a **Container/Content Modal Architecture** that separates infrastructure concerns from business logic. The pattern provides a reusable modal wrapper (`Modal`) combined with specialized content components (`ModalInformationOk`, `ModalInformationYesOrNo`, etc.).

### Container/Content Modal Architecture

This architecture splits modal functionality into two layers:

1. **Container Layer**: Handles backdrop rendering, positioning, keyboard events (ESC), click-outside-to-close, scroll locking, and z-index management
2. **Content Layer**: Manages business logic, form state, validation, and user interactions

This separation allows you to mix and match the same wrapper with different content components, promoting reusability and maintainability across the application.

### Modal Wrapper (`src/components/ui/modal/index.tsx`)

The `Modal` component is the foundational wrapper that provides:

- Fixed overlay with backdrop blur effect
- ESC key listener for closing
- Click-outside detection
- Body scroll locking when open
- Optional close button (X in top-right)
- Fullscreen mode support
- Controlled component pattern via `isOpen` prop

**Why we need it**: Without this wrapper, every modal would need to reimplement backdrop rendering, keyboard handling, scroll locking, and positioning logic. The wrapper centralizes these concerns, ensuring consistent behavior across all modals in the application.

### ModalInformationOk (`src/components/ui/modal/ModalInformationOk.tsx`)

A pre-built content component for alert/notification modals. Displays a title, message, and single action button.

**Features**:

- Variant-based styling: `info`, `success`, `error`, `warning`
- Customizable button text
- Colored message box matching variant
- Executes optional callback before closing

**Usage**:

```tsx
<Modal isOpen={show} onClose={handleClose}>
  <ModalInformationOk
    title="Success"
    message="Operation completed successfully"
    variant="success"
    onClose={handleClose}
  />
</Modal>
```

### ModalInformationYesOrNo (`src/components/ui/modal/ModalInformationYesOrNo.tsx`)

A confirmation dialog content component with two action buttons.

**Features**:

- Customizable Yes/No button text
- Button styling variants: `danger` (red) or `primary` (brand color)
- Separate callbacks for Yes and No actions
- Grey secondary button for cancel/no action

**Usage**:

```tsx
<Modal isOpen={show} onClose={handleClose}>
  <ModalInformationYesOrNo
    title="Delete Report?"
    message="This action cannot be undone."
    onYes={handleDelete}
    onClose={handleClose}
    yesButtonText="Yes, Delete"
    yesButtonStyle="danger"
  />
</Modal>
```

Both content components handle their own internal logic and automatically close the modal after executing their callbacks, making them self-contained and easy to use.
