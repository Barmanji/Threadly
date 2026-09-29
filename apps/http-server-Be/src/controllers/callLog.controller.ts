import { CallLog } from "../models/calls/callLogs.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose, { isValidObjectId } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Request, Response, RequestHandler } from "express";
import { IUser } from "../models/user/user.model.js";

interface AuthenticatedRequest extends Request {
    user?: IUser;
}

const createCallLog: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { receiver, callType, status } = req.body;
    const caller = (req.user as any)._id;

    if (!caller) {
        throw new ApiError(401, "User not authenticated");
    }

    if (!isValidObjectId(receiver)) {
        throw new ApiError(400, "Invalid receiver ID");
    }

    if (!["audio", "video"].includes(callType) || !["missed", "answered"].includes(status)) {
        throw new ApiError(400, "Invalid call type or status");
    }

    const log = await CallLog.create({ caller, receiver, callType, status });

    res.status(201).json(new ApiResponse(201, log, "Call log created"));
});

const getUserCallLogs: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user as any)._id;

    if (!userId) {
        throw new ApiError(401, "User not authenticated");
    }

    const logs = await CallLog.find({
        $or: [{ caller: userId }, { receiver: userId }],
    })
    .populate("caller", "username avatar")
    .populate("receiver", "username avatar")
    .sort({ timestamp: -1 });

    res.status(200).json(new ApiResponse(200, logs));
});

const getCallLogById: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { logId } = req.params;

    if (!isValidObjectId(logId)) throw new ApiError(400, "Invalid call log ID");

    const log = await CallLog.findById(logId)
        .populate("caller", "username avatar")
        .populate("receiver", "username avatar");

    if (!log) throw new ApiError(404, "Call log not found");

    res.status(200).json(new ApiResponse(200, log));
});

const deleteCallLog: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { logId } = req.params;
    const userId = (req.user as any)._id;

    if (!userId) {
        throw new ApiError(401, "User not authenticated");
    }

    if (!isValidObjectId(logId)) throw new ApiError(400, "Invalid call log ID");

    const log = await CallLog.findOne({
        _id: logId,
        $or: [{ caller: userId }, { receiver: userId }],
    });

    if (!log) throw new ApiError(404, "Call log not found or unauthorized");

    await CallLog.findByIdAndDelete(logId);

    res.status(200).json(new ApiResponse(200, null, "Call log deleted"));
});

export {
    createCallLog,
    getUserCallLogs,
    getCallLogById,
    deleteCallLog,
};
