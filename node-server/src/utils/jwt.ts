import { Types } from 'mongoose'
import jwt from 'jsonwebtoken'
import { configs } from '@/configs'

// Only these fields are embedded in tokens; JWT payloads are readable by anyone holding the token
export type TokenUser = { _id: Types.ObjectId | string; email: string; name: string }

const toTokenUser = ({ _id, email, name }: TokenUser) => ({ _id: _id.toString(), email, name })

const createTokens = (user: TokenUser, privateKey: string, passphrase?: string) => {
  try {
    // If passphrase is provided, create key object with passphrase
    const keyObject = passphrase ? { key: privateKey, passphrase } : privateKey
    const payload = { user: toTokenUser(user) }

    const accessToken = jwt.sign(payload, keyObject, {
      algorithm: 'RS256',
      expiresIn: configs.tokenInfo.accessTokenValidity
    })

    const refreshToken = jwt.sign(payload, keyObject, {
      algorithm: 'RS256',
      expiresIn: configs.tokenInfo.refreshTokenValidity
    })

    return {
      accessToken,
      refreshToken
    }
  } catch (error) {
    throw new Error('Failed to create tokens: ' + (error instanceof Error ? error.message : String(error)))
  }
}

const verifyToken = (token: string, publicKey: string) => {
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] })
}

export { verifyToken, createTokens }
