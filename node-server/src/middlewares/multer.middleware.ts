import path from 'path'
import { configs } from '@/configs'
import { s3 } from '@/configs/s3.config'
import { BadRequestError } from '@/core/error.response'
import multer from 'multer'
import multerS3 from 'multer-s3'

// Matches the loaders in python-server (pypdf, python-docx, plain text)
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt']
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
export const MAX_FILES_PER_UPLOAD = 10

// The S3 key later becomes a local file path (utils/s3.ts), so strip any directory part of the client filename
const safeFileName = (originalName: string) => path.basename(originalName.replace(/\\/g, '/'))

const storage = multerS3({
  s3,
  bucket: configs.s3.bucket,
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname })
  },
  key: (req, file, cb) => {
    cb(null, `${Date.now()}-${safeFileName(file.originalname)}`)
  }
})

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return cb(new BadRequestError(`Unsupported file type: ${extension || 'none'}`))
    }

    cb(null, true)
  }
})
