use crate::protocol::{AcpEvent, PermissionOption, RequestId};

/// One rendered line of the conversation.
#[derive(Clone, Debug)]
pub struct Message {
    pub role: Role,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
    /// The assistant's private reasoning, rendered dim.
    Thought,
    /// A tool call and its output.
    Tool,
    /// The agent's plan, rendered as a checklist.
    Plan,
    /// A terminal's command line and output.
    Terminal,
}

impl Message {
    pub fn new(role: Role, text: impl Into<String>) -> Self {
        Self { role, text: text.into() }
    }
}

/// A tool call in flight or finished, accumulated by `toolCallId`.
#[derive(Clone, Debug)]
pub struct ToolCall {
    pub name: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub output: String,
}

/// Pending permission prompt the user must answer before the turn continues.
#[derive(Clone, Debug)]
pub struct PendingPermission {
    pub id: RequestId,
    pub title: String,
    pub description: Option<String>,
    pub tool_name: Option<String>,
    pub options: Vec<PermissionOption>,
    /// Highlighted option index for arrow/number key selection.
    pub selected: usize,
}

/// Everything the TUI renders and the input buffer state.
#[derive(Default)]
pub struct UiState {
    pub messages: Vec<Message>,
    pub input: String,
    /// Up/down arrow history; `history_pos` is an index from the end.
    pub history: Vec<String>,
    pub history_pos: usize,
    pub session_id: Option<String>,
    pub busy: bool,
    /// Accumulated assistant text for the message currently streaming.
    pub streaming: Option<String>,
    /// Accumulated thinking for the current turn.
    pub thinking: Option<String>,
    pub tools: Vec<ToolCall>,
    /// The agent's current run state ("running"/"idle"/"requires_action").
    pub agent_state: String,
    /// Rendered plan bodies keyed by plan id, shown above the transcript tail.
    pub plans: std::collections::HashMap<String, String>,
    pub permission: Option<PendingPermission>,
    /// The session's human-readable title, shown in the transcript border.
    pub title: String,
    /// Slash commands the agent advertises, for the hint line.
    pub commands: Vec<String>,
    /// Decoded terminal output, keyed by terminal id, in arrival order.
    pub terminals: Vec<(String, String)>,
    /// Compaction lifecycle text ("compacting…", the summary, failures).
    pub compaction: Option<String>,
    /// Streaming echo of the user's own message (agents may resend it).
    pub user_echo: Option<String>,
    pub usage: Option<(u64, u64, Option<f64>)>,
    pub status: String,
    pub quit: bool,
    /// Did the input scroll past the end? Pin the view to the bottom then.
    pub follow_bottom: bool,
}

impl UiState {
    /// Apply one protocol event to the view state.
    pub fn apply(&mut self, event: AcpEvent) {
        match event {
            AcpEvent::SessionReady { session_id } => {
                self.session_id = Some(session_id);
            }
            AcpEvent::AgentMessageChunk { text, .. } => {
                self.streaming.get_or_insert_with(String::new).push_str(&text);
                self.follow_bottom = true;
            }
            AcpEvent::AgentMessage { text, .. } => {
                // Final message supersedes the chunks.
                self.streaming = Some(text);
                self.finish_turn();
            }
            AcpEvent::AgentThoughtChunk { text, .. } => {
                self.thinking.get_or_insert_with(String::new).push_str(&text);
            }
            AcpEvent::AgentThought { text, .. } => {
                self.thinking = Some(text);
            }
            AcpEvent::ToolCallUpdate {
                name,
                title,
                status,
                content_text,
            } => {
                // ACP updates are keyed by toolCallId; the client keeps one
                // running tool slot per turn, which is what the UI needs.
                if let Some(tool) = self.tools.last_mut() {
                    if let Some(n) = name {
                        tool.name = n;
                    }
                    if let Some(t) = title {
                        tool.title = Some(t);
                    }
                    if let Some(s) = status {
                        tool.status = Some(s);
                    }
                    if let Some(c) = content_text {
                        tool.output = c;
                    }
                } else {
                    self.tools.push(ToolCall {
                        name: name.unwrap_or_default(),
                        title,
                        status,
                        output: content_text.unwrap_or_default(),
                    });
                }
                self.follow_bottom = true;
            }
            AcpEvent::ToolCallContentChunk { text, .. } => {
                if let Some(tool) = self.tools.last_mut() {
                    tool.output.push_str(&text);
                }
                self.follow_bottom = true;
            }
            AcpEvent::UsageUpdate { used, size, cost_usd } => {
                self.usage = Some((used, size, cost_usd));
            }

            AcpEvent::StateUpdate { state } => {
                self.agent_state = state.clone();
                // requires_action ends a turn from the client's point of view:
                // the agent is waiting on the user, not still streaming.
                self.busy = state == "running";
                if state == "requires_action" {
                    self.finish_turn();
                }
            }
            AcpEvent::PlanUpdate { plan_id, text } => {
                self.plans.insert(plan_id, text);
            }
            AcpEvent::PlanRemoved { plan_id } => {
                self.plans.remove(&plan_id);
            }
            AcpEvent::SessionTitle { title } => {
                self.title = title;
            }
            AcpEvent::AvailableCommands { names } => {
                self.commands = names;
            }
            AcpEvent::ConfigOptions { summary } => {
                self.status = summary;
            }
            AcpEvent::TerminalUpdate { terminal_id, command, exited } => {
                // A command with no exit status starts (or restarts) the
                // entry; one carrying an exit status annotates the entry that
                // already collected the output.
                if let Some((_, existing)) =
                    self.terminals.iter_mut().find(|(id, _)| id == &terminal_id)
                {
                    if let Some(code) = exited {
                        existing.push_str(&format!("  (exit {code})"));
                    } else if existing.starts_with("$ ") {
                        existing.clear();
                        existing.push_str(&format!("$ {}", command.as_deref().unwrap_or("")));
                    }
                } else {
                    let line = format!("$ {}", command.as_deref().unwrap_or(&terminal_id));
                    self.terminals.push((terminal_id, line));
                }
            }
            AcpEvent::TerminalOutputChunk { terminal_id, text } => {
                if let Some((_, existing)) =
                    self.terminals.iter_mut().find(|(id, _)| id == &terminal_id)
                {
                    if !text.is_empty() && !existing.ends_with('\n') {
                        existing.push('\n');
                    }
                    existing.push_str(&text);
                } else {
                    self.terminals.push((terminal_id, text));
                }
                self.follow_bottom = true;
            }
            AcpEvent::CompactionUpdate { status, summary } => {
                self.compaction = match status.as_str() {
                    "in_progress" => Some("compacting context…".to_string()),
                    "failed" => Some("compaction failed".to_string()),
                    "cancelled" => None,
                    _ => summary,
                };
            }
            AcpEvent::CompactionSummaryChunk { text } => {
                self.compaction.get_or_insert_default().push_str(&text);
                self.follow_bottom = true;
            }
            // We record the prompt at submit time; the agent echoes it back, so
            // user messages are only rendered if they differ from ours.
            AcpEvent::UserMessageChunk { text } => {
                self.set_user_echo(&text);
            }
            AcpEvent::UserMessage { text } => {
                self.set_user_echo(&text);
            }
            AcpEvent::RequestPermission(req) => {
                let options = req.options;
                // Default to the first allow option if there is one.
                let selected = options
                    .iter()
                    .position(|o| o.kind.starts_with("allow"))
                    .unwrap_or(0);
                self.permission = Some(PendingPermission {
                    id: req.id,
                    title: req.title,
                    description: req.description,
                    tool_name: req.tool_name,
                    options,
                    selected,
                });
            }
            AcpEvent::Error { message } => {
                self.status = message;
            }
            AcpEvent::Closed => {
                self.status = "connection closed".to_string();
                self.busy = false;
            }
        }
    }

    /// A turn finished: commit streaming + thinking + tools into the transcript.
    pub fn finish_turn(&mut self) {
        if let Some(text) = self.streaming.take().filter(|t| !t.is_empty()) {
            self.messages.push(Message::new(Role::Assistant, text));
        }
        if let Some(thought) = self.thinking.take().filter(|t| !t.is_empty()) {
            self.messages.push(Message::new(Role::Thought, thought));
        }
        for tool in std::mem::take(&mut self.tools) {
            let label = tool.title.unwrap_or(tool.name);
            let body = if tool.output.is_empty() {
                format!("{label} [{}]", tool.status.unwrap_or_default())
            } else {
                format!("{label} [{}]\n{}", tool.status.unwrap_or_default(), tool.output)
            };
            self.messages.push(Message::new(Role::Tool, body));
        }
        self.busy = false;
    }


    /// Track the user message the agent echoed back. It is only rendered when
    /// it differs from the prompt we already committed at submit time.
    pub fn set_user_echo(&mut self, text: &str) {
        match &mut self.user_echo {
            Some(buf) if text.starts_with(buf.as_str()) => *buf = text.to_string(),
            _ => self.user_echo = Some(text.to_string()),
        }
    }


    /// Record a submitted user prompt and open the streaming slot.
    pub fn submit(&mut self, prompt: String) {
        self.messages.push(Message::new(Role::User, prompt.clone()));
        self.history.push(prompt);
        self.history_pos = 0;
        self.streaming = Some(String::new());
        self.thinking = None;
        self.tools.clear();
        self.permission = None;
        self.busy = true;
        self.follow_bottom = true;
    }

    /// Move up (older) in the history buffer.
    pub fn history_up(&mut self) {
        if self.history.is_empty() {
            return;
        }
        if self.history_pos < self.history.len() {
            self.history_pos += 1;
            let idx = self.history.len() - self.history_pos;
            self.input = self.history[idx].clone();
        }
    }

    /// Move down (newer) in the history buffer.
    pub fn history_down(&mut self) {
        if self.history_pos == 0 {
            return;
        }
        self.history_pos -= 1;
        self.input = if self.history_pos == 0 {
            String::new()
        } else {
            let idx = self.history.len() - self.history_pos;
            self.history[idx].clone()
        };
    }


}
