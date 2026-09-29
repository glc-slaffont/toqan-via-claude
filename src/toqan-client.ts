const BASE_URL = "https://api.toqan.ai/api";
const POLL_INTERVAL_MS = 3000;

export interface ToqanFile {
  id: string;
}

export interface ConversationResult {
  conversation_id: string;
  request_id: string;
}

export interface Answer {
  status: "in_progress" | "finished" | "error";
  answer: string;
  timestamp: string;
  attachments: Array<{ name: string; mime_type: string }>;
}

export interface ConversationHistory {
  conversation_id: string;
  messages: unknown[];
}

export interface ToolCall {
  tool_name: string;
  input: unknown;
  output: unknown;
}

export class ToqanClient {
  private headers: Record<string, string>;

  constructor(apiKey: string) {
    this.headers = {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Toqan API ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async createConversation(
    userMessage: string,
    files?: ToqanFile[]
  ): Promise<ConversationResult> {
    return this.request<ConversationResult>("POST", "/create_conversation", {
      user_message: userMessage,
      ...(files && files.length > 0 ? { private_user_files: files } : {}),
    });
  }

  async continueConversation(
    conversationId: string,
    userMessage: string,
    files?: ToqanFile[]
  ): Promise<ConversationResult> {
    return this.request<ConversationResult>("POST", "/continue_conversation", {
      conversation_id: conversationId,
      user_message: userMessage,
      ...(files && files.length > 0 ? { private_user_files: files } : {}),
    });
  }

  async getAnswer(
    conversationId: string,
    requestId: string
  ): Promise<Answer> {
    return this.request<Answer>("GET", "/get_answer", undefined, {
      conversation_id: conversationId,
      request_id: requestId,
    });
  }

  // Polls until finished or error, with a configurable timeout in seconds
  async pollAnswer(
    conversationId: string,
    requestId: string,
    timeoutSeconds = 300
  ): Promise<Answer> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      const answer = await this.getAnswer(conversationId, requestId);
      if (answer.status !== "in_progress") {
        return answer;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error(
      `Toqan agent did not respond within ${timeoutSeconds}s (conversation_id: ${conversationId})`
    );
  }

  async findConversation(conversationId: string): Promise<ConversationHistory> {
    return this.request<ConversationHistory>("POST", "/find_conversation", {
      conversation_id: conversationId,
    });
  }

  async findToolCalls(conversationId: string): Promise<ToolCall[]> {
    return this.request<ToolCall[]>("POST", "/find_tool_calls", {
      conversation_id: conversationId,
    });
  }

  // Returns a presigned upload URL + file id to use in messages
  async createUploadUrl(
    filename: string,
    mimeType: string
  ): Promise<{ upload_url: string; file_id: string }> {
    return this.request<{ upload_url: string; file_id: string }>(
      "POST",
      "/create_private_user_file_upload_url",
      { filename, mime_type: mimeType }
    );
  }

  // Uploads a file via the presigned URL
  async uploadFileViaUrl(
    uploadUrl: string,
    fileContent: Uint8Array,
    mimeType: string
  ): Promise<void> {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: fileContent.buffer as ArrayBuffer,
    });
    if (!res.ok) {
      throw new Error(`File upload failed: ${res.status}`);
    }
  }

  // Direct upload (≤100 MB) — returns file metadata
  async uploadFileDirect(
    filename: string,
    fileContent: Uint8Array,
    mimeType: string
  ): Promise<{ id: string; name: string }> {
    const url = `${BASE_URL}/upload_file`;
    const formData = new FormData();
    const blob = new Blob([fileContent.buffer as ArrayBuffer], { type: mimeType });
    formData.append("file", blob, filename);

    const res = await fetch(url, {
      method: "PUT",
      headers: { "X-Api-Key": this.headers["X-Api-Key"] },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Toqan upload ${res.status}: ${text}`);
    }

    return res.json() as Promise<{ id: string; name: string }>;
  }

  async getDownloadUrl(fileId: string): Promise<{ url: string }> {
    return this.request<{ url: string }>("POST", "/get_download_file_url", {
      file_id: fileId,
    });
  }
}
