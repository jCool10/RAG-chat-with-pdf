'use strict'

import express, { Application } from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import expressWinston from 'express-winston'
import logger from './logger.config'

// JSON/text bodies are small (questions, auth payloads); files arrive as multipart and are capped in multer.middleware.ts
const BODY_LIMIT = '1mb'

export default (app: Application) => {
  app.use(morgan('dev'))
  app.use(express.text({ limit: BODY_LIMIT }))
  app.use(express.json({ limit: BODY_LIMIT }))
  app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }))
  app.use(
    compression({
      level: 6,
      threshold: 100 * 1024,
      filter: (req) => {
        return !req.headers['x-no-compress']
      }
    })
  )
  app.use(helmet())

  const whiteList = ['http://localhost:3000']
  app.use(
    cors({
      origin: whiteList,
      credentials: true
    })
  )

  app.use(
    expressWinston.logger({
      winstonInstance: logger,
      statusLevels: true,
      // Request headers are logged by default; these carry credentials
      headerBlacklist: ['authorization', 'refresh-token', 'cookie']
    })
  )

  return app
}
