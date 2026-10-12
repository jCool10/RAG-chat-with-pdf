import mongoose from 'mongoose'
import { configs } from '.'
import logger from './logger.config'

const { maxPoolSize, minPoolSize, url } = configs.mongodb

const dbURI = url

const options = {
  autoIndex: true,
  minPoolSize: minPoolSize, // Maintain up to x socket connections
  maxPoolSize: maxPoolSize, // Maintain up to x socket connections
  connectTimeoutMS: 60000, // Give up initial connection after 10 seconds
  socketTimeoutMS: 45000 // Close sockets after 45 seconds of inactivity
}

function setRunValidators() {
  mongoose.set('runValidators', true)
}

mongoose.set('strictQuery', true)
// Query logging prints filter values (emails, ids); keep it out of production logs
mongoose.set('debug', configs.app.env !== 'production')

// Create the database connection
mongoose
  .plugin((schema: any) => {
    schema.pre('findOneAndUpdate', setRunValidators)
    schema.pre('updateMany', setRunValidators)
    schema.pre('updateOne', setRunValidators)
    schema.pre('update', setRunValidators)
  })
  .connect(dbURI, options)
  .then(() => {
    logger.info('Mongoose connection done')
  })
  .catch((e) => {
    logger.info('Mongoose connection error')
    logger.error(e)
  })

// CONNECTION EVENTS
// When successfully connected
mongoose.connection.on('connected', () => {
  logger.debug('Mongoose default connection open')
})

// If the connection throws an error
mongoose.connection.on('error', (err) => {
  logger.error('Mongoose default connection error: ' + err)
})

// When the connection is disconnected
mongoose.connection.on('disconnected', () => {
  logger.info('Mongoose default connection disconnected')
})

// If the Node process ends, close the Mongoose connection
process.on('SIGINT', () => {
  mongoose.connection.close().finally(() => {
    logger.info('Mongoose default connection disconnected through app termination')
    process.exit(0)
  })
})

export const connection = mongoose.connection
