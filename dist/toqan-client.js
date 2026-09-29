const BASE_URL = "https://api.toqan.ai/api";
const POLL_INTERVAL_MS = 3000;
export class ToqanClient {
    headers;
    constructor(apiKey) {
        this.headers = {
            "X-Api-Key": apiKey,
            "Content-Type": "application/json",
        };
    }
    async request(method, path, body, queryParams) {
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
        return res.json();
    }
    async createConversation(userMessage, files) {
        return this.request("POST", "/create_conversation", {
            user_message: userMessage,
            ...(files && files.length > 0 ? { private_user_files: files } : {}),
        });
    }
    async continueConversation(conversationId, userMessage, files) {
        return this.request("POST", "/continue_conversation", {
            conversation_id: conversationId,
            user_message: userMessage,
            ...(files && files.length > 0 ? { private_user_files: files } : {}),
        });
    }
    async getAnswer(conversationId, requestId) {
        return this.request("GET", "/get_answer", undefined, {
            conversation_id: conversationId,
            request_id: requestId,
        });
    }
    // Polls until finished or error, with a configurable timeout in seconds
    async pollAnswer(conversationId, requestId, timeoutSeconds = 300) {
        const deadline = Date.now() + timeoutSeconds * 1000;
        while (Date.now() < deadline) {
            const answer = await this.getAnswer(conversationId, requestId);
            if (answer.status !== "in_progress") {
                return answer;
            }
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
        throw new Error(`Toqan agent did not respond within ${timeoutSeconds}s (conversation_id: ${conversationId})`);
    }
    async findConversation(conversationId) {
        return this.request("POST", "/find_conversation", {
            conversation_id: conversationId,
        });
    }
    async findToolCalls(conversationId) {
        return this.request("POST", "/find_tool_calls", {
            conversation_id: conversationId,
        });
    }
    // Returns a presigned upload URL + file id to use in messages
    async createUploadUrl(filename, mimeType) {
        return this.request("POST", "/create_private_user_file_upload_url", { filename, mime_type: mimeType });
    }
    // Uploads a file via the presigned URL
    async uploadFileViaUrl(uploadUrl, fileContent, mimeType) {
        const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: fileContent.buffer,
        });
        if (!res.ok) {
            throw new Error(`File upload failed: ${res.status}`);
        }
    }
    // Direct upload (≤100 MB) — returns file metadata
    async uploadFileDirect(filename, fileContent, mimeType) {
        const url = `${BASE_URL}/upload_file`;
        const formData = new FormData();
        const blob = new Blob([fileContent.buffer], { type: mimeType });
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
        return res.json();
    }
    async getDownloadUrl(fileId) {
        return this.request("POST", "/get_download_file_url", {
            file_id: fileId,
        });
    }
}
