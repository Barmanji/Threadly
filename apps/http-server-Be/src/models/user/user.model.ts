import dotenv from "dotenv";
import mongoose, { Schema, Document, Model } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config({ path: "./.env"})
// ---------------------------
// 1. User Data Interface
// ---------------------------
export interface IUser {
    username: string;
    password: string;
    email: string;
    avatar: string;
    bio: string;
    status: "online" | "offline";
    refreshToken: string;
    friends?: mongoose.Types.ObjectId[];

    /**
     * Whether the owner has proven they can receive mail at `email`.
     *
     * NOTE: deliberately OPTIONAL with no default. Accounts that predate the
     * Resend integration have the field absent (`undefined`) and must keep
     * working, so the login guard compares strictly against `false`. Setting
     * `default: false` here would lock out every existing user.
     */
    isEmailVerified?: boolean;

    /** Present only while a verification code is outstanding. */
    emailVerification?: {
        /** bcrypt hash of the 6-digit code — the raw code is never stored. */
        codeHash: string;
        expiresAt: Date;
        attempts: number;
        lastSentAt: Date;
    } | null;

    _id?: mongoose.Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

/** How long a verification code stays valid. */
export const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** Wrong codes allowed before the code is destroyed and must be re-sent. */
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
/** Minimum gap between two sends of a verification code. */
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

// ---------------------------
// 2. User Methods Interface
// ---------------------------
export interface IUserMethods {
    save?: any;
    isPasswordCorrect(password: string): Promise<boolean>;
    generateAccessToken(): string;
    generateRefreshToken(): string;
}

// ---------------------------
// 3. User Schema Definition
// ---------------------------
const userSchema = new Schema<IUser, Model<IUser, {}, IUserMethods>, {}, IUserMethods>(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: [true, "Password is required"],
        },
        avatar: {
            type: String,
            required: true,
        },
        refreshToken: {
            type: String,
            default: "",
        },
        // No `default` — see the note on IUser.isEmailVerified. Accounts
        // created before this feature have no value for this field at all.
        isEmailVerified: {
            type: Boolean,
        },
        // A single embedded sub-document rather than separate top-level
        // fields, so clearing it after a successful verification is one unset
        // and can never leave orphaned state behind.
        emailVerification: {
            type: new Schema(
                {
                    codeHash: { type: String, required: true },
                    expiresAt: { type: Date, required: true },
                    attempts: { type: Number, default: 0 },
                    lastSentAt: { type: Date, required: true },
                },
                { _id: false },
            ),
            default: undefined,
        },
    },
    { timestamps: true }
);

// ---------------------------
// 4. Pre-save Hook for Password Hashing
// ---------------------------
userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// ---------------------------
// 5. Instance Methods
// ---------------------------
userSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {
    return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function (): string {
    return jwt.sign(
        {
            _id: this._id,
            username: this.username,
            email: this.email,
        },
        process.env.ACCESS_TOKEN_SECRET as any,
        {
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY as any,
        }
    );
};

userSchema.methods.generateRefreshToken = function (): string {
    return jwt.sign(
        { _id: this._id },
        process.env.REFRESH_TOKEN_SECRET as any,
        {
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY as any,
        }
    );
};

// ---------------------------
// 6. Export Model
// ---------------------------
export const User = mongoose.model<IUser, Model<IUser, {}, IUserMethods>>("User", userSchema);
