import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import jwt, { JwtPayload } from "jsonwebtoken";
import { User, IUser } from "../models/user/user.model";
import { Request, Response, NextFunction, RequestHandler } from "express";

dotenv.config({ path: "./.env"})
// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: User;
        }
    }
}

interface CustomJwtPayload extends JwtPayload {
    _id: string;
}
export const verifyJWT: RequestHandler = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // An `ApiError` we threw ourselves is already user-facing; re-throw as-is
    // instead of flattening it into a generic 401.
    try {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");
        if (!token) {
            throw new ApiError(401, "You're not signed in. Please log in to continue.");
        }

        let decodedToken: CustomJwtPayload;
        try {
            decodedToken = jwt.verify(
                token,
                process.env.ACCESS_TOKEN_SECRET as string,
            ) as CustomJwtPayload;
        } catch {
            // `jsonwebtoken` throws things like "jwt malformed" / "jwt expired".
            // Those are implementation details — translate them into something
            // the frontend can act on (it retries on 401 via /refresh-token).
            throw new ApiError(
                401,
                "Your session has expired. Please log in again.",
                [],
                "UNAUTHORIZED",
            );
        }

        const user = await User.findById(decodedToken?._id).select(
            "-password -refreshToken",
        );

        if (!user) {
            throw new ApiError(401, "Your session is no longer valid. Please log in again.");
        }

        req.user = user;
        /*
         * Attach the account to this request's Sentry scope, so any 500 later in
         * the handler carries the user id. This is the only place in the request
         * lifecycle that knows who the caller is — by the time `errorHandler`
         * runs, that information is only reachable through the scope.
         *
         * The id is the Mongo `_id` and nothing else — no username, no email. A
         * server-side event is far more likely to be read by someone with
         * production access than a browser event is, so this stays stricter than
         * the frontend's `id` + `username`.
         */
        Sentry.getCurrentScope().setUser({ id: user._id.toString() });
        next();
    } catch (error: unknown) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(401, "You're not authorised to do that. Please log in again.");
    }
});
