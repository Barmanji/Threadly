import * as Sentry from "@sentry/node";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { DB_NAME } from "../constants";
import logger from "../logger/winston.logger.js";
dotenv.config({ path: "./.env" });

/**
 * Reduce a mongodb connection string to just the parts that are useful in a log
 * line. A connection string carries the username and password in the clear
 * (`mongodb://user:pass@host/db`), so logging it verbatim puts production
 * database credentials into stdout, where they end up in whatever collects the
 * pm2 logs and in the deploy output of anyone who can read them.
 */
const redactMongoUri = (uri: string | undefined): string => {
    if (!uri) return "<not set>";
    return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
};

const connectDB = async () => {
    try {
        const uri = `${process.env.MONGODB_LOCAL_URI}/${DB_NAME}`;
        console.log(redactMongoUri(uri))
        const mongooseInstance = await mongoose.connect(
            uri,
        );
        console.log(
            `\n MONGO DB IS CONNECTED || DB HOST: ${mongooseInstance.connection.host}, PORT: ${process.env.PORT}`,
        );
    } catch (error) {
        logger.error("MongoDB connection error: ", error);
        /*
         * `index.ts` captures this too, but that handler only wraps the call to
         * `connectDB` and cannot tell a connection failure apart from any other
         * startup error. Capturing here as well means the event is tagged with
         * which dependency failed, which is the first thing worth knowing.
         */
        Sentry.captureException(error, {
            tags: { phase: "startup", dependency: "mongodb" },
        });
        process.exit(1);
    }
};

export default connectDB;
