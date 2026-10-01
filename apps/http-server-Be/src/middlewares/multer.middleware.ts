//can be used memory storage rather than diskstorage ~~~ READ ABOUT IT ~~~ FUTURE BJJr.
import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, "./public/temp")
    },
    filename: function(req, file, cb) {
        // Keep the original extension so Cloudinary can store raw files
        // (docx/pptx/pdf/...) with the correct extension and content-type —
        // extension-less raw assets come back with a broken content-type and
        // can't be downloaded/viewed properly.
        const ext = path.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
})

/**
 * Avatars: images only, and small.
 *
 * The size and type caps here mirror what the frontend's avatar inputs already
 * declare (`accept="image/*"` in register.tsx and the recovery form), so this
 * rejects nothing the UI offers to send. It exists because the upload path
 * previously had no bounds at all: any authenticated user could push an
 * arbitrarily large file of any type at any upload route.
 */
const uploadAvatar = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB is generous for a profile picture
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype?.startsWith("image/")) {
            cb(null, true);
            return;
        }
        cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
    },
});

/**
 * Attachments: bounded in size and count, but deliberately NOT restricted by
 * MIME type.
 *
 * The attachment picker in chat.tsx has no `accept` attribute, so the app
 * genuinely lets users send any file type today. Adding an allowlist here would
 * reject files the product currently accepts, and the "right" list is a product
 * decision rather than a security one — it belongs on the file input first, and
 * can be mirrored here afterwards. Until that happens the honest bound is size
 * and count.
 *
 * The counts match the UI: chat.tsx caps a message at 5 attachments, and
 * message.routes.ts already declares `maxCount: 5`.
 */
const uploadAttachment = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB stays under nginx's client_max_body_size of 70M
        files: 5,
    },
});

export { uploadAttachment, uploadAvatar }
