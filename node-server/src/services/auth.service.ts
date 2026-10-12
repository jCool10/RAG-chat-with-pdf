import {
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  BadRequestError
} from '@/core/error.response'
import User, { UserModel } from '@/models/user.model'
import { comparePassword, hashPassword } from '@/utils/bcrypt'
import { Request } from 'express'
import crypto from 'crypto'
import { createTokens } from '@/utils/jwt'
import { getDataByField } from '@/utils'
import { keyStoreService } from './keyStore,service'
import userRepo from '@/repositories/user.repo'
import keystoreRepo from '@/repositories/keystore.repo'
import { EncryptionService } from './encryption.service'
import { AsymmetricCrypto } from '@/utils/encryption.util'
import { Types } from 'mongoose'

export class authService {
  private encryptionService: EncryptionService

  constructor() {
    this.encryptionService = new EncryptionService()
  }

  login = async (req: Request) => {
    const { email, password } = req.body

    if (!email || !password) {
      throw new BadRequestError('Email and password are required')
    }

    const user = await userRepo.findByEmail(email)

    if (!user) {
      throw new UnauthorizedError('Invalid credentials')
    }

    const match = await comparePassword(password, user.password)

    if (!match) {
      throw new UnauthorizedError('Invalid credentials')
    }

    // Get or create user's encryption keys
    let userKeyPair = await this.encryptionService.getUserKeyPair(user._id)

    if (!userKeyPair) {
      // Initialize encryption for first-time login
      userKeyPair = await this.encryptionService.initializeUserEncryption(user)
    }

    // Create signed token payload
    const tokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      keyId: userKeyPair.keyId,
      loginTime: new Date().toISOString()
    }

    // Sign the token payload with user's private key for non-repudiation
    const signedPayload = await this.encryptionService.signData(JSON.stringify(tokenPayload), user._id)

    // Get private key with passphrase for token signing
    let keyData: { privateKey: string; passphrase: string }
    try {
      keyData = await this.encryptionService.getPrivateKeyWithPassphrase(user._id)
    } catch (error) {
      throw new UnauthorizedError('Failed to access user encryption keys')
    }

    // Create JWT tokens using the user's private key with passphrase
    const tokens = createTokens(user, keyData.privateKey, keyData.passphrase)

    // Store the keystore with public key and signed payload
    await keystoreRepo.create(user, userKeyPair.publicKey, signedPayload.signature, userKeyPair.keyId)

    const userData = getDataByField({
      fields: ['email', 'name', '_id'],
      object: user
    })

    return {
      user: userData,
      tokens,
      keyId: userKeyPair.keyId,
      publicKey: userKeyPair.publicKey // For client-side encryption
    }
  }

  register = async (req: Request) => {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      throw new BadRequestError('Email, password, and name are required')
    }

    const isFoundedUser = await userRepo.findByEmail(email)

    if (isFoundedUser) {
      throw new ConflictError('User already exists')
    }

    const passwordHash = await hashPassword(password)

    // Create user directly with UserModel
    const createdUser = await UserModel.create({
      email,
      password: passwordHash,
      name
    })

    // Initialize encryption for new user
    const userKeyPair = await this.encryptionService.initializeUserEncryption(createdUser)

    // Create signed token payload
    const tokenPayload = {
      userId: createdUser._id.toString(),
      email: createdUser.email,
      name: createdUser.name,
      keyId: userKeyPair.keyId,
      registrationTime: new Date().toISOString()
    }

    // Sign the token payload
    const signedPayload = await this.encryptionService.signData(JSON.stringify(tokenPayload), createdUser._id)

    // Get private key with passphrase for token signing
    let keyData: { privateKey: string; passphrase: string }
    try {
      keyData = await this.encryptionService.getPrivateKeyWithPassphrase(createdUser._id)
    } catch (error) {
      throw new UnauthorizedError('Failed to access user encryption keys')
    }

    // Create JWT tokens
    const tokens = createTokens(createdUser, keyData.privateKey, keyData.passphrase)

    // Store keystore
    await keystoreRepo.create(createdUser, userKeyPair.publicKey, signedPayload.signature, userKeyPair.keyId)

    const userData = getDataByField({
      fields: ['email', 'name', '_id'],
      object: createdUser
    })

    return {
      user: userData,
      tokens,
      keyId: userKeyPair.keyId,
      publicKey: userKeyPair.publicKey
    }
  }

  logout = async (req: Request) => {
    // The token payload is { user }, so the caller lives at req.user.user
    const { user } = req.user

    // Sign logout event for audit trail
    const logoutData = {
      userId: user._id,
      logoutTime: new Date().toISOString(),
      sessionId: req.keyStore._id.toString()
    }

    try {
      // Sign logout event (optional, for audit purposes)
      await this.encryptionService.signData(JSON.stringify(logoutData), user._id)
    } catch (error) {
      // Don't fail logout if signing fails
      console.warn('Failed to sign logout event:', error)
    }

    // Remove keystore
    await keystoreRepo.remove(req.keyStore._id)

    return { message: 'Logged out successfully' }
  }

  refreshToken = async (req: Request) => {
    // refreshAuthentication has already verified the refresh-token header
    const { refreshToken, keyStore } = req
    const { user } = req.user

    // A refresh token is single-use; seeing one again means it leaked, so revoke the whole session
    if (keyStore.refreshTokensUsed?.includes(refreshToken)) {
      await keystoreRepo.remove(keyStore._id)
      throw new UnauthorizedError('Unauthorized')
    }

    // Verify the stored signature is still valid
    try {
      const tokenPayload = {
        userId: user._id,
        email: user.email,
        name: user.name,
        keyId: keyStore.keyId || 'legacy',
        lastRefresh: new Date().toISOString()
      }

      // Create new signed payload
      const signedPayload = await this.encryptionService.signData(JSON.stringify(tokenPayload), user._id)

      // Get private key with passphrase for token signing
      let keyData: { privateKey: string; passphrase: string }
      try {
        keyData = await this.encryptionService.getPrivateKeyWithPassphrase(user._id)
      } catch (error) {
        throw new UnauthorizedError('Failed to access user encryption keys')
      }

      // Generate new tokens with private key
      const newTokens = createTokens(user, keyData.privateKey, keyData.passphrase)

      // Update keystore with new signature
      await keystoreRepo.updateOne(
        { _id: keyStore._id },
        {
          refreshToken: newTokens.refreshToken,
          signature: signedPayload.signature,
          $push: { refreshTokensUsed: refreshToken }
        }
      )

      return { tokens: newTokens }
    } catch (error) {
      throw new UnauthorizedError('Invalid refresh token or signature')
    }
  }

  /**
   * Rotate user's encryption keys (security operation)
   */
  rotateKeys = async (req: Request) => {
    const { user } = req.user

    try {
      // Generate new key pair
      const newKeyPair = await this.encryptionService.rotateUserKeys(user._id)

      // Get private key with passphrase for token signing
      let keyData: { privateKey: string; passphrase: string }
      try {
        keyData = await this.encryptionService.getPrivateKeyWithPassphrase(user._id)
      } catch (error) {
        throw new UnauthorizedError('Failed to access user encryption keys')
      }

      // Create new tokens with new private key
      const tokens = createTokens(user, keyData.privateKey, keyData.passphrase)

      // Update keystore with new public key
      await keystoreRepo.updateOne({ client: user._id }, { publicKey: newKeyPair.publicKey })

      return {
        message: 'Keys rotated successfully',
        tokens,
        keyId: newKeyPair.keyId,
        publicKey: newKeyPair.publicKey
      }
    } catch (error) {
      throw new BadRequestError('Failed to rotate keys')
    }
  }

  /**
   * Get user's public key for sharing
   */
  getPublicKey = async (req: Request) => {
    const { userId } = req.params

    if (!userId) {
      throw new BadRequestError('User ID is required')
    }

    const publicKey = await this.encryptionService.getUserPublicKey(new Types.ObjectId(userId))

    if (!publicKey) {
      throw new UnauthorizedError('User encryption not initialized')
    }

    return { publicKey }
  }

  /**
   * Encrypt sensitive data for user
   */
  encryptData = async (req: Request) => {
    const { data, recipientUserId } = req.body
    const { user } = req.user

    if (!data || !recipientUserId) {
      throw new BadRequestError('Data and recipient user ID are required')
    }

    try {
      const encryptedData = await this.encryptionService.encryptForUser(data, recipientUserId)

      // Sign the encryption operation for audit
      const operationData = {
        from: user._id.toString(),
        to: recipientUserId,
        operation: 'encrypt',
        timestamp: new Date().toISOString(),
        dataHash: AsymmetricCrypto.hashSensitiveData(data)
      }

      const signature = await this.encryptionService.signData(JSON.stringify(operationData), user._id)

      return {
        encryptedData,
        signature: signature.signature,
        operation: operationData
      }
    } catch (error) {
      throw new BadRequestError('Failed to encrypt data')
    }
  }

  /**
   * Decrypt data for user
   */
  decryptData = async (req: Request) => {
    const { encryptedData } = req.body
    const { user } = req.user

    if (!encryptedData) {
      throw new BadRequestError('Encrypted data is required')
    }

    try {
      const decryptedData = await this.encryptionService.decryptForUser(encryptedData, user._id)

      // Log decryption operation
      const operationData = {
        userId: user._id.toString(),
        operation: 'decrypt',
        keyId: encryptedData.keyId,
        timestamp: new Date().toISOString()
      }

      // Sign the decryption operation for audit
      await this.encryptionService.signData(JSON.stringify(operationData), user._id)

      return { decryptedData }
    } catch (error) {
      throw new BadRequestError('Failed to decrypt data')
    }
  }
}
