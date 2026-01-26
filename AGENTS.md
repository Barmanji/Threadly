# AGENTS.md

This document provides guidelines for agentic coding agents working in this repository.

## Project Overview

This is a monorepo managed with pnpm and Turborepo. It contains the following packages:

- `apps/react-Fe`: The React frontend application.
- `apps/http-server-Be`: The Express.js backend application.
- `packages/ui`: A shared React component library.
- `packages/eslint-config`: Shared ESLint configurations.
- `packages/typescript-config`: Shared TypeScript configurations.

## Commands

The following commands should be run from the root of the repository.

- **Install dependencies:**
  ```bash
  pnpm install
  ```
- **Run in development mode:**
  ```bash
  pnpm run dev
  ```
- **Build for production:**
  ```bash
  pnpm run build
  ```
- **Lint the codebase:**
  ```bash
  pnpm run lint
  ```
- **Format the codebase:**
  ```bash
  pnpm run format
  ```
- **Type-check the codebase:**
  ```bash
  pnpm run check-types
  ```

To run a command for a specific package, use the `--filter` flag with the package name:

```bash
pnpm --filter <package-name> <command>
# Example:
pnpm --filter http-server-be build
```

## Testing

This project currently has no automated tests. When adding new features, please consider adding tests.

## Code Style

### General

- Follow the existing code style.
- Write clean, readable, and maintainable code.
- Add comments to explain complex logic.

### File Structure

- **Backend (`http-server-Be`):**
  - `src/`: Source code.
  - `src/controllers/`: Request handlers.
  - `src/models/`: Mongoose models.
  - `src/routes/`: Express routes.
  - `src/utils/`: Utility functions.
  - `src/middlewares/`: Express middlewares.
  - `src/config/`: Configuration files.
- **Frontend (`react-Fe`):**
  - `src/`: Source code.
  - `src/pages/`: Page components.
  - `src/components/`: Reusable components.
  - `src/context/`: React context providers.
  - `src/api/`: API client.
  - `src/interfaces/`: TypeScript interfaces.

### Naming Conventions

- **Files:** `camelCase.ts` or `PascalCase.tsx`.
- **Variables:** `camelCase`.
- **Functions:** `camelCase`.
- **Classes:** `PascalCase`.
- **Interfaces:** `IPascalCase` (e.g., `IUser`).
- **Components:** `PascalCase`.

### Types

- Use TypeScript for all new code.
- Use explicit types for function parameters and return values.
- Define custom types and interfaces where appropriate.
- The TypeScript configuration is strict, so please adhere to it.

### Imports

- Group imports in the following order:
  1.  Built-in modules (e.g., `path`).
  2.  External modules (e.g., `express`).
  3.  Internal modules (e.g., `../utils/asyncHandler`).
- Use relative paths for internal imports.

### Error Handling (Backend)

- Use the `asyncHandler` utility to wrap async route handlers.
- Use the `ApiError` class to throw HTTP errors with a status code and message.
- Do not use `try...catch` blocks in controllers unless you need to handle a specific error. The `asyncHandler` will catch all errors and pass them to the error handling middleware.

### Frontend

- Use functional components with hooks.
- Use `PascalCase` for component names.
- Use `camelCase` for hooks, variables, and functions.
- Use JSX for rendering.
- Follow the existing code style for components and pages.
