import dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import requestIp from "request-ip";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { Server } from "socket.io";
import session from "express-session";
import passport from "passport";
import { ApiError } from "./utils/ApiError.js";
import { ApiResponse } from "./utils/ApiResponse.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import morganMiddleware from "./logger/morgor.logger.js";
import { initializeSocketIO } from "./socket/socket.js";
import { setupMediasoup } from "./socket/mediasoup.js";
import swaggerUi from "swagger-ui-express";
import swaggerDocument from "../swagger-output.json";
dotenv.config({ path: "./.env" });

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  pingTimeout: 60000,
  // The whiteboard relays its FULL scene every couple of refreshes; a busy
  // board quickly exceeds socket.io's 1MB default and would otherwise force an
  // abrupt disconnect (which also kills the active WebRTC call via the
  // disconnect handler).
  maxHttpBufferSize: 5 * 1024 * 1024,
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  },
});

app.set("io", io); // using set method to mount the `io` instance on the app to avoid usage of `global`

// global middlewares
app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN === "*"
        ? "*" // This might give CORS error for some origins due to credentials set to true
        : process.env.CORS_ORIGIN?.split(","),
    credentials: true,
  }),
);

app.use(requestIp.mw());

// Rate limiter to avoid misuse of the service and avoid cost spikes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5000, // Limit each IP to 500 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req: Request, res: Response) => {
    return (req.clientIp || ipKeyGenerator(req.ip as string)) ?? "unknown"; // IP address from requestIp.mw(), as opposed to req.ip
  },
  handler: (_, __, ___, options) => {
    throw new ApiError(
      options.statusCode || 500,
      `There are too many requests. You are only allowed ${
        options.limit
      } requests per ${options.windowMs / 60000} minutes`,
    );
  },
});

// Apply the rate limiting middleware to all requests
app.use(limiter);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public")); // configure static file to save images locally
app.use(cookieParser());

app.use(morganMiddleware);

initializeSocketIO(io);
setupMediasoup(io);

// route imports
import userRouter from "./routes/user.routes.js";
import chatRouter from "./routes/chat.routes.js";
import messageRouter from "./routes/message.routes.js";
import callLogRouter from "./routes/callLog.routes.js";
import healthcheckRouter from "./routes/healthcheck.routes.js";

// route declarations
app.use("/api/v1/user", userRouter);
app.use("/api/v1/chats", chatRouter);
app.use("/api/v1/messages", messageRouter);
app.use("/api/v1/call-logs", callLogRouter);
app.use("/api/v1/healthcheck", healthcheckRouter);

// ---------------------------------------------------------------------------
// Error handling — this MUST come after every router.
//
// Until now `errorHandler` was written but never mounted, so every
// `throw new ApiError(...)` in a controller fell through to Express 5's
// built-in handler, which replies with an **HTML** body. The frontend reads
// `error.response.data.message`, which was therefore always `undefined` and
// users just saw a generic "Something went wrong".
//
// `swaggerUi.setup()` returns `(req, res) => res.send(html)` with no route
// guard and no `next()`, and it is mounted on "/", so it swallows every
// request that reaches it. That is why the JSON 404 below is scoped to
// `/api` and registered *before* the swagger mount.
// ---------------------------------------------------------------------------
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json(
    new ApiResponse(
      404,
      null,
      `${req.method} ${req.originalUrl} is not a valid endpoint. Check the URL and try again.`,
    ),
  );
});

app.use(errorHandler);

// Swagger docs are served from the root and intentionally mounted last so
// they never shadow an API route.
app.use(
  "/",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    swaggerOptions: {
      docExpansion: "none", // keep all the sections collapsed by default
    },
    customSiteTitle: "FreeAPI docs",
  }),
);

export { httpServer };
