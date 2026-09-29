#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { ToqanClient } from "./toqan-client.js";
const API_KEY = process.env.TOQAN_API_KEY;
if (!API_KEY) {
    console.error("Error: TOQAN_API_KEY environment variable is required");
    process.exit(1);
}
const DEFAULT_TIMEOUT = Number(process.env.TOQAN_TIMEOUT_SECONDS ?? 300);
const client = new ToqanClient(API_KEY);
// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: "toqan_ask",
        description: "Send a message to the Toqan agent and wait for its answer. " +
            "Creates a new conversation. Returns the answer and the conversation_id " +
            "(keep it to continue the conversation later).",
        inputSchema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "The message to send to the agent.",
                },
                file_ids: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional list of file IDs (from toqan_upload_file) to attach.",
                },
            },
            required: ["message"],
        },
    },
    {
        name: "toqan_continue",
        description: "Continue an existing Toqan conversation with a new message. " +
            "Use the conversation_id returned by toqan_ask or a previous toqan_continue.",
        inputSchema: {
            type: "object",
            properties: {
                conversation_id: {
                    type: "string",
                    description: "The conversation_id from a previous toqan_ask call.",
                },
                message: {
                    type: "string",
                    description: "The follow-up message to send.",
                },
                file_ids: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional file IDs to attach to this message.",
                },
            },
            required: ["conversation_id", "message"],
        },
    },
    {
        name: "toqan_upload_file",
        description: "Upload a local file to Toqan and get a file_id to use in toqan_ask or toqan_continue. " +
            "Supports files up to 100 MB.",
        inputSchema: {
            type: "object",
            properties: {
                file_path: {
                    type: "string",
                    description: "Absolute path to the local file to upload.",
                },
                mime_type: {
                    type: "string",
                    description: 'MIME type of the file (e.g. "application/pdf", "image/png"). ' +
                        "If omitted, defaults to application/octet-stream.",
                },
            },
            required: ["file_path"],
        },
    },
    {
        name: "toqan_get_conversation",
        description: "Retrieve the full message history of a Toqan conversation.",
        inputSchema: {
            type: "object",
            properties: {
                conversation_id: { type: "string" },
            },
            required: ["conversation_id"],
        },
    },
    {
        name: "toqan_get_tool_calls",
        description: "List all tool calls the Toqan agent made during a conversation " +
            "(useful for debugging or auditing agent behaviour).",
        inputSchema: {
            type: "object",
            properties: {
                conversation_id: { type: "string" },
            },
            required: ["conversation_id"],
        },
    },
    {
        name: "toqan_get_download_url",
        description: "Generate a presigned download URL for a file produced by the Toqan agent.",
        inputSchema: {
            type: "object",
            properties: {
                file_id: { type: "string" },
            },
            required: ["file_id"],
        },
    },
];
// ── Server ────────────────────────────────────────────────────────────────────
const server = new Server({ name: "toqan-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
        switch (name) {
            case "toqan_ask": {
                const message = args["message"];
                const fileIds = args["file_ids"] ?? [];
                const files = fileIds.map((id) => ({ id }));
                const { conversation_id, request_id } = await client.createConversation(message, files);
                const answer = await client.pollAnswer(conversation_id, request_id, DEFAULT_TIMEOUT);
                return {
                    content: [
                        {
                            type: "text",
                            text: formatAnswer(conversation_id, answer),
                        },
                    ],
                };
            }
            case "toqan_continue": {
                const conversationId = args["conversation_id"];
                const message = args["message"];
                const fileIds = args["file_ids"] ?? [];
                const files = fileIds.map((id) => ({ id }));
                const { request_id } = await client.continueConversation(conversationId, message, files);
                const answer = await client.pollAnswer(conversationId, request_id, DEFAULT_TIMEOUT);
                return {
                    content: [
                        {
                            type: "text",
                            text: formatAnswer(conversationId, answer),
                        },
                    ],
                };
            }
            case "toqan_upload_file": {
                const filePath = args["file_path"];
                const mimeType = args["mime_type"] ??
                    "application/octet-stream";
                const fileContent = new Uint8Array(readFileSync(filePath));
                const filename = filePath.split("/").pop() ?? "file";
                const result = await client.uploadFileDirect(filename, fileContent, mimeType);
                return {
                    content: [
                        {
                            type: "text",
                            text: `File uploaded successfully.\nfile_id: ${result.id}\nname: ${result.name}`,
                        },
                    ],
                };
            }
            case "toqan_get_conversation": {
                const conversationId = args["conversation_id"];
                const history = await client.findConversation(conversationId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(history, null, 2),
                        },
                    ],
                };
            }
            case "toqan_get_tool_calls": {
                const conversationId = args["conversation_id"];
                const toolCalls = await client.findToolCalls(conversationId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(toolCalls, null, 2),
                        },
                    ],
                };
            }
            case "toqan_get_download_url": {
                const fileId = args["file_id"];
                const { url } = await client.getDownloadUrl(fileId);
                return {
                    content: [{ type: "text", text: `Download URL: ${url}` }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true,
        };
    }
});
function formatAnswer(conversationId, answer) {
    const lines = [
        `conversation_id: ${conversationId}`,
        `status: ${answer.status}`,
        "",
        answer.answer,
    ];
    if (answer.attachments && answer.attachments.length > 0) {
        lines.push("", "Attachments:");
        for (const att of answer.attachments) {
            lines.push(`  - ${att.name} (${att.mime_type})`);
        }
    }
    return lines.join("\n");
}
// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
