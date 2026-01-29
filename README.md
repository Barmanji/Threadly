# Threadly -> A Better Whatsapp-Web - [Model Link](https://app.eraser.io/workspace/YtPqZ1VogxGy1jzIDkzj)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technologies Used](#technologies-used)
- [Installation](#installation)
- [Running the Project](#running-the-project)
- [API Endpoints](#api-endpoints)
- [Future Improvements](#future-improvements)

## Overview

This project is a compelete **[Turborepo](https://turborepo.dev/)-Full-Stack** system for adressing a major issue in Whatsapp-Web, which is No call + No Notes/File Sharing and No Discussion on a whiteboard as in Google-Meet. This App solves all.

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `web`: FrontEnd [React.js](https://react.dev/learn) app
- `http-server`: Backend and Sockets Hosted on expressJs and Socket.io
- `@repo/ui`: a stub React component library shared by both `web` and `docs` applications
- `@repo/eslint-config`: `eslint` configurations (includes `eslint-config-next` and `eslint-config-prettier`)
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

### Utilities

This Turborepo has some additional tools:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [ESLint](https://eslint.org/) for code linting
- [Prettier](https://prettier.io) for code formatting

## Technologies Used

- **Backend Framework:** Node.js with Express
- **Database:** MongoDB with Mongoose
- **Authentication:** JSON Web Token (JWT)
- **Socket-io** For Live Connections
- **Web-Rtc** For Video calling, file sharing and Live WhiteBoard Sharing
- **File Storage:** (e.g., cloudinary, local storage, etc.)
- **Containerization:** Docker
- Other Minor ones like: Axios, React-hook-form, tailwind, Fabric.js etc

## Features

### User Management:

- Registration, login, logout, change password.
- Profile management -> Update Account Details, Pfp, Bio etc.
- Track Friend List, Get All Friends etc

### Seeding:

- Seed Random Users with Dummy information
- Get Seeded Informaiton of the Pre-seeded users.
- Seed user with @faker-js.

### Messages & Chat Management:

- Send Message, Delete Message, Get Message. Basic CRUD for messages.
- Create One on One Chat, Group Chat, Get all Chats.
- Manipulate Group, RBAC, Add Participants, Kick Participants, Delete Group etc.
- Seach For available users in DB.

### Health Check:

- Endpoint to verify the server's health

## Installation

### Method 1: Docker-compose.yml

1. **Clone the repository** then do:
   ```bash
   docker compose up -d
   ```

### Method 2: Manual

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Barmanji/Threadly.git
   ```

2. **Install dependencies:** (I prefer Pnpm so:)

   ```bash
   cd Threadly.git
   pnpm build
   pnpm install
   ```

3. **Set up environment variables:**

   Change .env.example to .env and fill the required fields

4. **Start the server:**
   ```bash
   pnpm run dev
   ```

## Running the Project

Once you have completed the setup, you can run the project using:

```bash
pnpm dev
```

This will start the server, and the application will be available on `http://localhost:3004`.
The Client will start on default react port: `http://localhost:5173`

## [API Endpoints](https://grey-flare-636294.postman.co/workspace/My-Workspace~102b194a-b24e-4eba-8165-5e3bf3ab0433/folder/28168911-3a918dbb-b2a7-419c-a9b6-458568faa658?action=share&creator=28168911&ctx=documentation&active-environment=28168911-fbe65919-7442-4474-9df7-2533ce2ccdb1)

### User

| Method | Endpoint                                            | Description                               | Protected |
| ------ | --------------------------------------------------- | ----------------------------------------- | --------- |
| POST   | `/api/v1/user/register`                             | Register a new user                       | No        |
| POST   | `/api/v1/user/refresh-token`                        | Refresh Token                             | No        |
| POST   | `/api/v1/user/login`                                | Login a User                              | No        |
| GET    | `/api/v1/user/get-any-user-friend-list/c/:username` | Get Any User Friend List                  | No        |
| GET    | `/api/v1/user/c/:username`                          | Get User Profile                          | No        |
| POST   | `/api/v1/user/logout`                               | Logout user                               | Yes       |
| GET    | `/api/v1/user/current-user`                         | Get Current User Details                  | Yes       |
| PUT    | `/api/v1/user/change-password`                      | Change password from old to new           | Yes       |
| PUT    | `/api/v1/user/update-account`                       | Update Account Details (Username & Email) | Yes       |
| PUT    | `/api/v1/user/update-profile-picture`               | Change Pfp of the Logined user            | Yes       |
| PUT    | `/api/v1/user/update-bio`                           | Change Bio                                | Yes       |
| GET    | `/api/v1/user/get-my-friend-list`                   | Get My Friend list                        | Yes       |
| GET    | `/api/v1/user/get-all-users`                        | Get All Users                             | Yes       |

### Chat

| Method | Endpoint                                     | Description                        | Protected |
| ------ | -------------------------------------------- | ---------------------------------- | --------- |
| GET    | `/api/v1/chats`                              | Get All Chats                      | Yes       |
| GET    | `/api/v1/chats/users`                        | Search Available Users             | Yes       |
| POST   | `/api/v1/chats/c/:receiverId`                | Create or Get a One on One Chat    | Yes       |
| POST   | `/api/v1/chats/group`                        | Create a Group Chat                | Yes       |
| GET    | `/api/v1/chats/group/:chatId`                | Get Group Chat Details             | Yes       |
| PATCH  | `/api/v1/chats/group/:chatId`                | Rename Group Chat                  | Yes       |
| DELETE | `/api/v1/chats/group/:chatId`                | Delete Group Chat                  | Yes       |
| POST   | `/api/v1/chats/group/:chatId/:participantId` | Add New Participant in group chat  | Yes       |
| DELETE | `/api/v1/chats/group/:chatId/:participantId` | Remove Participant from group chat | Yes       |
| PATCH  | `/api/v1/chats/remove/:chatId`               | Delete One on One chat             | Yes       |

### Message

| Method | Endpoint                              | Description      | Protected |
| ------ | ------------------------------------- | ---------------- | --------- |
| GET    | `/api/v1/messages/:chatId`            | Get All Messages | Yes       |
| POST   | `/api/v1/messages/:chatId`            | Send message     | Yes       |
| DELETE | `/api/v1/messages/:chatId/:messageId` | Delete Message   | Yes       |

### CallLog - FUTURE**WIP**

### HealthCheck

| Method | Endpoint              | Description       | Protected |
| ------ | --------------------- | ----------------- | --------- |
| GET    | `/api/v1/healthcheck` | Get Health Status | Yes       |

## Future Improvements

- Add a pub-sub model to handle More traffic
