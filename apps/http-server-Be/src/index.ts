import dotenv from "dotenv";
import { httpServer } from "./app.js";
import connectDB from "./config/db.js";
import logger from "./logger/winston.logger.js";

dotenv.config({
  path: "./.env",
});

/**
 * Starting from Node.js v14 top-level await is available and it is only available in ES modules.
 * This means you can not use it with common js modules or Node version < 14.
 */
const majorNodeVersion = +(process.env.NODE_VERSION?.split(".")[0] || "0");

const startServer = () => {
  httpServer.listen(process.env.PORT || 8080, () => {
    logger.info("⚙️  Server is running on port: " + process.env.PORT + "\n 😼 Socket-Server is running on: ws://localhost:3004");
  });
};

const initializeServer = async () => {
  try {
    await connectDB();
    startServer();
  } catch (err) {
    logger.error("Mongo db connect error: ", err);
  }
};

if (majorNodeVersion >= 14) {
  // For Node.js >= 14, we can use async/await but not top-level await in CommonJS
  initializeServer();
} else {
  connectDB()
    .then(() => {
      startServer();
    })
    .catch((err) => {
      logger.error("Mongo db connect error: ", err);
    });
}
