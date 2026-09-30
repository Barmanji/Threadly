import dotenv from "dotenv";
import logger from "../logger/winston.logger";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/ApiError";
import { IUser, IUserMethods, User } from "../models/user/user.model";
import {
  uploadResultCloudinary,
  deleteFromCloudinary,
} from "../utils/fileUploaderCloudinary";
import { ApiResponse } from "../utils/ApiResponse";
import jwt, { JwtPayload } from "jsonwebtoken";
import { Types } from "mongoose";
import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  checkRecoveryCode,
  issueVerificationCode,
  maskEmail,
  verifyEmailCode,
} from "../services/emailVerification.service";
import {
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_TTL_MS,
} from "../models/user/user.model";

// NOTE: the path was "./env" (missing the leading dot), so this call silently
// did nothing. Other modules load the real file, which masked the bug.
dotenv.config({ path: "./.env" });

type MulterRequest = Request & {
  files?: {
    [fieldname: string]: Express.Multer.File[];
  };
};

/**
 * Pragmatic email check. Deliberately permissive — the real proof of ownership
 * is the verification code, not a regex, so this only needs to catch obvious
 * typos before we spend a Cloudinary upload and a Resend send on them.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface TokenPayload extends JwtPayload {
  _id: string;
}

// Extend the IUser interface to include required _id
interface IUserWithId extends IUser {
  _id: Types.ObjectId;
}

const generateAccessAndRefreshTokens = async (userId: Types.ObjectId) => {
  try {
    const user = (await User.findById(userId)) as IUser & IUserMethods;
    const accessToken = user?.generateAccessToken();
    const refreshToken = user?.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating refresh and access token",
    );
  }
};

const registerUser: RequestHandler = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const multerReq = req as MulterRequest;
    const { username, email, password } = multerReq.body;
    if ([username, email, password].some((field) => field?.trim() === "")) {
      throw new ApiError(
        400,
        "All fields are compulsory - username, email, password",
      );
    }

    // Normalise before the uniqueness check. The schema lowercases/trims on
    // write, but the lookup used the raw input, so " Bob " and "bob" could
    // both pass the check and then collide on the unique index.
    const normalisedUsername = username.toLowerCase().trim();
    const normalisedEmail = email.toLowerCase().trim();

    // Validate the address before we spend a Cloudinary upload and a Resend
    // send on data we already know we can't use.
    if (!EMAIL_REGEX.test(normalisedEmail)) {
      throw new ApiError(
        400,
        `"${normalisedEmail}" doesn't look like a valid email address.`,
        [{ path: "email", message: "Enter a valid email address." }],
      );
    }

    const existedUser = await User.findOne({
      $or: [{ username: normalisedUsername }, { email: normalisedEmail }],
    });
    if (existedUser) {
      // Tell them WHICH field collided — "User with this email already
      // exists" is wrong and confusing when they actually reused a username.
      const isEmailTaken =
        existedUser.email?.toLowerCase() === normalisedEmail;
      const field = isEmailTaken ? "email address" : "username";
      throw new ApiError(
        409,
        isEmailTaken
          ? "An account with this email address already exists. Try logging in instead."
          : `The username "${normalisedUsername}" is already taken. Pick another one.`,
        [
          {
            path: isEmailTaken ? "email" : "username",
            message: isEmailTaken
              ? "This email address is already registered."
              : "This username is already taken.",
          },
        ],
      );
    }

    if (!multerReq.files?.avatar?.[0]?.path) {
      throw new ApiError(
        400,
        "Profile picture file is required",
        [{ path: "avatar", message: "Choose a profile picture to continue." }],
      );
    }

    const avatarLocalPath = multerReq.files.avatar[0].path;
    if (!avatarLocalPath) {
      throw new ApiError(400, "Profile image isn't uploaded properly locally");
    }

    const avatarUploadedOnClodinary =
      await uploadResultCloudinary(avatarLocalPath);
    if (!avatarUploadedOnClodinary) {
      throw new ApiError(
        400,
        "Profile image isn't uploaded properly on cloudinary",
      );
    }

    // `isEmailVerified: false` is set EXPLICITLY for new accounts. The schema
    // field intentionally has no default, so accounts created before this
    // feature have it absent and are grandfathered in by the login guard.
    const user = await User.create({
      avatar: avatarUploadedOnClodinary.url,
      email: normalisedEmail,
      password,
      username: normalisedUsername,
      isEmailVerified: false,
    });

    // Issue and email the verification code. The account already exists at
    // this point, so a send failure must not roll registration back — we
    // report `emailSent: false` and the client offers a resend instead.
    const issued = await issueVerificationCode(
      user._id.toString(),
      normalisedEmail,
      normalisedUsername,
    );

    return res.status(201).json(
      new ApiResponse(
        201,
        {
          requiresEmailVerification: true,
          // Masked: the client only ever displays this, and a full address in
          // an API response is one more place an address can leak.
          email: maskEmail(normalisedEmail),
          expiresInSeconds: Math.round(EMAIL_VERIFICATION_TTL_MS / 1000),
          maxAttempts: EMAIL_VERIFICATION_MAX_ATTEMPTS,
          emailSent: issued.ok,
        },
        issued.ok
          ? "Account created. We've sent a verification code to your email."
          : "Account created, but we couldn't send the verification email. Request a code to continue.",
      ),
    );
  },
);

/**
 * Confirm an emailed code and flip the account to verified.
 *
 * Unauthenticated on purpose: the user has no tokens yet at this point. The
 * email address plus the code are the credential.
 */
const verifyEmail: RequestHandler = asyncHandler(async (req, res) => {
  const email = (req.body?.email || "").toString().trim();
  const code = (req.body?.code || "").toString().trim();

  if (!email || !code) {
    throw new ApiError(
      400,
      "Enter both your email address and the verification code.",
      [{ path: "code", message: "Enter the 6-digit code." }],
    );
  }

  if (!/^\d{6}$/.test(code)) {
    // Rejecting on shape (rather than bcrypt) keeps typos fast and avoids
    // burning one of the user's five attempts on a 4-digit paste.
    throw new ApiError(
      400,
      "The code is 6 digits. Please check and try again.",
      [
        {
          path: "code",
          message: "The code is 6 digits. Please check and try again.",
        },
      ],
      "VERIFICATION_CODE_INVALID",
    );
  }

  const result = await verifyEmailCode(email, code);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        verified: true,
        attemptsRemaining: result.attemptsRemaining,
        attemptsUsed: result.attemptsUsed,
      },
      "Email verified. You can log in now.",
    ),
  );
});

/** Re-send (and re-key) the verification code. */
const resendVerificationCode: RequestHandler = asyncHandler(async (req, res) => {
  const email = (req.body?.email || "").toString().trim();
  if (!email) {
    throw new ApiError(400, "An email address is required to resend a code.");
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    throw new ApiError(
      404,
      "We couldn't find an account with that email address.",
    );
  }
  if (user.isEmailVerified) {
    throw new ApiError(409, "This email address is already verified.");
  }

  const result = await issueVerificationCode(
    user._id.toString(),
    user.email,
    user.username,
  );

  if (result.rateLimited) {
    throw new ApiError(
      429,
      `Please wait ${result.secondsUntilRetry} second${
        result.secondsUntilRetry === 1 ? "" : "s"
      } before requesting another code.`,
      [],
      "RATE_LIMITED",
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        emailSent: result.ok,
        expiresInSeconds: Math.round(EMAIL_VERIFICATION_TTL_MS / 1000),
        maxAttempts: EMAIL_VERIFICATION_MAX_ATTEMPTS,
        cooldownSeconds: Math.round(
          EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 1000,
        ),
      },
      result.ok
        ? "A new code is on its way. It expires in 10 minutes."
        : "We couldn't send the email. Please try again in a moment.",
    ),
  );
});

// ---------------------------------------------------------------------------
// Account recovery / credential change
// ---------------------------------------------------------------------------

/**
 * The password rules the client enforces, repeated here.
 *
 * Register never validated strength server-side — the form does it, and the
 * schema only checks that a password exists. That is tolerable while the only
 * way to set a password is the register form, which cannot be bypassed by a
 * caller who already knows the password. This endpoint is different: it sets a
 * password on an account someone else created, so the rules are enforced here
 * too. Kept in step with `PASSWORD_RULES` in the frontend's
 * `utils/validation.ts`.
 */
const PASSWORD_RULES = {
  minLength: 8,
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  digit: /\d/,
  special: /[^A-Za-z0-9]/,
};

const PASSWORD_RULES_SUMMARY =
  "Use at least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.";

/** Throw a field-scoped 400 unless the password clears every rule. */
const assertPasswordAcceptable = (password: string) => {
  const problems: string[] = [];

  if (password.length < PASSWORD_RULES.minLength) {
    problems.push(`at least ${PASSWORD_RULES.minLength} characters`);
  }
  if (!PASSWORD_RULES.uppercase.test(password)) problems.push("an uppercase letter");
  if (!PASSWORD_RULES.lowercase.test(password)) problems.push("a lowercase letter");
  if (!PASSWORD_RULES.digit.test(password)) problems.push("a number");
  if (!PASSWORD_RULES.special.test(password)) problems.push("a symbol");

  if (problems.length) {
    throw new ApiError(400, `That password needs ${problems.join(", ")}.`, [
      { path: "password", message: PASSWORD_RULES_SUMMARY },
    ]);
  }
};

/**
 * Ask for a code that will authorise changing an existing account's details.
 *
 * The user reaches this by registering again with an address that already has
 * an account, which `registerUser` refuses with a 409. Without it that is a
 * dead end: the account may belong to someone who cannot remember the
 * password, and the ordinary resend endpoint refuses to send a code to a
 * verified address.
 *
 * The emailed code is the credential here, exactly as it is for ordinary
 * verification — nothing is changed by this call, and no token is issued. It
 * only proves the caller can read the inbox before `completeAccountRecovery`
 * will touch the account.
 */
const requestAccountRecovery: RequestHandler = asyncHandler(async (req, res) => {
  const email = (req.body?.email || "").toString().trim();
  if (!email) {
    throw new ApiError(400, "An email address is required to request a code.");
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    throw new ApiError(
      404,
      "We couldn't find an account with that email address.",
    );
  }

  const result = await issueVerificationCode(
    user._id.toString(),
    user.email,
    user.username,
    // The difference from /resend-verification, and the reason this endpoint
    // exists: a confirmed address needs a code too, because that is the
    // forgot-password case.
    { allowVerified: true },
  );

  if (result.rateLimited) {
    throw new ApiError(
      429,
      `Please wait ${result.secondsUntilRetry} second${
        result.secondsUntilRetry === 1 ? "" : "s"
      } before requesting another code.`,
      [],
      "RATE_LIMITED",
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        emailSent: result.ok,
        // Telling the client which case it is lets the form explain itself
        // ("you're changing the details on an account that already works")
        // instead of showing the same dead-end copy either way.
        accountVerified: Boolean(user.isEmailVerified),
        expiresInSeconds: Math.round(EMAIL_VERIFICATION_TTL_MS / 1000),
        maxAttempts: EMAIL_VERIFICATION_MAX_ATTEMPTS,
        cooldownSeconds: Math.round(
          EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 1000,
        ),
      },
      result.ok
        ? "A new code is on its way. It expires in 10 minutes."
        : "We couldn't send the email. Please try again in a moment.",
    ),
  );
});

/**
 * Check the emailed code, then apply whichever details the user changed.
 *
 * Every one of password / username / avatar is optional; whatever is left out
 * is untouched. The email address is not among them — it is the identity this
 * code was sent to, and letting it change would move the account to an
 * unverified address.
 *
 * The code is checked first and, crucially, not consumed: `checkRecoveryCode`
 * validates it without clearing it, so a taken username or a failed upload
 * below leaves the user able to fix that one field and resubmit the same code
 * instead of being told to go and fetch another email.
 */
const completeAccountRecovery: RequestHandler = asyncHandler(async (req, res) => {
  const multerReq = req as MulterRequest;
  const email = (multerReq.body?.email || "").toString().trim();
  const code = (multerReq.body?.code || "").toString().trim();
  const newPassword = (multerReq.body?.newPassword || "").toString();
  const newUsername = (multerReq.body?.newUsername || "").toString().trim();

  if (!email || !code) {
    // Pointed at whichever one is actually missing. Blaming the code for an
    // empty address puts the message under the wrong input, and on the register
    // page the address is the field a user can most plausibly have cleared.
    const missing = !email
      ? [{ path: "email", message: "Enter the email address you used." }]
      : [{ path: "code", message: "Enter the 6-digit code." }];

    throw new ApiError(
      400,
      "Enter both your email address and the code we sent you.",
      missing,
    );
  }

  if (!/^\d{6}$/.test(code)) {
    // Rejecting on shape rather than bcrypt keeps a typo fast, and does not
    // spend one of the user's five attempts on a 4-digit paste.
    throw new ApiError(
      400,
      "The code is 6 digits. Please check and try again.",
      [{ path: "code", message: "The code is 6 digits. Please check and try again." }],
      "VERIFICATION_CODE_INVALID",
    );
  }

  const avatarLocalPath = multerReq.files?.avatar?.[0]?.path;

  // No `newPassword`/`newUsername`/avatar is a legitimate request, not a
  // mistake: it is how an abandoned registration is finished. The user is on
  // this path because a duplicate address was refused, and if the account was
  // never verified then confirming the code is all they ever needed. So
  // "change nothing" is allowed through and simply marks the address
  // confirmed — see the `changed.length` message below.
  const wantsChange = Boolean(newPassword || newUsername || avatarLocalPath);

  // The security gate. Nothing below runs — and nothing on the account is
  // touched — unless the caller can read this inbox.
  const { user, attemptsRemaining, attemptsUsed } = await checkRecoveryCode(
    email,
    code,
  );

  // Read before it is overwritten below: an account that was already verified
  // is the forgot-password case, one that wasn't is an abandoned signup being
  // finished. Same code, same gate, very different situation.
  const wasAlreadyVerified = Boolean(user.isEmailVerified);

  const changed: string[] = [];

  // --- password ---
  if (newPassword) {
    assertPasswordAcceptable(newPassword);
    // The pre-save hook hashes it, since the field counts as modified.
    user.password = newPassword;
    // Every existing session was minted from the old password, so they are
    // dropped. Without this, whoever prompted the reset keeps working on the
    // victim's phone until that token expires on its own.
    user.refreshToken = "";
    changed.push("password");
  }

  // --- username ---
  if (newUsername) {
    const normalisedUsername = newUsername.toLowerCase().trim();

    if (!/^[a-zA-Z0-9._]{3,24}$/.test(normalisedUsername)) {
      throw new ApiError(
        400,
        "A username can only use letters, numbers, dots and underscores, and must be 3 to 24 characters long.",
        [{ path: "username", message: "Pick a username of 3–24 letters, numbers, dots or underscores." }],
      );
    }

    // Only a genuine change is worth a uniqueness check — resubmitting the
    // account's current username would otherwise collide with itself.
    if (normalisedUsername !== user.username) {
      const taken = await User.findOne({ username: normalisedUsername });
      if (taken) {
        throw new ApiError(
          409,
          `The username "${normalisedUsername}" is already taken. Pick another one.`,
          [{ path: "username", message: "That username is already taken." }],
        );
      }
      user.username = normalisedUsername;
      changed.push("username");
    }
  }

  // --- avatar ---
  if (avatarLocalPath) {
    const uploaded = await uploadResultCloudinary(avatarLocalPath);
    if (!uploaded) {
      throw new ApiError(
        400,
        "We couldn't upload that picture. Please try again in a moment.",
        [{ path: "avatar", message: "That picture didn't upload. Try another." }],
      );
    }
    // The old picture goes only once the new one is safely in place, so a
    // failed upload never leaves the account with a broken avatar.
    const previous = user.avatar;
    user.avatar = uploaded.url;
    changed.push("avatar");
    if (previous) {
      void deleteFromCloudinary(previous);
    }
  }

  // The code has done its job.
  user.emailVerification = undefined;
  // Proving control of the inbox is also what completes a registration that
  // was abandoned before verification, so this doubles as "finish signing up".
  user.isEmailVerified = true;

  await user.save({ validateBeforeSave: false });

  logger.info(
    `[account-recovery] ${maskEmail(user.email)}` +
      (wasAlreadyVerified ? " (already verified) " : " (unverified) ") +
      "confirmed; " +
      (wantsChange
        ? `changed ${changed.join(", ")}`
        : "no details supplied"),
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        // No tokens here. This endpoint is reached without a session, so
        // handing out one would be a second, quieter way to take the account.
        changed,
        // Masked for the same reason as everywhere else.
        email: maskEmail(user.email),
        username: user.username,
        // Same shape as /verify-email, so the client can run one code path.
        attemptsRemaining,
        attemptsUsed,
      },
      changed.length
        ? "Account updated. Log in with your new details."
        : "Code confirmed. Log in to continue.",
    ),
  );
});

const loginUser: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { username, email, password } = req.body;
    // The web UI sends the identifier (a username OR an email) in the `username`
    // field, so treat whichever is present as the identifier and match it
    // against both the username and the email of stored users.
    const identifier = (username || email || "").toString().trim();
    if (!identifier || !password) {
      throw new ApiError(
        400,
        "Username/email and password are required",
      );
    }
    const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const findUser: any = await User.findOne({
      $or: [
        { username: identifier.toLowerCase() },
        {
          email: { $regex: new RegExp(`^${escapedIdentifier}$`, "i") },
        },
      ],
    });
    if (!findUser) {
      throw new ApiError(
        404,
        "No account exists with that email or username. Check for typos, or create an account if you don't have one yet.",
      );
    }
    const passwordValidity = await findUser.isPasswordCorrect(password);
    if (!passwordValidity) {
      throw new ApiError(401, "Invalid user credentials");
    }

    // Guard rail: an account created since the Resend rollout must have
    // confirmed it can receive mail before it can be used. Comparing strictly
    // against `false` is deliberate — accounts created before this feature
    // have `isEmailVerified === undefined` and must keep working untouched.
    if (findUser.isEmailVerified === false) {
      throw new ApiError(
        403,
        "Your email address isn't verified yet. Enter the code we emailed you to finish setting up your account.",
        [{ path: "email", message: "Email address not verified yet." }],
        "EMAIL_NOT_VERIFIED",
      );
    }

    const { refreshToken, accessToken } = await generateAccessAndRefreshTokens(
      findUser._id,
    );
    const loggedInUser = await User.findById(findUser._id).select(
      "-password -refreshToken",
    ); //little optional
    const option = {
      httpOnly: true,
      secure: true,
    };

    return res
      .status(200)
      .cookie("accessToken", accessToken, option)
      .cookie("refreshToken", refreshToken, option)
      .json(
        new ApiResponse(
          200,
          {
            findUser: loggedInUser,
            accessToken,
            refreshToken,
          },
          "User logged in succesfully",
        ),
      );
  },
);

const logoutUser: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user as IUserWithId;
    await User.findByIdAndUpdate(
      user._id,
      {
        $unset: { refreshToken: 1 }, //this removes the field of the doc
      },
      {
        new: true,
      },
    );

    const option = {
      httpOnly: true,
      secure: true, // to use only in HTTPS addresses
    };

    return res
      .status(200)
      .clearCookie("accessToken", option) //method by cookieparser to clear
      .clearCookie("refreshToken", option)
      .json(new ApiResponse(200, {}, "User Logged Out"));
  },
);

const refreshAccessToken: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const incomingRefreshToken =
      req.cookies.refreshToken || req.body.refreshToken; //.cookies for pc, .body for mobiles

    if (!incomingRefreshToken) {
      throw new ApiError(404, "Unauthorized request");
    }
    //now refresh the incoming ref.
    try {
      const decodedToken = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET as string,
      ) as TokenPayload;
      const user = await User.findById(decodedToken._id);

      if (!user) {
        throw new ApiError(400, "Fictitious Token");
      }

      if (incomingRefreshToken !== user?.refreshToken) {
        throw new ApiError(401, "Refresh token is expired or used");
      }
      const options = {
        httpOnly: true,
        secure: true,
      };
      const { accessToken: accessToken, refreshToken: refreshToken } =
        await generateAccessAndRefreshTokens(user._id);

      return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
          new ApiResponse(
            200,
            {
              accessToken,
              refreshToken: refreshToken,
            },
            "access token refreshed",
          ),
        );
    } catch (error: any) {
      throw new ApiError(401, error?.message || "invalid refresh token");
    }
  },
);

//-------------- CHANGE PASS --------------------/
const changeCurrentPassword: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById((req.user as IUserWithId)._id);
    const isPasswordCorrect = await user!.isPasswordCorrect(oldPassword);
    if (!isPasswordCorrect) {
      throw new ApiError(400, "Old password is incorrect");
    }

    user!.password = newPassword;
    await user!.save({ validateBeforeSave: false });

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Password changed successfully"));
  },
);

const getCurrentUser: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    return res
      .status(200)
      .json(
        new ApiResponse(200, req.user, "Current user fetched successfully"),
      );
  },
);

const updateAccountDetails: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { username, email } = req.body;
    if (!username || !email) {
      throw new ApiError(400, "All fields are necessary");
    }
    const user = await User.findByIdAndUpdate(
      (req.user as IUserWithId)._id,
      {
        $set: {
          username: username,
          email: email,
        },
      },
      { new: true },
    ).select("-password");

    return res
      .status(200)
      .json(new ApiResponse(200, user, "Account details added succesfully"));
  },
);

const updateUserProfilePicture: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const multerReq = req as MulterRequest;
    const profilePictureLocalPath = multerReq.file?.path;

    if (!profilePictureLocalPath) {
      throw new ApiError(400, "Avatar file is missing");
    }

    const user = req.user as IUserWithId;
    const oldProfilePicture = user.avatar;
    oldProfilePicture && (await deleteFromCloudinary(oldProfilePicture)); //not understood
    const newProfilePictureUploadedOnClodinary = await uploadResultCloudinary(
      profilePictureLocalPath,
    );

    if (!newProfilePictureUploadedOnClodinary!.url) {
      throw new ApiError(400, "Error while uploading profile picture");
    }
    const profilePicuteUpdationOnMongoDB = await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          avatar: newProfilePictureUploadedOnClodinary!.url,
        },
      },
      { new: true },
    ).select("-password");

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          profilePicuteUpdationOnMongoDB,
          "Profile updated successfully",
        ),
      ); //avatar.url is unnecrary and has been put by none other than BARMANJI
  },
);

const updateUserBio: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { bio } = req.body;

    if (typeof bio !== "string" || !bio.trim()) {
      throw new ApiError(400, "Invalid bio");
    }

    const user = req.user as IUserWithId;
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $set: { bio: bio.trim() } },
      { new: true }, // returns the updated document rather than the original
    ).select("-password"); // returns the user without the password field

    return res
      .status(200)
      .json(new ApiResponse(200, updatedUser, "Bio updated successfully"));
  },
);

const getMyFriendsList: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user as IUserWithId & { friends: Types.ObjectId[] };
    return res
      .status(200)
      .json(new ApiResponse(200, user.friends, "Friend list fetched"));
  },
);

const getAnyUserFriendList: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { username } = req.params;
    if (!username) {
      throw new ApiError(400, "Username is required");
    }
    if (typeof username === "string") {
      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) {
        throw new ApiError(404, "User not found");
      }
      const userFriend = user.friends;
      return res
        .status(200)
        .json(new ApiResponse(200, userFriend, "Friend list fetched"));
    }
  },
);

const getUserProfile: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { username } = req.params;

        // NOTE: Better checking then previous .ToLowerCase()
    if (!username || typeof username !== "string") {
      throw new ApiError(400, "A valid string username is required");
    }
    const user = await User.findOne({
      username: username.toLowerCase(),
    }).select("-__v -password -refreshToken");

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, user, "user fetched"));
  }
);const getAllUsers: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const users = await User.find().select("-__v -password -refreshToken");
    if (!users || users.length === 0) {
      throw new ApiError(404, "No users found");
    }
    return res.status(200).json(new ApiResponse(200, users, "Users fetched"));
  },
);

export {
  generateAccessAndRefreshTokens,
  registerUser,
  verifyEmail,
  resendVerificationCode,
  requestAccountRecovery,
  completeAccountRecovery,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserProfilePicture,
  updateUserBio,
  getUserProfile,
  getMyFriendsList,
  getAnyUserFriendList,
  getAllUsers,
};
