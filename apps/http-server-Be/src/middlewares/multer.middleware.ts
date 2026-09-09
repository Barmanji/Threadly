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

export const upload = multer({
    storage: storage
}) //because its es6 we dont need storage: storage, BUT I LIKE IT THAT WAYYYYYYYYYYYYYYYYYYY.. oohoohoho



