import express, { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
    authAccountLimiter,
    authIpLimiter,
} from "../middlewares/rateLimit.middleware.js";
import { uploadAvatar } from "../middlewares/multer.middleware.js";
import {
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
    getAnyUserFriendList,
    getMyFriendsList,
    getAllUsers,
} from "../controllers/user.controller.js";

const router: Router = express.Router();

// Public routes
router.route("/register").post(
    authIpLimiter,
    //injecting middleware!! for file handling
    uploadAvatar.fields([
        {
            name: "avatar",
            maxCount: 1,
        },
    ]),
    registerUser,
);
// Login gets both limiters: the per-account one bounds failures against a
// single identifier, the per-IP one bounds spraying many identifiers. Register,
// verification and recovery are public by necessity, so they get the per-IP
// cap only — an account cannot exist yet, and the emailed code is the real
// credential on those paths (they already have their own attempt lockout).
router.route("/login").post(authIpLimiter, authAccountLimiter, loginUser);
// Email verification — unauthenticated, because the user has no tokens yet.
// The emailed code IS the credential here.
router.route("/verify-email").post(authIpLimiter, verifyEmail);
router.route("/resend-verification").post(authIpLimiter, resendVerificationCode);
// Account recovery — also unauthenticated, for the same reason: the caller has
// no tokens, and the emailed code is the credential. Unlike /register, nothing
// on the account changes until that code comes back.
//
// `complete` takes multipart because it can carry a new picture. The picture
// is optional; the text fields alone are enough to change a password.
router.route("/recover-account").post(authIpLimiter, requestAccountRecovery);
router.route("/recover-account/complete").post(
    authIpLimiter,
    uploadAvatar.fields([
        {
            name: "avatar",
            maxCount: 1,
        },
    ]),
    completeAccountRecovery,
);
router.route("/refresh-token").post(authIpLimiter, authAccountLimiter, refreshAccessToken);
router.route("/get-any-user-friend-list/c/:username").get(getAnyUserFriendList);
router.route("/c/:username").get(getUserProfile);

// Protected routes
router.use(verifyJWT); // applied to all routes below this line COOL AF

router.route("/logout").post(logoutUser);
router.route("/current-user").get(getCurrentUser);
router.route("/change-password").put(changeCurrentPassword);
router.route("/update-account").put(updateAccountDetails);
router
    .route("/update-profile-picture")
    .put(uploadAvatar.single("profilePicture"), updateUserProfilePicture);
router.route("/update-bio").put(updateUserBio);
router.route("/get-my-friend-list").get(getMyFriendsList);
router.route("/get-all-users").get(getAllUsers);

export default router;
