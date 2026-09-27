use serde::{Deserialize, Serialize};

// ponytail: ACP v2 is JSON-RPC 2.0 over newline-delimited JSON. The client
// sends requests (id => response) and notifications (no id); the agent sends
// session/update notifications plus session/request_permission requests that
// the client must answer by id. Shapes mirror @agentclientprotocol/sdk v2.

/// Identifier used to correlate a request with its response.
pub type RequestId = u64;

// ---- JSON-RPC envelopes -------------------------------------------------

/// A message the client sends: either a request (with id, expects a response)
/// or a notification (no id, fire and forget).
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ClientMessage {
    Request {
        jsonrpc: &'static str,
        id: RequestId,
        method: String,
        params: serde_json::Value,
    },
    Notification {
        jsonrpc: &'static str,
        method: String,
        params: serde_json::Value,
    },
    /// The answer to an agent-originated request (e.g. a permission prompt).
    Response {
        jsonrpc: &'static str,
        id: RequestId,
        result: serde_json::Value,
    },
}

/// Anything the agent sends over the wire.
#[derive(Debug, Deserialize)]
pub struct AgentMessage {
    /// Present on requests and responses, absent on notifications.
    #[serde(default)]
    pub id: Option<RequestId>,
    #[serde(default)]
    pub method: Option<String>,
    /// Notifications and requests carry params; responses carry result.
    #[serde(default)]
    pub params: Option<serde_json::Value>,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
}

// ---- High level events the UI consumes ----------------------------------

/// One permission option the user may pick (e.g. allow once, reject always).
#[derive(Debug, Clone)]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

/// The agent is asking the user to approve something. The client must answer
/// by the request id or the turn hangs forever.
#[derive(Debug, Clone)]
pub struct PermissionRequest {
    pub id: RequestId,
    pub title: String,
    pub description: Option<String>,
    /// Best-effort tool name extracted from the subject, for the prompt UI.
    pub tool_name: Option<String>,
    pub options: Vec<PermissionOption>,
}

/// Parsed agent output. This is the contract between the wire layer and the
/// UI: daemon.rs produces these, state.rs/ui.rs consume them.
#[derive(Debug)]
pub enum AcpEvent {
    /// session/new succeeded.
    SessionReady { session_id: String },
    /// A chunk of the assistant's visible message (streamed).
    AgentMessageChunk { text: String },
    /// The final, complete assistant message.
    AgentMessage { text: String },
    /// A chunk of the assistant's thinking (reasoning, shown collapsed/dim).
    AgentThoughtChunk { text: String },
    AgentThought { text: String },
    /// A tool call started, changed, or finished.
    ToolCallUpdate {
        name: Option<String>,
        title: Option<String>,
        status: Option<String>,
        /// Flattened text of the tool's content blocks, if any.
        content_text: Option<String>,
    },
    /// Incremental output for an existing tool call.
    ToolCallContentChunk { text: String },
    /// Token / context usage for the running turn.
    UsageUpdate {
        used: u64,
        size: u64,
        cost_usd: Option<f64>,
    },
    /// The agent wants permission; the UI must render a prompt and the main
    /// loop must answer via [AcpClient::respond_permission].
    RequestPermission(PermissionRequest),
    /// Something went wrong on the wire or the agent reported an error.
    Error { message: String },
    /// The socket closed; no more events will arrive.
    Closed,

    /// The agent's run state changed (working / idle / needs input).
    StateUpdate { state: String },
    /// A plan appeared or changed. `text` is the rendered plan body.
    PlanUpdate { plan_id: String, text: String },
    /// A plan was removed.
    PlanRemoved { plan_id: String },

    /// The session's human-readable title changed.
    SessionTitle { title: String },
    /// Commands the agent offers (slash-command menu).
    AvailableCommands { names: Vec<String> },
    /// Configuration options (model, mode, ...) with their current values.
    ConfigOptions { summary: String },
    /// A terminal (Bash tool) started or reported its state.
    TerminalUpdate {
        terminal_id: String,
        command: Option<String>,
        exited: Option<i32>,
    },
    /// Decoded bytes from a terminal.
    TerminalOutputChunk { terminal_id: String, text: String },
    /// Context compaction lifecycle.
    CompactionUpdate { status: String, summary: Option<String> },
    /// A chunk of the compaction summary text.
    CompactionSummaryChunk { text: String },
    /// The user's own message, echoed back by the agent.
    UserMessageChunk { text: String },
    UserMessage { text: String },
}

/// Compute the default daemon socket path, matching `defaultSharedAddress()`
/// in `src/daemon/sharedClient.ts`.
pub fn default_socket_path() -> String {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().into_owned());
    format!("{}/claude.sock", base)
}

/// Flatten a session/update `update` value into the high level event it
/// represents. Unknown variants degrade to None (the UI ignores them) rather
/// than failing the whole stream.
pub fn parse_session_update(params: &serde_json::Value) -> Option<AcpEvent> {
    let update = params.get("update")?;
    let kind = update.get("sessionUpdate").and_then(|v| v.as_str())?;
    match kind {
        "agent_message_chunk" | "agent_thought_chunk" => {
            let thought = kind == "agent_thought_chunk";
            let text = text_of_content(update.get("content"));
            Some(if thought {
                AcpEvent::AgentThoughtChunk { text }
            } else {
                AcpEvent::AgentMessageChunk { text }
            })
        }
        "agent_message" | "agent_thought" => {
            let thought = kind == "agent_thought";
            let text = text_of_content_array(update.get("content"));
            Some(if thought {
                AcpEvent::AgentThought { text }
            } else {
                AcpEvent::AgentMessage { text }
            })
        }
        "tool_call_update" => Some(AcpEvent::ToolCallUpdate {
            name: update
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            title: update
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            status: update
                .get("status")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            content_text: tool_content_text(update.get("content")),
        }),
        "tool_call_content_chunk" => Some(AcpEvent::ToolCallContentChunk {
            text: tool_content_text(update.get("content")).unwrap_or_default(),
        }),
        "usage_update" => Some(AcpEvent::UsageUpdate {
            used: update.get("used").and_then(|v| v.as_u64()).unwrap_or(0),
            size: update.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
            cost_usd: update
                .get("cost")
                .and_then(|c| c.get("usd"))
                .and_then(|v| v.as_f64()),
        }),
        "state_update" => Some(AcpEvent::StateUpdate {
            state: update
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        }),
        "plan_update" => {
            let plan = update.get("plan")?;
            let plan_id = plan
                .get("planId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let text = match plan.get("type").and_then(|v| v.as_str()) {
                // items: render the entries with their status.
                Some("items") => plan
                    .get("entries")
                    .and_then(|v| v.as_array())
                    .map(|entries| {
                        entries
                            .iter()
                            .map(|e| {
                                let status = e.get("status").and_then(|v| v.as_str()).unwrap_or("");
                                let mark = match status {
                                    "completed" => 'x',
                                    "in_progress" => '>',
                                    "cancelled" => '-',
                                    _ => ' ',
                                };
                                format!(
                                    "[{}] {}",
                                    mark,
                                    e.get("content").and_then(|v| v.as_str()).unwrap_or("")
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default(),
                Some("markdown") => plan
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                // file plans and custom types: surface the locator only.
                _ => plan
                    .get("uri")
                    .and_then(|v| v.as_str())
                    .map(|u| format!("plan in {u}"))
                    .unwrap_or_default(),
            };
            Some(AcpEvent::PlanUpdate { plan_id, text })
        }
        "plan_removed" => Some(AcpEvent::PlanRemoved {
            plan_id: update
                .get("planId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        }),
        "session_info_update" => Some(AcpEvent::SessionTitle {
            title: update
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        }),
        "available_commands_update" => Some(AcpEvent::AvailableCommands {
            names: update
                .get("availableCommands")
                .and_then(|v| v.as_array())
                .map(|cmds| {
                    cmds.iter()
                        .filter_map(|c| c.get("name").and_then(|n| n.as_str()))
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        }),
        "config_option_update" => Some(AcpEvent::ConfigOptions {
            summary: update
                .get("configOptions")
                .and_then(|v| v.as_array())
                .map(|opts| {
                    opts.iter()
                        .map(|o| {
                            let name = o
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("?");
                            let value = o
                                .get("value")
                                .map(scalar_to_string)
                                .unwrap_or_default();
                            format!("{name}={value}")
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default(),
        }),
        "terminal_update" => Some(AcpEvent::TerminalUpdate {
            terminal_id: str_field(update, "terminalId"),
            command: opt_str_field(update, "command"),
            exited: update
                .get("exitStatus")
                .and_then(|s| s.get("code"))
                .and_then(|c| c.as_i64())
                .map(|c| c as i32),
        }),
        "terminal_output_chunk" => Some(AcpEvent::TerminalOutputChunk {
            terminal_id: str_field(update, "terminalId"),
            text: decode_base64(&str_field(update, "data")),
        }),
        "compaction_update" => Some(AcpEvent::CompactionUpdate {
            status: str_field(update, "status"),
            summary: update
                .get("summary")
                .map(|s| text_of_content_array(Some(s)))
                .filter(|s| !s.is_empty()),
        }),
        "compaction_summary_chunk" => Some(AcpEvent::CompactionSummaryChunk {
            text: text_of_content(update.get("content")),
        }),
        "user_message_chunk" => Some(AcpEvent::UserMessageChunk {
            text: text_of_content(update.get("content")),
        }),
        "user_message" => Some(AcpEvent::UserMessage {
            text: text_of_content_array(update.get("content")),
        }),
        _ => None,
    }
}

fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn opt_str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

/// Render a config value, which may be a bare scalar or a select's `id`.
fn scalar_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Object(_) => v
            .get("id")
            .and_then(|i| i.as_str())
            .map(str::to_string)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// Minimal base64 decoder: ACP terminal chunks are independently base64
/// encoded, and pulling in a crate for ~20 lines is not worth the binary size.
fn decode_base64(input: &str) -> String {
    let mut out: Vec<u8> = Vec::with_capacity(input.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for c in input.bytes() {
        let val = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            // padding and whitespace end the payload
            _ => continue,
        } as u32;
        acc = (acc << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Pull the text out of a single ContentBlock (`{type:"text", text:"..."}`).
fn text_of_content(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(v) if v.get("type").and_then(|t| t.as_str()) == Some("text") => {
            v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string()
        }
        _ => String::new(),
    }
}

/// Concatenate the text blocks of a `[ContentBlock]`.
fn text_of_content_array(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::Array(blocks)) => blocks
            .iter()
            .map(text_of_content_value)
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn text_of_content_value(v: &serde_json::Value) -> String {
    text_of_content(Some(v))
}

/// Best-effort text from a tool call's content array (tool results).
fn tool_content_text(content: Option<&serde_json::Value>) -> Option<String> {
    match content {
        Some(serde_json::Value::Array(blocks)) => {
            let text: String = blocks
                .iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str()).map(str::to_string)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

/// Turn an agent request (`session/request_permission`) into a high level
/// permission event, extracting the options the UI offers.
pub fn parse_permission_request(id: RequestId, params: &serde_json::Value) -> AcpEvent {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Permission requested")
        .to_string();
    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let tool_name = params
        .get("subject")
        .and_then(|s| s.get("toolName"))
        .or_else(|| params.get("subject").and_then(|s| s.get("tool_name")))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let options = params
        .get("options")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|o| {
                    Some(PermissionOption {
                        option_id: o.get("optionId")?.as_str()?.to_string(),
                        name: o.get("name")?.as_str()?.to_string(),
                        kind: o
                            .get("kind")
                            .and_then(|k| k.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    AcpEvent::RequestPermission(PermissionRequest {
        id,
        title,
        description,
        tool_name,
        options,
    })
}
