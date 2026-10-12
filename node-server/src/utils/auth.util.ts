import { UnauthorizedError } from '@/core/error.response'
import catchAsync from '@/helpers/cathAsync'
import { KeystoreModel } from '@/models/keyStore.model'
import { NextFunction, Request, Response } from 'express'
import { TokenExpiredError } from 'jsonwebtoken'
import mongoose from 'mongoose'
import { verifyToken } from './jwt'
import { ApiKeyModel } from '@/models/apiKey.model'

// Tokens are signed with a per-user key, so the client-id header selects the public key to verify with
const findKeyStore = async (clientId?: string) => {
  if (!clientId || !mongoose.isValidObjectId(clientId)) {
    throw new UnauthorizedError('Unauthorized')
  }

  const keyStore = await KeystoreModel.findOne({ client: new mongoose.Types.ObjectId(clientId) }).lean()

  if (!keyStore) {
    throw new UnauthorizedError('Unauthorized')
  }

  return keyStore
}

// client/utils/axios.ts refreshes on "jwt expired" and logs the user out on "Unauthorized"
const decodeToken = (token: string, publicKey: string) => {
  try {
    return verifyToken(token, publicKey)
  } catch (error) {
    throw new UnauthorizedError(error instanceof TokenExpiredError ? 'jwt expired' : 'Unauthorized')
  }
}

export const authentication = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const accessToken = req.headers['authorization'] as string | undefined

  if (!accessToken) {
    throw new UnauthorizedError('Unauthorized')
  }

  const keyStore = await findKeyStore(req.headers['client-id'] as string | undefined)

  req.user = decodeToken(accessToken, keyStore.publicKey)
  req.keyStore = keyStore

  return next()
})

// Only the refresh endpoint accepts a refresh token; every other route requires an access token
export const refreshAuthentication = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const refreshToken = req.headers['refresh-token'] as string | undefined

  if (!refreshToken) {
    throw new UnauthorizedError('Unauthorized')
  }

  const keyStore = await findKeyStore(req.headers['client-id'] as string | undefined)

  req.user = decodeToken(refreshToken, keyStore.publicKey)
  req.keyStore = keyStore
  req.refreshToken = refreshToken

  return next()
})

export const apikey = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const key = req.headers['x-api-key']?.toString()

  if (!key) {
    throw new UnauthorizedError('Unauthorized')
  }

  const apiKey = await ApiKeyModel.findOne({ key, status: true }).lean().exec()

  if (!apiKey) {
    throw new UnauthorizedError('Unauthorized')
  }

  req.apiKey = apiKey

  return next()
})

// export const permission = (permission: string) => {
//   return (req: Request, res: Response, next: NextFunction) => {
//     if (!req.apiKey?.permissions) {
//       throw new ForbiddenError('Permission Denied')
//     }

//     const exists = req.apiKey.permissions.find((entry: string) => entry === permission)

//     if (!exists) {
//       throw new ForbiddenError('Permission Denied')
//     }

//     return next()
//   }
// }
