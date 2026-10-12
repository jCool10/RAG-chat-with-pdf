import { Request } from 'express'
import workspaceRepo from '@/repositories/worksapce.repo'
import { downloadFile } from '@/utils/s3'
import messageRepo from '@/repositories/message.repo'
import axios from 'axios'
import { configs } from '@/configs'
import { BadRequestError, NotFoundError } from '@/core/error.response'

const RAG_API_URL = configs.rag.url

// Q&A pairs sent to the LLM as conversation history; the model context is 4096 tokens
const HISTORY_PAIRS = 3

// Slug lookups must be scoped to the caller, or any logged-in user could read another user's workspace.
// A foreign slug is reported as missing so existence does not leak.
const findOwnedWorkspace = async (req: Request, workspaceSlug: string) => {
  const { user } = req.user
  const workspace = await workspaceRepo.findBySlugAndUser(workspaceSlug, user._id)

  if (!workspace) {
    throw new NotFoundError('Workspace not found')
  }

  return workspace
}

class filesService {
  async embedFiles(req: Request) {
    const files = req.files
    const { workspaceName } = req.body
    const { user } = req.user

    if (!files || !workspaceName) {
      throw new BadRequestError('Missing required fields')
    }

    const filePaths = await Promise.all(files.map((file) => downloadFile({ key: file.key })))

    const newWorkspace = await workspaceRepo.create({
      name: workspaceName,
      user: user._id,
      filePaths,
      fileKeys: files.map((file) => file.key)
    })

    if (!newWorkspace) {
      throw new BadRequestError('Failed to create workspace')
    }

    const result = await axios.post(`${RAG_API_URL}/embed`, {
      file_paths: filePaths,
      collection_name: newWorkspace.slug
    })

    if (result.data.success) {
      await workspaceRepo.updateOne({ _id: newWorkspace._id }, { isEmbedded: true })
    } else {
      throw new BadRequestError(result.data.message)
    }

    return {
      slug: newWorkspace.slug
    }
  }

  async reEmbedFiles(req: Request) {
    const { workspaceSlug } = req.body

    const workspace = await findOwnedWorkspace(req, workspaceSlug)

    const result = await axios.post(`${RAG_API_URL}/embed`, {
      file_paths: workspace.filePaths,
      collection_name: workspaceSlug
    })

    if (result.data.success) {
      await workspaceRepo.updateOne({ _id: workspace._id }, { isEmbedded: true })
    } else {
      throw new BadRequestError(result.data.message)
    }

    return {
      workspace,
      filePaths: workspace.filePaths,
      embedding: result.data
    }
  }

  async getWorkspaces(req: Request) {
    const { user } = req.user

    const workspaces = await workspaceRepo.findByUserId(user._id)

    return workspaces
  }

  async getMessages(req: Request) {
    const { workspaceSlug } = req.params
    await findOwnedWorkspace(req, workspaceSlug)
    const messages = await messageRepo.getMessages(workspaceSlug)
    return messages
  }

  async chat(req: Request) {
    const { workspaceId } = req.params
    const { question } = req.body

    return {}
  }

  async getWorkspace(req: Request) {
    const { workspaceSlug } = req.params
    const workspace = await findOwnedWorkspace(req, workspaceSlug)

    const messages = await messageRepo.getMessages(workspaceSlug)

    return {
      workspace,
      messages
    }
  }

  async queryWorkspace(req: Request) {
    const { workspaceSlug } = req.params
    const { question } = req.body

    if (!question) {
      throw new BadRequestError('Question is required')
    }

    await findOwnedWorkspace(req, workspaceSlug)
    const messages = await messageRepo.getMessages(workspaceSlug, 3)

    // One Message document holds the whole conversation; send only the most recent exchanges
    const history = messages.flatMap((message) => message.messages.map((msg) => msg.message)).slice(-HISTORY_PAIRS * 2)

    const response = await axios.post(`${RAG_API_URL}/query`, {
      query: question,
      collection_name: workspaceSlug,
      history
    })

    const responseData = response.data.data

    const sourceDocuments = responseData.docs.map((doc: any) => ({
      text: doc.text,
      metadata: doc.metadata
    }))

    await messageRepo.findOneAndUpdate(workspaceSlug, question, responseData.response, sourceDocuments)

    return {
      type: 'apiMessage',
      message: responseData.response,
      sourceDocs: sourceDocuments
    }
  }
}

export default filesService
