import { rateLimit } from 'express-rate-limit'
import { StatusCodes } from 'http-status-codes'

// Brute-force guard for credential endpoints: 20 attempts per IP per 15 minutes
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    status: StatusCodes.TOO_MANY_REQUESTS,
    message: 'Too many attempts, please try again later'
  }
})
