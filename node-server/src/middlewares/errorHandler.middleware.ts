import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import multer from 'multer'
import { configs } from '@/configs'

const errorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
  // Multer limit violations (file too large, too many files) are client errors
  const statusCode = error instanceof multer.MulterError ? StatusCodes.BAD_REQUEST : error.status || 500

  return res.status(statusCode).json({
    status: statusCode,
    message: error.message || 'Internal Server Error',
    errors: error.errors || [],
    // Stack traces reveal internals; only expose them outside production
    ...(configs.app.env !== 'production' && { stack: error.stack })
  })
}

export { errorHandler }
