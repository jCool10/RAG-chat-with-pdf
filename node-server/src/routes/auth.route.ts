import { authController } from '@/controllers/auth.controller'
import catchAsync from '@/helpers/cathAsync'
import { authRateLimit } from '@/middlewares/rate-limit.middleware'
import { authentication, refreshAuthentication } from '@/utils/auth.util'
import { Router } from 'express'

export const authRouter = (router: Router) => {
  const AuthController = new authController()

  router.use('/auth', router)

  // Public routes (no authentication required)
  router.post('/register', authRateLimit, catchAsync(AuthController.register))
  router.post('/login', authRateLimit, catchAsync(AuthController.login))

  // Authenticated by the refresh-token header, so it must be registered before the access-token guard
  router.post('/refresh-token', refreshAuthentication, catchAsync(AuthController.refreshToken))

  // Protected routes (authentication required)
  router.use(authentication)

  router.post('/logout', catchAsync(AuthController.logout))

  // Encryption and security routes
  router.post('/rotate-keys', catchAsync(AuthController.rotateKeys))
  router.get('/public-key/:userId', catchAsync(AuthController.getPublicKey))
  router.post('/encrypt', catchAsync(AuthController.encryptData))
  router.post('/decrypt', catchAsync(AuthController.decryptData))
}
