import { Router } from 'express'
import { filesController } from '@/controllers/files.controller'
import catchAsync from '@/helpers/cathAsync'
import { MAX_FILES_PER_UPLOAD, upload } from '@/middlewares/multer.middleware'

export const filesRouter = (router: Router) => {
  const FilesController = new filesController()

  router.use('/files', router)

  router.post('/embed', upload.array('files', MAX_FILES_PER_UPLOAD), catchAsync(FilesController.embedFiles))
  router.get('/workspaces', catchAsync(FilesController.getWorkspaces))
  router.get('/workspace/:workspaceSlug', catchAsync(FilesController.getWorkspace))
  router.post('/workspace/:workspaceSlug/query', catchAsync(FilesController.queryWorkspace))
  router.get('/workspace/:workspaceSlug/messages', catchAsync(FilesController.getMessages))
}
